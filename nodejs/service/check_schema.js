require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});
async function run() {
    const res = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'reclass_v1' OR table_name = 'reclass_v2' OR table_name LIKE 'reclass_%' LIMIT 50;
    `);
    console.log(res.rows);
    process.exit(0);
}
run();
