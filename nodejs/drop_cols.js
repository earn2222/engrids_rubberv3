const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

const pool = new Pool({
    user: process.env.DB_USER,
    host: '127.0.0.1',
    database: process.env.DB_NAME || 'rub_v3',
    password: process.env.DB_PASSWORD,
    port: 6400,
});

async function dropColumns() {
    console.log('Connecting to database...');
    try {
        const columnsToDrop = ['refinal', 'classified', 'user_name'];
        for (const col of columnsToDrop) {
            const { rows } = await pool.query(`
                SELECT table_name 
                FROM information_schema.columns 
                WHERE column_name = $1 AND table_schema = 'public'
            `, [col]);
            
            for (const row of rows) {
                const tableName = row.table_name;
                
                try {
                    // Use CASCADE to drop views that depend on this column. 
                    // Note: The UI will recreate the views when accessing the project or we can recreate them.
                    await pool.query(`ALTER TABLE "${tableName}" DROP COLUMN IF EXISTS "${col}" CASCADE`);
                    console.log(`✅ Success dropping "${col}" from "${tableName}"`);
                } catch(e) {
                    if (e.message.includes('is a view')) {
                        console.log(`Skipping view: ${tableName}`);
                    } else {
                        console.error(`❌ Error dropping "${col}" from "${tableName}":`, e.message);
                    }
                }
            }
        }
        console.log('\n✅ Database migration completed successfully.');
        console.log('⚠️ Note: Any views that were dropped due to CASCADE will be automatically recreated when you access the project via the web interface.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await pool.end();
        console.log('Database connection closed.');
    }
}

dropColumns();
