const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const cors = require('cors');
app.use(cors());

/* ── Ensure rub_v3 database and PostGIS exist before starting ── */
async function ensureDatabase() {
    const adminPool = new Pool({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: 'postgres',   // connect to default db first
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
    });
    try {
        const dbName = process.env.DB_NAME || 'rub_v3';
        const { rows } = await adminPool.query(
            `SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]
        );
        if (rows.length === 0) {
            console.log(`[startup] Creating database "${dbName}"...`);
            await adminPool.query(`CREATE DATABASE "${dbName}"`);
            console.log(`[startup] Database "${dbName}" created.`);
        }

        // Enable PostGIS in target database
        const dbPool = new Pool({
            user: process.env.DB_USER,
            host: process.env.DB_HOST,
            database: dbName,
            password: process.env.DB_PASSWORD,
            port: process.env.DB_PORT,
        });
        await dbPool.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
        await dbPool.query(`CREATE EXTENSION IF NOT EXISTS postgis_topology`);

        // Ensure users table with role column
        await dbPool.query(`
            CREATE TABLE IF NOT EXISTS public.users (
                id           SERIAL PRIMARY KEY,
                google_id    TEXT UNIQUE,
                display_name TEXT,
                email        TEXT,
                photo        TEXT,
                role         TEXT NOT NULL DEFAULT 'worker',
                created_at   TIMESTAMP DEFAULT NOW()
            )
        `);
        await dbPool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'worker'`);

        // Trigger: auto-set admin role for designated emails
        await dbPool.query(`
            CREATE OR REPLACE FUNCTION public.set_admin_email_role()
            RETURNS TRIGGER AS $$
            BEGIN
                IF LOWER(NEW.email) IN ('engrids2025@gmail.com') THEN
                    NEW.role := 'admin';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);
        await dbPool.query(`DROP TRIGGER IF EXISTS trg_admin_email_role ON public.users`);
        await dbPool.query(`
            CREATE TRIGGER trg_admin_email_role
            BEFORE INSERT OR UPDATE ON public.users
            FOR EACH ROW EXECUTE FUNCTION public.set_admin_email_role()
        `);

        // Set existing admin user
        await dbPool.query(`
            UPDATE public.users SET role = 'admin'
            WHERE LOWER(email) = 'engrids2025@gmail.com'
        `);

        // Ensure task_assignments table exists (used by authen.js auto-link at login)
        await dbPool.query(`
            CREATE TABLE IF NOT EXISTS public.task_assignments (
                id             SERIAL PRIMARY KEY,
                tb_name        TEXT NOT NULL,
                assignee_name  TEXT NOT NULL,
                assignee_photo TEXT,
                id_from        INTEGER NOT NULL,
                id_to          INTEGER NOT NULL,
                note           TEXT,
                created_at     TIMESTAMP DEFAULT NOW(),
                updated_at     TIMESTAMP DEFAULT NOW()
            )
        `);
        await dbPool.query(`ALTER TABLE public.task_assignments ADD COLUMN IF NOT EXISTS user_id INTEGER`);
        await dbPool.query(`ALTER TABLE public.task_assignments ADD COLUMN IF NOT EXISTS assignee_email TEXT`);

        await dbPool.end();
        console.log(`[startup] Database ready.`);
    } catch (err) {
        console.error('[startup] Database setup error:', err.message);
    } finally {
        await adminPool.end();
    }
}

app.use('/rub3', require('./service/authen'));
app.use('/rub3', require('./service/api'));
app.use('/rub3', express.static('www'));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const port = process.env.PORT || 4400;
app.listen(port, () => {
    console.log(`http://localhost:${port}`);
});

ensureDatabase().catch(err => {
    console.error('[startup] Database initialization failed:', err.message);
});
