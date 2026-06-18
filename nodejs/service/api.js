const express = require('express');
const app = express.Router();
const { Pool } = require('pg');
const multer = require('multer');
const unzipper = require('unzipper');
const shapefile = require('shapefile');
const fs = require('fs');
const path = require('path');

const bodyParser = require('body-parser');
const pathModule = require('path');

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

require('dotenv').config();
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// ── Review history helpers ──────────────────────────────────────────────────
// ใช้ pool เสมอ (ไม่ใช้ transaction client) เพื่อไม่ให้ history หายไปถ้า rollback
let _reviewHistoryReady = false;
async function ensureReviewHistoryTable() {
    if (_reviewHistoryReady) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS review_history (
            id          SERIAL PRIMARY KEY,
            tb_name     TEXT NOT NULL,
            parent_id   INTEGER,
            sub_id      TEXT,
            check_shape TEXT,
            remark      TEXT,
            reviewer    TEXT,
            review_ts   TIMESTAMP WITHOUT TIME ZONE,
            reset_reason TEXT,
            reset_ts    TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
        )
    `);
    _reviewHistoryReady = true;
}

async function _saveHistoryRows(tb, rows, reason) {
    // ตรวจสอบว่า remark column มีอยู่หรือไม่
    let hasRemark = false;
    try {
        const colCheck = await pool.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name=$1 AND column_name='remark'`,
            [`reclass_${tb}`]
        );
        hasRemark = colCheck.rowCount > 0;
    } catch (_) {}

    let remarkMap = {};
    if (hasRemark && rows.length > 0) {
        try {
            const subIds = rows.map(r => r.sub_id).filter(Boolean);
            if (subIds.length > 0) {
                const placeholders = subIds.map((_, i) => `$${i + 1}`).join(',');
                const remarkRows = await pool.query(
                    `SELECT sub_id, remark FROM reclass_${tb} WHERE sub_id IN (${placeholders})`,
                    subIds
                );
                remarkRows.rows.forEach(r => { remarkMap[r.sub_id] = r.remark; });
            }
        } catch (_) {}
    }

    for (const row of rows) {
        await pool.query(
            `INSERT INTO review_history
             (tb_name, parent_id, sub_id, check_shape, remark, reviewer, review_ts, reset_reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [tb, row.id, row.sub_id, row.check_shape,
             remarkMap[row.sub_id] || null, row.reviewer, row.review_ts, reason]
        );
    }
}

async function ensureReclassReviewColumns(tb) {
    const cols = [
        { name: 'check_shape',    type: 'text' },
        { name: 'remark',         type: 'text' },
        { name: 'reviewer',       type: 'text' },
        { name: 'review_ts',      type: 'timestamp without time zone' },
        { name: 'user_remark',    type: 'text' },
        { name: 'user_remark_ts', type: 'timestamp without time zone' },
        { name: '"Class_Area"',    type: 'numeric' },
    ];
    for (const col of cols) {
        await pool.query(`
            DO $$ BEGIN
                ALTER TABLE reclass_${tb} ADD COLUMN ${col.name} ${col.type};
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$;
        `).catch(() => {});
    }
}

async function saveReviewHistoryById(_, tb, id, reason) {
    try {
        await ensureReviewHistoryTable();
        await ensureReclassReviewColumns(tb);
        const { rows } = await pool.query(
            `SELECT id, sub_id, check_shape, reviewer, review_ts
             FROM reclass_${tb}
             WHERE id = $1
               AND (check_shape IS NOT NULL OR reviewer IS NOT NULL)`,
            [id]
        );
        if (rows.length > 0) await _saveHistoryRows(tb, rows, reason);
    } catch (e) {
        console.error('saveReviewHistoryById error:', e.message);
    }
}

async function saveReviewHistoryBySubId(_, tb, sub_id, reason) {
    try {
        await ensureReviewHistoryTable();
        await ensureReclassReviewColumns(tb);
        const { rows } = await pool.query(
            `SELECT id, sub_id, check_shape, reviewer, review_ts
             FROM reclass_${tb}
             WHERE sub_id = $1
               AND (check_shape IS NOT NULL OR reviewer IS NOT NULL)`,
            [sub_id]
        );
        if (rows.length > 0) await _saveHistoryRows(tb, rows, reason);
    } catch (e) {
        console.error('saveReviewHistoryBySubId error:', e.message);
    }
}
// ───────────────────────────────────────────────────────────────────────────

// get all users
app.get('/api/getfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // Get all columns from the table
        const colsResult = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
            [tb]
        );

        if (colsResult.rowCount === 0) {
            return res.status(404).json({ error: 'Table not found' });
        }

        // Build SELECT clause with geometry columns converted to GeoJSON
        const columns = colsResult.rows.map(r => r.column_name);
        const selectColumns = columns.map(col => {
            if (col === 'geom' || col === 'geom_point') {
                return `ST_AsGeoJSON(${col}) AS ${col}`;
            }
            return `"${col}" AS "${col.toLowerCase()}"`;
        }).join(',\n');

        const sql = `SELECT ${selectColumns} FROM ${tb} WHERE geom IS NOT NULL OR geom_point IS NOT NULL`;

        const result = await pool.query(sql);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/getfeatures/:tb/:fid', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const fid = req.params.fid;
        console.log(`Fetching feature with ID: ${fid} from table: ${tb}`);
        if (!fid) {
            return res.status(400).json({ error: 'Feature ID is required' });
        }

        // Check if reclass table exists
        const checkTableSql = `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`;
        const reclassTableName = `reclass_${tb}`;
        const checkResult = await pool.query(checkTableSql, [reclassTableName]);
        const reclassTableExists = checkResult.rows[0].exists;

        let sql, values;
        if (reclassTableExists) {
            await ensureReclassReviewColumns(tb);

            sql = `SELECT r.id,
                        r.sub_id,
                        r."Classtype",
                        r.shpsplit_sqm,
                        r."Class_Area",
                        r.check_shape,
                        r.remark,
                        r.reviewer,
                        t."Sqm_Rechac" AS sqm_rechac,
                        t."Rai_Rechac" AS rai_rechac,
                        t."Farmer_ID" AS farmer_id,
                        t."Name" AS name,
                        t."Surname" AS surname,
                        ST_ASGeoJSON(r.geom) AS geom,
                        ST_ASGeoJSON(st_makepoint(100, 18)) AS geom_point
                    FROM ${reclassTableName} r
                    JOIN ${tb} t ON r.id = t.id
                    WHERE r.geom IS NOT NULL AND r.id = $1`;
            values = [fid];
        } else {
            // Fallback to original table (no reclass table yet)
            sql = `SELECT t.id,
                        t.id AS sub_id,
                        NULL AS "Classtype",
                        t."Sqm_Rechac" AS shpsplit_sqm,
                        t."Sqm_Rechac" AS sqm_rechac,
                        t."Rai_Rechac" AS rai_rechac,
                        t."Farmer_ID" AS farmer_id,
                        t."Name" AS name,
                        t."Surname" AS surname,
                        ST_ASGeoJSON(t.geom) AS geom,
                        ST_ASGeoJSON(st_makepoint(100, 18)) AS geom_point
                    FROM ${tb} t
                    WHERE t.geom IS NOT NULL AND t.id = $1`;
            values = [fid];
        }

        console.log(`Executing SQL: ${sql} with fid: ${fid}`);
        const result = await pool.query(sql, values);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// v3
app.get('/api/getfeaturesv3/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // ตรวจสอบคอลัมน์ geom_point
        const colCheck = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'geom_point'",
            [tb]
        );
        const hasGeomPoint = colCheck.rowCount > 0;

        const geomPointSelect = hasGeomPoint ? 'ST_AsGeoJSON(geom_point) AS geom_point' : "NULL::json AS geom_point";
        const whereClause = hasGeomPoint ? 'WHERE geom IS NOT NULL OR geom_point IS NOT NULL' : 'WHERE geom IS NOT NULL';

        const sql = `
            SELECT id,
                "Name"       AS name,
                "Surname"    AS surname,
                "Old_Year"   AS old_year,
                "Farmer_ID"  AS farmer_id,
                "Sqm_Rechac" AS sqm_rechac,
                "Rai_Rechac" AS rai_rechac,
                "Area_SqM"   AS area_sqm,
                "Rai_Area"   AS rai_area,
                "Land_ID"    AS land_id,
                "Zone"       AS zone,
                ST_AsGeoJSON(geom) AS geom,
                ${geomPointSelect}
            FROM ${tb}
            ${whereClause}
        `;
        const result = await pool.query(sql);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/deletefeature/:tb/:id', async (req, res) => {
    try {
        let { tb, id } = req.params;
        tb = tb.toLowerCase();

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const featureId = parseInt(id, 10);
        if (isNaN(featureId)) {
            return res.status(400).json({ error: 'Feature ID must be a number' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Delete from reclass table if it exists
            await client.query(`DELETE FROM reclass_${tb} WHERE id = $1`, [featureId]);
            // Delete from main table
            const result = await client.query(`DELETE FROM ${tb} WHERE id = $1 RETURNING id`, [featureId]);

            if (result.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Feature not found' });
            }

            await client.query('COMMIT');
            res.json({ success: true, message: 'Feature deleted successfully', deletedId: result.rows[0].id });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error in /api/deletefeature:', err);
        res.status(500).json({ error: err.message });
    }
});
app.put('/api/restorefeatures/:tb/:id', async (req, res) => {
    try {
        let { tb, id } = req.params;
        tb = tb.toLowerCase();

        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const featureId = parseInt(id, 10);
        if (isNaN(featureId)) {
            return res.status(400).json({ error: 'Feature ID must be a number' });
        }

        // ──────────────────────────────────────────────────────────────────────
        // ลองดึงจาก backup table ก่อน (ค่าต้นฉบับ) ถ้ามี
        // ──────────────────────────────────────────────────────────────────────
        const backupExists = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [`backup_${tb}`]
        );

        if (backupExists.rows[0].exists) {
            // ── Restore จาก backup table (ค่าต้นฉบับที่ upload ครั้งแรก) ──────
            const bkRow = await pool.query(
                `SELECT * FROM backup_${tb} WHERE id = $1 LIMIT 1`,
                [featureId]
            );
            if (bkRow.rowCount > 0) {
                const bk = bkRow.rows[0];
                const isPoint = bk.geom === null; // polygon จะมี geom, point จะเป็น NULL

                let updateSql, updateResult;
                if (isPoint) {
                    // ── Point: reset geom → NULL, restore geom_point ต้นฉบับ + Sqm_Rechac ──
                    updateResult = await pool.query(`
                        UPDATE ${tb} AS t
                        SET geom           = NULL,
                            geom_point     = b.geom_point,
                            "Sqm_Rechac"   = b."Sqm_Rechac"
                        FROM backup_${tb} AS b
                        WHERE t.id = $1 AND b.id = $1
                        RETURNING t.*
                    `, [featureId]);
                } else {
                    // ── Polygon: restore geom + คำนวณ shparea_sq ใหม่ ────────
                    // คำนวณ EPSG จาก centroid ของ geometry ใน backup
                    const geomRow = await pool.query(
                        `SELECT ST_AsGeoJSON(geom) AS geom FROM backup_${tb} WHERE id = $1`,
                        [featureId]
                    );
                    const geojson = JSON.parse(geomRow.rows[0].geom);
                    function getPolygonCentroid(coords, type) {
                        let x = 0, y = 0, total = 0;
                        if (type === 'Polygon') {
                            for (const ring of coords) for (const [lon, lat] of ring) { x += lon; y += lat; total++; }
                        } else if (type === 'MultiPolygon') {
                            for (const polygon of coords) for (const ring of polygon) for (const [lon, lat] of ring) { x += lon; y += lat; total++; }
                        }
                        return total > 0 ? [x / total, y / total] : [null, null];
                    }
                    const [lon, lat] = getPolygonCentroid(geojson.coordinates, geojson.type);
                    const epsg = (lon !== null && !isNaN(lon))
                        ? (lat >= 0 ? 32600 : 32700) + Math.floor((lon + 180) / 6) + 1
                        : 4326;

                    updateResult = await pool.query(`
                        UPDATE ${tb} AS t
                        SET geom           = b.geom,
                            geom_point     = b.geom_point,
                            "Sqm_Rechac"   = b."Sqm_Rechac"
                        FROM backup_${tb} AS b
                        WHERE t.id = $1 AND b.id = $1
                        RETURNING t.*
                    `, [featureId]);
                }

                if (!updateResult || updateResult.rowCount === 0) {
                    return res.status(404).json({ error: 'Feature not found in main table' });
                }

                // sync shpsplit_sqm ใน reclass table ด้วย (ถ้ามี)
                const reclassCheck = await pool.query(
                    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
                    [`reclass_${tb}`]
                );
                if (reclassCheck.rows[0].exists) {
                    if (isPoint) {
                        // Point: sync geom_point กลับต้นฉบับ + reset geom = NULL ใน reclass
                        await pool.query(`
                            UPDATE reclass_${tb}
                            SET shpsplit_sqm = $1, "Class_Area" = ROUND(($1::numeric / 1600.0), 2),
                                geom        = NULL,
                                geom_point  = b.geom_point
                            FROM backup_${tb} AS b
                            WHERE reclass_${tb}.id = $2
                              AND b.id = $2
                              AND (reclass_${tb}.sub_id = $3 OR reclass_${tb}.sub_id = $2::text)
                        `, [bk['Sqm_Rechac'], featureId, featureId.toString()]);
                    } else {
                        // Polygon: sync shpsplit_sqm เท่านั้น
                        await pool.query(`
                            UPDATE reclass_${tb}
                            SET shpsplit_sqm = $1, "Class_Area" = ROUND(($1::numeric / 1600.0), 2)
                            WHERE id = $2 AND (sub_id = $3 OR sub_id = $2::text)
                        `, [bk['Sqm_Rechac'], featureId, featureId.toString()]);
                    }

                    // Save review history before resetting
                    await saveReviewHistoryById(pool, tb, featureId, 'restore');
                    // Safely reset check fields if they exist
                    await pool.query(`
                        DO $$ BEGIN
                            UPDATE reclass_${tb}
                            SET check_shape = NULL, reviewer = NULL, review_ts = NULL
                            WHERE id = ${featureId} AND (sub_id = '${featureId.toString()}' OR sub_id = ${featureId}::text);
                        EXCEPTION WHEN undefined_column THEN NULL; END $$;
                    `);
                }

                return res.status(200).json({
                    success: true,
                    source: 'backup',
                    data: updateResult.rows[0]
                });
            }
        }

        // ──────────────────────────────────────────────────────────────────────
        // Fallback: ไม่มี backup → restore จาก reclass table (พฤติกรรมเดิม)
        // รองรับทั้ง polygon (geom) และ point (geom_point)
        // ──────────────────────────────────────────────────────────────────────
        const geomRow = await pool.query(
            `SELECT ST_AsGeoJSON(geom) AS geom, ST_AsGeoJSON(geom_point) AS geom_point
             FROM reclass_${tb} WHERE id = $1 LIMIT 1`,
            [featureId]
        );
        if (geomRow.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found in reclass table' });
        }

        const rGeom = geomRow.rows[0].geom;        // อาจ null ถ้าเป็น point
        const rGeomPt = geomRow.rows[0].geom_point;  // อาจ null ถ้าเป็น polygon
        const isPoint = rGeom === null;

        let sql, result;
        if (isPoint) {
            // ── Point: reset geom → NULL, restore geom_point จาก reclass ──
            sql = `
                UPDATE ${tb} AS t
                SET geom       = NULL,
                    geom_point = r.geom_point
                FROM reclass_${tb} AS r
                WHERE t.id = $1 AND r.id = $1
                RETURNING t.*
            `;
        } else {
            // ── Polygon: restore geom + คำนวณ shparea_sq ────────────────────
            const geojson = JSON.parse(rGeom);
            function getPolygonCentroid2(coords, type) {
                let x = 0, y = 0, total = 0;
                if (type === 'Polygon') {
                    for (const ring of coords) for (const [lon, lat] of ring) { x += lon; y += lat; total++; }
                } else if (type === 'MultiPolygon') {
                    for (const polygon of coords) for (const ring of polygon) for (const [lon, lat] of ring) { x += lon; y += lat; total++; }
                }
                return total > 0 ? [x / total, y / total] : [null, null];
            }
            const [lon, lat] = getPolygonCentroid2(geojson.coordinates, geojson.type);
            const epsg = (lon !== null && !isNaN(lon))
                ? (lat >= 0 ? 32600 : 32700) + Math.floor((lon + 180) / 6) + 1
                : 4326;

            sql = `
                UPDATE ${tb} AS t
                SET geom        = r.geom,
                    "Sqm_Rechac" = ST_Area(ST_Transform(r.geom, ${epsg}))
                FROM reclass_${tb} AS r
                WHERE t.id = $1 AND r.id = $1
                RETURNING t.*
            `;
        }

        const { rows, rowCount } = await pool.query(sql, [featureId]);
        if (rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }

        return res.status(200).json({
            success: true,
            source: 'reclass',
            data: rows[0]
        });

    } catch (err) {
        console.error('Error in /api/restorefeatures:', err);
        return res.status(500).json({ error: err.message });
    }
});




app.post('/api/updatefeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const { id, features, displayName, geometryChanged, currentShpareaSq } = req.body;

        const client = await pool.connect();

        if (!features || !Array.isArray(features) || features.length === 0) {
            return res.status(400).json({ error: 'Invalid or empty features' });
        }

        // ✅ ฟังก์ชันคำนวณ EPSG จาก centroid
        function getPolygonCentroid(coords, type) {
            let x = 0, y = 0, total = 0;

            if (type === 'Polygon') {
                for (const ring of coords) {
                    for (const [lon, lat] of ring) {
                        x += lon;
                        y += lat;
                        total++;
                    }
                }
            } else if (type === 'MultiPolygon') {
                for (const polygon of coords) {
                    for (const ring of polygon) {
                        for (const [lon, lat] of ring) {
                            x += lon;
                            y += lat;
                            total++;
                        }
                    }
                }
            }

            return total > 0 ? [x / total, y / total] : [null, null];
        }

        function getUTMEPSGCode(lon, lat) {
            const zone = Math.floor((lon + 180) / 6) + 1;
            return lat >= 0 ? 32600 + zone : 32700 + zone;
        }

        function getEPSGFromGeoJSON(geometry) {
            const coords = geometry.coordinates;
            const type = geometry.type;
            const [lon, lat] = getPolygonCentroid(coords, type);
            if (lon === null || lat === null || isNaN(lon) || isNaN(lat)) {
                return 4326;
            }
            return getUTMEPSGCode(lon, lat);
        }

        try {
            await client.query('BEGIN');

            const areas = [];

            for (const feature of features) {
                const geometry = feature.geometry;
                const geojsonStr = JSON.stringify(geometry);

                let area;
                if (geometryChanged) {
                    // ✅ คำนวณพื้นที่ใหม่เมื่อผู้ใช้แก้ไข geometry จริงๆ
                    const epsg = getEPSGFromGeoJSON(geometry);
                    const areaSql = `
                        SELECT ST_Area(
                            ST_Transform(
                                ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                                ${epsg}
                            )
                        ) AS area
                    `;
                    const areaResult = await client.query(areaSql, [geojsonStr]);
                    area = areaResult.rows[0].area;
                    console.log(`Geometry changed for ID ${id}, recalculating area: ${area}`);
                } else {
                    // ✅ ใช้ค่าจากฐานข้อมูลเดิม ไม่คำนวณใหม่ (ดึงจาก Sqm_Rechac ซึ่งเก็บ m²)
                    const existingRes = await client.query(`SELECT "Sqm_Rechac" FROM ${tb} WHERE id = $1`, [id]);
                    area = existingRes.rows[0]?.['Sqm_Rechac'] || currentShpareaSq || 0;
                    console.log(`Geometry unchanged for ID ${id}, preserving area: ${area}`);
                }

                // ✅ บันทึกลงฐานข้อมูล
                // Sqm_Rechac = เนื้อที่ขณะนี้ (m²), Rai_Rechac = เนื้อที่ขณะนี้ (ไร่)
                const areaRai = area / 1600.0;
                await client.query(`
                    UPDATE ${tb}
                    SET
                        geom = CASE
                            WHEN ST_GeometryType(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) IN ('ST_Polygon', 'ST_MultiPolygon')
                            THEN ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))
                            ELSE geom
                        END,
                        geom_point = CASE
                            WHEN ST_GeometryType(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) = 'ST_Point'
                            THEN ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)
                            WHEN ST_GeometryType(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) IN ('ST_Polygon', 'ST_MultiPolygon')
                            THEN ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))
                            ELSE geom_point
                        END,
                        "Sqm_Rechac" = $3,
                        "Rai_Rechac" = $4
                    WHERE id = $2
                `, [
                    geojsonStr,
                    id,
                    area,
                    areaRai
                ]);

                // Reset review data in reclass table if it exists
                const reclassCheck = await client.query(
                    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
                    [`reclass_${tb}`]
                );
                if (reclassCheck.rows[0].exists) {
                    await saveReviewHistoryById(client, tb, parseInt(id, 10), 'reshape');
                    await client.query(`
                        DO $$ BEGIN
                            UPDATE reclass_${tb}
                            SET check_shape = NULL,
                                reviewer = NULL,
                                review_ts = NULL
                            WHERE id = ${parseInt(id, 10)};
                        EXCEPTION WHEN undefined_column THEN NULL; END $$;
                    `);
                }

                areas.push({
                    id: feature.properties?.id || id,
                    area
                });
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                updated: areas.map(a => a.id),
                areas
            });

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error in /api/updatefeatures:', err);
        res.status(500).json({ error: err.message });
    }
});

// savefeature endpoint removed — was only used by digitize folder (deleted)


app.get('/api/getreclassfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // Auto-add review columns if they don't exist (for older tables)
        await ensureReclassReviewColumns(tb);

        await pool.query(`
            UPDATE reclass_${tb}
            SET "Class_Area" = ROUND((shpsplit_sqm / 1600.0), 2)
            WHERE "Class_Area" IS NULL AND shpsplit_sqm IS NOT NULL AND "Classtype" IS NOT NULL;
        `);

        const sql = `SELECT a.id,
                    a.sub_id,
                    a."Classtype",
                    a.farmer_id,
                    b."Farmer_ID",
                    b."Name" AS name,
                    b."Surname" AS surname,
                    CONCAT_WS(' ', b."Name", b."Surname") AS farm_name,
                    b."Old_Year" AS old_year,
                    b."Land_ID" AS land_id,
                    b."Sqm_Rechac" AS sqm_rechac,
                    b."Rai_Rechac" AS rai_rechac,
                    a.shpsplit_sqm,
                    CASE WHEN a."Classtype" IS NOT NULL THEN a."Class_Area" ELSE NULL END AS "Class_Area",

                    a.check_shape,
                    a.remark,
                    a.reviewer,
                    a.user_remark,
                    a.user_remark_ts,
                    a.review_ts,
                    a.ts,
                    ST_ASGeoJSON(a.geom) AS geom FROM reclass_${tb} a
                LEFT JOIN ${tb} b
                ON a.id = b.id
                WHERE a.geom IS NOT NULL`;
        const result = await pool.query(sql);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Review/recheck endpoint
app.put('/api/update_review/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { sub_id, check_shape, remark, reviewer, user_remark } = req.body;
        if (!sub_id) {
            return res.status(400).json({ error: 'sub_id is required' });
        }

        const sql = `
            UPDATE reclass_${tb}
            SET check_shape = $1,
                remark = $2,
                reviewer = $3,
                review_ts = NOW()
            WHERE sub_id = $4
            RETURNING *`;

        const values = [check_shape || null, remark || null, reviewer || null, sub_id];
        const result = await pool.query(sql, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }

        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Clear review endpoint
app.put('/api/clear_review/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        const { sub_id } = req.body;
        if (!tb || !sub_id) {
            return res.status(400).json({ error: 'Table name and sub_id are required' });
        }

        await saveReviewHistoryBySubId(pool, tb, sub_id, 'manual_clear');

        const sql = `
            UPDATE reclass_${tb}
            SET check_shape = NULL,
                remark = NULL,
                reviewer = NULL,
                review_ts = NULL
            WHERE sub_id = $1
            RETURNING *`;

        const result = await pool.query(sql, [sub_id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Review history endpoint
app.get('/api/review_history/:tb/:id', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        const id = parseInt(req.params.id, 10);
        if (!tb || isNaN(id)) return res.status(400).json({ error: 'Invalid parameters' });

        const exists = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'review_history')`
        );
        if (!exists.rows[0].exists) {
            return res.json({ success: true, data: [] });
        }

        const result = await pool.query(
            `SELECT * FROM review_history WHERE tb_name = $1 AND parent_id = $2 ORDER BY reset_ts DESC`,
            [tb, id]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// User remark endpoint
app.put('/api/update_user_remark/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { sub_id, user_remark } = req.body;
        if (!sub_id) {
            return res.status(400).json({ error: 'sub_id is required' });
        }

        const sql = `
            UPDATE reclass_${tb}
            SET user_remark = $1,
                user_remark_ts = CASE WHEN $1::text IS NULL THEN NULL ELSE NOW() END
            WHERE sub_id = $2
            RETURNING *`;

        const values = [user_remark || null, sub_id];
        const result = await pool.query(sql, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }

        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE a single reclass feature by sub_id
app.delete('/api/delete_reclass_feature/:tb/:sub_id', async (req, res) => {
    try {
        let { tb, sub_id } = req.params;
        tb = tb.toLowerCase();
        if (!tb || !sub_id) {
            return res.status(400).json({ error: 'Table name and sub_id are required' });
        }
        const sql = `DELETE FROM reclass_${tb} WHERE sub_id = $1 RETURNING sub_id`;
        const result = await pool.query(sql, [sub_id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: 'Feature not found' });
        }
        res.status(200).json({ success: true, deleted: sub_id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET background polygons from project table with bbox spatial filtering
app.get('/api/shpall/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ success: false, error: 'Invalid table name' });
        }
        const bboxStr = req.query.bbox;
        if (!bboxStr) {
            return res.status(400).json({ success: false, error: 'bbox query param required: ?bbox=minX,minY,maxX,maxY' });
        }
        const parts = bboxStr.split(',').map(Number);
        if (parts.length !== 4 || parts.some(n => isNaN(n))) {
            return res.status(400).json({ success: false, error: 'invalid bbox' });
        }

        const sql = `
            SELECT ST_AsGeoJSON(geom) AS geom_json
            FROM ${tb}
            WHERE geom IS NOT NULL AND geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
            LIMIT 5000
        `;
        const result = await pool.query(sql, parts);
        const features = result.rows
            .filter(row => row.geom_json)
            .map(row => ({ type: 'Feature', geometry: JSON.parse(row.geom_json), properties: {} }));

        res.status(200).json({ success: true, type: 'FeatureCollection', features });
    } catch (err) {
        console.error('Error in /api/shpall:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET reshape polygon data for reclassdash map overlay
app.get('/api/getreshapefeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const sql = `SELECT id,
                        "Farmer_ID",
                        "Sqm_Rechac",
                        "Rai_Rechac",
                        ST_ASGeoJSON(geom) AS geom
                    FROM ${tb}
                    WHERE geom IS NOT NULL`;

        const result = await pool.query(sql);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/countsfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const query = `
        SELECT 
            (SELECT COUNT(*) FROM ${tb}) AS total,
            (
                CASE 
                    WHEN to_regclass('reclass_${tb}') IS NOT NULL THEN (
                        SELECT COUNT(DISTINCT r.id) 
                        FROM reclass_${tb} r
                        JOIN ${tb} m ON r.id = m.id
                        WHERE r."Classtype" IS NOT NULL
                    )
                    ELSE 0 
                END
            ) AS reclass,
            (
                CASE 
                    WHEN to_regclass('reclass_${tb}') IS NOT NULL THEN (
                        SELECT COUNT(DISTINCT r.id) 
                        FROM reclass_${tb} r
                        JOIN ${tb} m ON r.id = m.id
                        WHERE r.editor IS NOT NULL AND ABS(r.shpsplit_sqm - m."Sqm_Rechac") <= 100
                    )
                    ELSE 0 
                END
            ) AS reshp
        `;
        const result = await pool.query(query);
        res.json(result.rows[0] || { total: 0, reclass: 0, reshp: 0 });
    } catch (err) {
        console.error(err.stack);
        res.status(500).json({ error: 'Database query failed' });
    }
});

app.get('/api/countsrai/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const sql = `SELECT
                        "Classtype",
                        ROUND(SUM(shpsplit_sqm) / 1600.0, 0) AS area_rai
                    FROM ${tb}
                    GROUP BY "Classtype"
                    ORDER BY "Classtype";`;
        const { rows } = await pool.query(sql);
        res.json(rows);
    } catch (err) {
        console.error(err.stack);
        res.status(500).json({ error: 'Database query failed' });
    }
});

app.post('/api/create_reclass_feature/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ error: 'Feature ID is required' });
        }

        const sub_id = id.toString();
        const sql = `
            WITH delete_existing AS (
                DELETE FROM reclass_${tb}
                WHERE id = $1
                RETURNING id
            )
            INSERT INTO reclass_${tb} (id, sub_id, farmer_id, shpsplit_sqm, "Class_Area", geom)
            SELECT id, $2, "Farmer_ID", "Sqm_Rechac", ROUND(("Sqm_Rechac"::numeric / 1600.0), 2), geom
            FROM ${tb}
            WHERE id = $1
            RETURNING id, farmer_id, ST_AsGeoJSON(geom) AS geom;
        `;
        const values = [id, sub_id];
        const result = await pool.query(sql, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found in source table' });
        }

        // Note: No longer updating classified column since it was removed

        res.status(200).json({ success: true, data: result.rows });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/create_reclass_layer', async (req, res) => {
    try {
        const { tb } = req.body;
        console.log(tb);

        if (!tb) {
            return res.status(400).json({ error: 'table name are required' });
        }

        const sql = `CREATE TABLE reclass_${tb} (
                fid serial not null,
                id integer,
                sub_id text COLLATE pg_catalog."default",
                id_farmer text COLLATE pg_catalog."default",
                shpsplit_sqm numeric,
                "Class_Area" numeric,
                geom geometry(MultiPolygon,4326),
                "Classtype" text COLLATE pg_catalog."default",
                editor text COLLATE pg_catalog."default",

                check_shape text COLLATE pg_catalog."default",
                remark text COLLATE pg_catalog."default",
                reviewer text COLLATE pg_catalog."default",
                ts timestamp without time zone DEFAULT now()
            )`;
        await pool.query(sql);

        console.log(sql);

        // join reclass table to source table
        const sql2 = `CREATE VIEW v_reclass_${tb} AS SELECT
                    a.id,
                    a.farm_name,
                    a.farm_idc,
                    a.id_farmer,
                    a.land_seq,
                    a.land_right,
                    a.land_name,
                    a.land_moo,
                    a.land_vill,
                    a.tambon,
                    a.amphur,
                    a.province,
                    a.grow_year,
                    a.rip_type,
                    a.rubber_age,
                    a.grow_area,
                    a.regis_no,
                    a.no_plot,
                    a.id_farmer_    AS farmer_id,
                    a.titl_nam      AS title_name,
                    a.f_name        AS first_name,
                    a.l_name        AS last_name,
                    a.address,
                    a.sub_dis       AS sub_district,
                    a.district,
                    a.province_1    AS province_alt,
                    a.status,
                    a.title_no,
                    a.title_type,
                    a.rai,
                    a.age,
                    a.x,
                    a.y,
                    a.sqm_pacel,
                    a.chk,
                    a.diff_chk,
                    a.remark        AS a_remark,
                    a.editor        AS a_editor,
                    a.ts            AS a_ts,
                    a.shparea_sq,
                    r.fid           AS reclass_fid,
                    r.id            AS reclass_parent_id,
                    r.sub_id        AS reclass_sub_id,
                     r.id_farmer     AS reclass_id_farmer,
                    r.shpsplit_sqm,
                    r."Class_Area",
                    r."Classtype",
                    r.editor        AS reclass_editor,
                    r.ts            AS r_ts,
                    r.geom
                FROM ${tb} AS a
                JOIN reclass_${tb} AS r
                ON a.id = r.id;`;
        await pool.query(sql2);

        console.log(sql2);

        res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });

    }
})

app.post('/api/splitfeature/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { polygon_fc, line_fc, srid, displayName } = req.body;
        const polygon = polygon_fc.geometry;
        const line = line_fc.geometry;
        const properties = polygon_fc.properties;
        const id = polygon_fc.properties.id;
        const sub_id = polygon_fc.properties.sub_id;

        console.log(`Splitting feature in table ${tb} with ID ${id} and sub_id ${sub_id}`);

        // Save review history before deleting the existing sub_id row
        await saveReviewHistoryBySubId(null, tb, sub_id, 'split');

        if (!properties?.Farmer_ID) {
            return res.status(400).json({ error: 'Farmer_ID is required in properties' });
        }
        if (!polygon?.type || !['Polygon', 'MultiPolygon'].includes(polygon.type) || !polygon.coordinates) {
            return res.status(400).json({ error: 'Invalid polygon GeoJSON' });
        }
        if (!line?.type || !['LineString', 'MultiLineString'].includes(line.type) || !line.coordinates) {
            return res.status(400).json({ error: 'Invalid line GeoJSON' });
        }

        const result = await pool.query(`
            WITH delete_existing AS (
                DELETE FROM reclass_${tb} 
                WHERE sub_id = $5
                RETURNING sub_id
            ),
            inputs AS (
                SELECT 
                    ST_Force2D(ST_GeomFromGeoJSON($1))     AS poly_4326,
                    ST_Force2D(ST_GeomFromGeoJSON($2))     AS line_4326,
                    $3::integer                             AS processing_srid
            ),
            -- Project to metric CRS for snapping
            projected AS (
                SELECT
                    ST_Transform(poly_4326, 3857)  AS poly_m,
                    ST_Transform(line_4326, 3857)  AS line_m,
                    poly_4326,
                    processing_srid
                FROM inputs
            ),
            -- Snap line onto polygon boundary (3 m tolerance)
            -- This fixes gap issues while preserving all intermediate vertices
            snapped AS (
                SELECT
                    poly_4326,
                    processing_srid,
                    ST_Transform(
                        ST_Snap(line_m, poly_m, 3.0),
                        4326
                    ) AS line_snapped
                FROM projected
            ),
            -- Split the polygon (both sides share common boundary = zero gap)
            split AS (
                SELECT
                    ST_Split(
                        ST_MakeValid(poly_4326),
                        line_snapped
                    ) AS split_geom,
                    processing_srid
                FROM snapped
            ),
            parts AS (
                SELECT
                    ST_MakeValid((ST_Dump(split_geom)).geom) AS geom_4326,
                    processing_srid
                FROM split
            ),
            calc_areas AS (
                SELECT
                    geom_4326,
                    ST_Area(ST_Transform(geom_4326, processing_srid)) AS raw_area
                FROM parts
                WHERE ST_GeometryType(geom_4326) IN ('ST_Polygon', 'ST_MultiPolygon')
                  AND ST_IsValid(geom_4326)
                  AND ST_Area(ST_Transform(geom_4326, processing_srid)) > 1.0
            ),
            totals AS (
                SELECT NULLIF(SUM(raw_area), 0) AS sum_raw FROM calc_areas
            ),
            proportional AS (
                SELECT
                    geom_4326,
                    raw_area,
                    (COALESCE($9::numeric, sum_raw) * (raw_area / sum_raw)) AS part_area,
                    ROW_NUMBER() OVER (ORDER BY raw_area DESC) AS rn
                FROM calc_areas CROSS JOIN totals
            ),
            final_areas AS (
                SELECT
                    geom_4326,
                    CASE
                        WHEN rn = 1 THEN part_area + (
                            COALESCE($9::numeric, (SELECT sum_raw FROM totals)) 
                            - SUM(part_area) OVER()
                        )
                        ELSE part_area
                    END AS allocated_area
                FROM proportional
            ),
            inserted AS (
                INSERT INTO reclass_${tb} (farmer_id, geom, sub_id, id, "Classtype", shpsplit_sqm, "Class_Area", editor)
                SELECT
                    $4,
                    ST_Multi(geom_4326),
                    $5 || '-' || row_number() OVER (),
                    $6,
                    $7,
                    allocated_area,
                    ROUND((allocated_area::numeric / 1600.0), 2),
                    $8
                FROM final_areas
                RETURNING *
            )
            SELECT id, sub_id, "Classtype", farmer_id, shpsplit_sqm, "Class_Area",
                   ST_AsGeoJSON(geom, 15) AS geom
            FROM inserted
        `, [
            JSON.stringify(polygon),
            JSON.stringify(line),
            srid || 32647,
            properties.Farmer_ID,
            sub_id,
            id,
            properties.Classtype,
            displayName,
            properties.shpsplit_sqm || null
        ]);

        if (result.rowCount === 0) {
            return res.status(400).json({ error: 'No split results — ตรวจสอบว่าเส้นตัดข้ามแปลงจริงหรือไม่' });
        }

        res.status(200).json({ success: true, data: result.rows });

    } catch (err) {
        console.error('Split error:', err);
        res.status(500).json({
            success: false,
            error: err.message,
            details: 'Ensure valid intersecting geometries'
        });
    }
});

// ── Unsplit: คืนแปลงเดิม (ลบแถว split ทั้งหมด แล้ว re-insert ต้นฉบับ) ──
app.post('/api/unsplit_feature/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }
        const { id, displayName } = req.body;
        if (!id) {
            return res.status(400).json({ error: 'id is required' });
        }
        const featureId = parseInt(id, 10);
        if (isNaN(featureId)) {
            return res.status(400).json({ error: 'id must be a number' });
        }

        // Save review history for all split rows before deleting
        await saveReviewHistoryById(null, tb, featureId, 'unsplit');

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1) ลบแถวใน reclass ที่เป็น split-children ทั้งหมดของ id นี้
            await client.query(
                `DELETE FROM reclass_${tb} WHERE id = $1`,
                [featureId]
            );

            // 2) Re-insert แปลงเดิมจาก main table (sub_id = id.toString())
            const inserted = await client.query(`
                INSERT INTO reclass_${tb} (id, sub_id, farmer_id, shpsplit_sqm, "Class_Area", geom, "Classtype", editor)
                SELECT id,
                       id::text AS sub_id,
                       "Farmer_ID",
                       "Sqm_Rechac" AS shpsplit_sqm,
                       ROUND(("Sqm_Rechac"::numeric / 1600.0), 2) AS "Class_Area",
                       ST_Multi(geom) AS geom,
                       NULL AS "Classtype",
                       $2 AS editor
                FROM ${tb}
                WHERE id = $1
                RETURNING id, sub_id, "Classtype", farmer_id, shpsplit_sqm,
                          ST_AsGeoJSON(geom, 15) AS geom
            `, [featureId, displayName || null]);

            if (inserted.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Original feature not found in main table' });
            }

            await client.query('COMMIT');
            res.status(200).json({ success: true, data: inserted.rows });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Unsplit error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/update_landuse/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { id, sub_id, Classtype, displayName } = req.body;
        if (!sub_id || !Classtype) {
            return res.status(400).json({ error: 'ID and Classtype are required' });
        }

        const updateReclass = `
            UPDATE reclass_${tb}
            SET "Classtype" = $1, 
                editor = $2
            WHERE sub_id = $3
            RETURNING *`;

        const values = [Classtype, displayName, sub_id];
        const result = await pool.query(updateReclass, values);

        await saveReviewHistoryBySubId(pool, tb, sub_id, 'update_landuse');
        await pool.query(`
            DO $$ BEGIN
                UPDATE reclass_${tb}
                SET check_shape = NULL, reviewer = NULL, review_ts = NULL
                WHERE sub_id = '${sub_id.replace(/'/g, "''")}';
            EXCEPTION WHEN undefined_column THEN NULL; END $$;
        `);

        // Note: No longer updating classified column since it was removed

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }

        res.status(200).json({ success: true, data: result.rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// //reclassify   
app.put('/api/update_geometry/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        const { sub_id, geometry, displayName } = req.body;

        if (!geometry || !sub_id) {
            return res.status(400).json({ error: 'sub_id และ geometry จำเป็นต้องมี' });
        }

        const query = `
            WITH geom_input AS (
                SELECT
                    ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom_wgs,
                    $2::text AS editor,
                    $3::text AS sub_id
            )
            UPDATE reclass_${tb}
            SET
                geom = CASE 
                    WHEN ST_GeometryType(g.geom_wgs) IN ('ST_Polygon', 'ST_MultiPolygon') 
                    THEN ST_Multi(g.geom_wgs)
                    ELSE geom 
                END,
                geom_point = CASE 
                    WHEN ST_GeometryType(g.geom_wgs) = 'ST_Point' 
                    THEN g.geom_wgs
                    WHEN ST_GeometryType(g.geom_wgs) IN ('ST_Polygon', 'ST_MultiPolygon')
                    THEN ST_Centroid(g.geom_wgs)
                    ELSE geom_point
                END,
                shpsplit_sqm = ST_Area(ST_Transform(g.geom_wgs, 32647)),
                editor = g.editor
            FROM geom_input g
            WHERE reclass_${tb}.sub_id = g.sub_id
            RETURNING *;
        `;

        const values = [JSON.stringify(geometry), displayName, sub_id];
        const result = await pool.query(query, values);

        await saveReviewHistoryBySubId(pool, tb, sub_id, 'update_geometry');
        await pool.query(`
            DO $$ BEGIN
                UPDATE reclass_${tb}
                SET check_shape = NULL, reviewer = NULL, review_ts = NULL
                WHERE sub_id = '${sub_id.replace(/'/g, "''")}';
            EXCEPTION WHEN undefined_column THEN NULL; END $$;
        `);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'ไม่พบข้อมูล sub_id นี้' });
        }

        res.status(200).json({ success: true, data: result.rows });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});




app.get('/api/download/reshape/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        const typeFilter = req.query.type; // 'rubber' or 'all_rubber'
        if (!tb) return res.status(400).json({ error: 'Table name is required' });

        let sql;
        // ─── Case 1: Download reclassify (v_reclass_xxx) ───────────────────────────
        if (tb.startsWith('v_reclass_')) {
            const baseTb = tb.replace('v_reclass_', '');
            let extraTypeCondition = '';
            if (typeFilter === 'rubber') {
                extraTypeCondition = `AND LOWER(TRIM(r."Classtype")) = 'rubber'`;
            }

            sql = `
                SELECT json_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE(json_agg(f.feat ORDER BY f.regis_no NULLS LAST) FILTER (WHERE f.feat IS NOT NULL), '[]'::json)
                ) AS geojson
                FROM (
                    SELECT json_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(r.geom)::json,
                        'properties', json_build_object(
                            'Classtype',    CASE r."Classtype"
                                                WHEN 'rubber' THEN 'ยางพาราที่ลงทะเบียน'
                                                WHEN 'Other' THEN 'ไม่ใช่ยางพารา'
                                                ELSE r."Classtype"
                                            END,
                            'Class_Area',    r."Class_Area",
                            'id',           r.id,
                            'Farmer_ID',    TRANSLATE(m."Farmer_ID"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'Land_ID',      m."Land_ID",
                            'Zone',         m."Zone",
                            'Name',         m."Name",
                            'Surname',      m."Surname",
                            'Farm_ID',      m."Farm_ID",
                            'F_Moo',        m."F_Moo",
                            'F_Tam',        m."F_Tam",
                            'F_Amp',        m."F_Amp",
                            'F_Prove',      m."F_Prove",
                            'Rai',          m."Rai",
                            'Land_Type',    m."Land_Type",
                            'Area_Rai',     m."Area_Rai",
                            'Area_Ngan',    m."Area_Ngan",
                            'Area_sqwa',    m."Area_sqwa",
                            'Plant_Year',   m."Plant_Year",
                            'Old_Year',     m."Old_Year",
                            'DEM',          m."DEM",
                            'Class_Age',    m."Class_Age",
                            'Stratum',      m."Stratum",
                            'Area_SqM',     m."Area_SqM",
                            'Rai_Area',     m."Rai_Area",
                            'UTM_East',     m."UTM_East",
                            'UTM_North',    m."UTM_North",
                            'Sqm_Rechac',   m."Sqm_Rechac",
                            'Rai_Rechac',   m."Rai_Rechac",
                            'editor',       r.editor,
                            'ts',           r.ts
                        )
                    ) AS feat,
                    m."Farm_ID" AS regis_no
                    FROM reclass_${baseTb} r
                    JOIN ${baseTb} m ON r.id = m.id
                    WHERE r.geom IS NOT NULL ${extraTypeCondition}
                ) f;
            `;
        }
        // ─── Case 2: Download แปลงยาง (Main Table) ─────────────────────────────────
        else {
            sql = `
                SELECT json_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE(json_agg(f.feat ORDER BY f.regis_no NULLS LAST) FILTER (WHERE f.feat IS NOT NULL), '[]'::json)
                ) AS geojson
                FROM (
                    SELECT json_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(m.geom)::json,
                        'properties', json_build_object(
                            'id',           m.id,
                            'Farmer_ID',    TRANSLATE(m."Farmer_ID"::text, '๐๑๒๓๔๕๖๗๘๙', '0123456789'),
                            'Land_ID',      m."Land_ID",
                            'Zone',         m."Zone",
                            'Name',         m."Name",
                            'Surname',      m."Surname",
                            'Farm_ID',      m."Farm_ID",
                            'F_Moo',        m."F_Moo",
                            'F_Tam',        m."F_Tam",
                            'F_Amp',        m."F_Amp",
                            'F_Prove',      m."F_Prove",
                            'Rai',          m."Rai",
                            'Land_Type',    m."Land_Type",
                            'Area_Rai',     m."Area_Rai",
                            'Area_Ngan',    m."Area_Ngan",
                            'Area_sqwa',    m."Area_sqwa",
                            'Plant_Year',   m."Plant_Year",
                            'Old_Year',     m."Old_Year",
                            'DEM',          m."DEM",
                            'Class_Age',    m."Class_Age",
                            'Stratum',      m."Stratum",
                            'Area_SqM',     m."Area_SqM",
                            'Rai_Area',     m."Rai_Area",
                            'UTM_East',     m."UTM_East",
                            'UTM_North',    m."UTM_North",
                            'Sqm_Rechac',   m."Sqm_Rechac",
                            'Rai_Rechac',   m."Rai_Rechac",
                            'editor',       m.editor,
                            'ts',           m.ts
                        )
                    ) AS feat,
                    m."Farm_ID" AS regis_no
                    FROM ${tb} m
                    WHERE m.geom IS NOT NULL
                ) f;
            `;
        }

        const { rows } = await pool.query(sql);
        const geojson = rows[0]?.geojson || { type: 'FeatureCollection', features: [] };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${tb}.geojson"`);
        res.send(JSON.stringify(geojson));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

async function ensureUsersTable() {
    const { rows } = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users')`
    );
    if (!rows[0].exists) {
        await pool.query(`
            CREATE TABLE users (
                id           SERIAL PRIMARY KEY,
                google_id    TEXT UNIQUE,
                display_name TEXT,
                email        TEXT,
                photo        TEXT,
                role         TEXT NOT NULL DEFAULT 'worker',
                created_at   TIMESTAMP DEFAULT NOW()
            )
        `);
    } else {
        await pool.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'worker'
        `);
    }
}

async function ensureTaskAssignmentColumns() {
    await pool.query(`ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS user_id INTEGER`);
    await pool.query(`ALTER TABLE task_assignments ADD COLUMN IF NOT EXISTS assignee_email TEXT`);
    // Backfill user_id และ assignee_email สำหรับ assignment เก่าที่ยังไม่มีข้อมูล
    // (จับคู่ด้วย display_name เมื่อมีผู้ใช้ชื่อตรงกันเพียงคนเดียว)
    pool.query(`
        UPDATE task_assignments ta
        SET user_id = u.id,
            assignee_email = u.email
        FROM users u
        WHERE ta.user_id IS NULL
          AND ta.assignee_email IS NULL
          AND LOWER(u.display_name) = LOWER(ta.assignee_name)
          AND (SELECT COUNT(*) FROM users u2
               WHERE LOWER(u2.display_name) = LOWER(ta.assignee_name)) = 1
    `).catch(e => console.error('[BACKFILL-ASSIGN]', e.message));
}

app.get('/api/users', async (req, res) => {
    try {
        await ensureUsersTable();
        const result = await pool.query(
            `SELECT id, display_name, email, photo, role, created_at FROM users ORDER BY created_at`
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
})

/* PUT /api/users/:id/role  – เปลี่ยน role ของ user (admin ใช้) */
app.put('/api/users/:id/role', async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        if (!['admin', 'worker'].includes(role)) {
            return res.status(400).json({ error: 'role ต้องเป็น admin หรือ worker' });
        }
        await ensureUsersTable();
        const result = await pool.query(
            `UPDATE users SET role=$1 WHERE id=$2 RETURNING id, display_name, email, role`,
            [role, parseInt(id)]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

/* GET /api/my-assignment/:tb  – ดึง assignment ของผู้ login อยู่ สำหรับ table นั้น */
app.get('/api/my-assignment/:tb', async (req, res) => {
    try {
        const sessionUser = req.session?.user;
        if (!sessionUser) return res.status(401).json({ error: 'Not authenticated' });

        await ensureTaskAssignmentsTable();
        await ensureTaskAssignmentColumns();

        const tb = req.params.tb.toLowerCase();
        const result = await pool.query(
            `SELECT * FROM task_assignments
             WHERE LOWER(tb_name) = $1
               AND (
                 user_id = $2
                 OR LOWER(assignee_email) = LOWER($3)
                 OR (user_id IS NULL AND LOWER(assignee_name) = LOWER($4))
               )
             ORDER BY id_from`,
            [tb, sessionUser.id, sessionUser.email || '', sessionUser.displayName || '']
        );
        const rows = result.rows;
        // Backfill user_id และ email ทันทีที่เจอ เพื่อให้ครั้งต่อไปค้นด้วย id/email ได้เลย
        rows.filter(row => sessionUser.email && (!row.user_id || !row.assignee_email)).forEach(row => {
            pool.query(
                `UPDATE task_assignments SET user_id = $1, assignee_email = $2
                 WHERE id = $3`,
                [sessionUser.id, sessionUser.email, row.id]
            ).catch(e => console.error('[BACKFILL-ROW]', e.message));
        });
        // หนึ่งอีเมลอาจได้รับมอบหมายหลายช่วง ID ในตารางเดียวกัน (เช่น 1-200 และ 601-800)
        // จึงคืนค่าทุกช่วงที่ตรงกัน ไม่ใช่แค่ช่วงแรก
        res.json({ success: true, data: rows[0] || null, assignments: rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/layerlist', async (req, res) => {
    try {
        // Check if layerlist table exists, if not create it
        const checkTableSql = `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'layerlist')`;
        const checkResult = await pool.query(checkTableSql);
        const tableExists = checkResult.rows[0].exists;

        if (!tableExists) {
            const createTableSql = `
                CREATE TABLE layerlist (
                    id SERIAL PRIMARY KEY,
                    tb_name TEXT NOT NULL UNIQUE,
                    remark TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `;
            await pool.query(createTableSql);
        }

        const sql = `SELECT * FROM layerlist`;
        const result = await pool.query(sql);
        // console.log(result.rows);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
})

app.post('/api/layerlist', async (req, res) => {
    try {
        const { tb_name, remark } = req.body;

        const sql = `
        INSERT INTO layerlist (tb_name, remark)
        VALUES ($1, $2)
        RETURNING *`;
        const result = await pool.query(sql, [tb_name, remark]);

        return res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
});

/* PUT /api/layerlist/:tb/displayname
   อัปเดต display name ใน layerlist โดยไม่เปลี่ยน table จริงใน PostgreSQL
   body: { display_name: "PLK" }  ← ชื่อที่ต้องการแสดง (case ตามที่พิมพ์)
*/
app.put('/api/layerlist/:tb/displayname', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        const { display_name } = req.body;

        if (!tb || !display_name) {
            return res.status(400).json({ error: 'tb and display_name are required' });
        }
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(display_name)) {
            return res.status(400).json({ error: 'display_name must start with a letter and contain only letters, numbers and underscores' });
        }
        if (display_name.toLowerCase() !== tb) {
            return res.status(400).json({ error: 'display_name must refer to the same table (same letters, different case only)' });
        }

        const result = await pool.query(
            `UPDATE layerlist SET tb_name = $1, updated_at = NOW() WHERE LOWER(tb_name) = $2 RETURNING *`,
            [display_name, tb]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: `Project "${tb}" not found` });
        }
        return res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
});

app.delete('/api/layerlist/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // drop view
        const sql0 = `DROP VIEW IF EXISTS v_reclass_${tb}`;
        await pool.query(sql0);

        const sql1 = `DELETE FROM layerlist WHERE LOWER(tb_name) = $1 RETURNING *`;
        const result = await pool.query(sql1, [tb]);

        // delete reclass table
        const sql2 = `DROP TABLE IF EXISTS reclass_${tb}`;
        await pool.query(sql2);

        // delete source table
        const sql3 = `DROP TABLE IF EXISTS ${tb}`;
        await pool.query(sql3);

        const sql4 = `DROP TABLE IF EXISTS backup_${tb}`;
        await pool.query(sql4);

        try {
            await pool.query('DELETE FROM task_assignments WHERE LOWER(tb_name) = $1', [tb]);
        } catch (e) {
            console.log('task_assignments table might not exist yet');
        }

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Table not found' });
        }

        return res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/area', async (req, res) => {
    const geojson = req.body;
    const geometry = geojson.geometry || geojson;

    if (!geometry || !geometry.type || !geometry.coordinates) {
        return res.status(400).json({ error: 'Missing or invalid GeoJSON geometry' });
    }

    try {
        // ✅ รองรับทั้ง Polygon และ MultiPolygon
        function getPolygonCentroid(coords, type) {
            let x = 0, y = 0, total = 0;

            if (type === 'Polygon') {
                for (const ring of coords) {
                    for (const [lon, lat] of ring) {
                        x += lon;
                        y += lat;
                        total++;
                    }
                }
            } else if (type === 'MultiPolygon') {
                for (const polygon of coords) {
                    for (const ring of polygon) {
                        for (const [lon, lat] of ring) {
                            x += lon;
                            y += lat;
                            total++;
                        }
                    }
                }
            }

            return total > 0 ? [x / total, y / total] : [null, null];
        }

        function getUTMEPSGCode(lon, lat) {
            const zone = Math.floor((lon + 180) / 6) + 1;
            const isNorthern = lat >= 0;
            return isNorthern ? 32600 + zone : 32700 + zone;
        }

        function getEPSGFromGeoJSON(geojson) {
            const coords = geojson.geometry.coordinates;
            const type = geojson.geometry.type;
            const [lon, lat] = getPolygonCentroid(coords, type);

            if (lon === null || lat === null || isNaN(lon) || isNaN(lat)) {
                return 4326; // fallback
            }

            return getUTMEPSGCode(lon, lat);
        }

        const epsg = getEPSGFromGeoJSON(geojson);
        const geojsonStr = JSON.stringify(geometry);

        const sql = `
            SELECT ST_Area(
                ST_Transform(
                    ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                    ${epsg}
                )
            ) AS area;
        `;

        const { rows } = await pool.query(sql, [geojsonStr]);
        return res.json({ success: true, area: rows[0].area });


    } catch (err) {
        console.error('Error in /api/area:', err);
        return res.status(500).json({ error: err.message });
    }
});

// /api/split removed — unused endpoint



app.post('/api/collected_feat', async (req, res) => {
    try {
        const { id_list, tb, displayName } = req.body;
        if (!Array.isArray(id_list) || id_list.length < 2) {
            return res.status(400).json({ success: false, error: 'ต้องมี polygon อย่างน้อย 2 อัน' });
        }

        const placeholders = id_list.map((_, i) => `$${i + 1}`).join(',');
        const sql = `
            WITH polys AS (
                SELECT ST_Transform(ST_MakeValid(geom), 32647) AS geom_proj
                FROM public.reclass_${tb}
                WHERE sub_id IN (${placeholders}) AND "Classtype"='rubber'
            )
            SELECT 
                ST_AsGeoJSON(ST_Transform(ST_Union(geom_proj), 4326)) AS geom,
                SUM(ST_Area(geom_proj)) AS shpsplit_sqm
            FROM polys;
        `;

        const result = await pool.query(sql, id_list);
        if (!result.rows[0] || !result.rows[0].geom) {
            return res.status(400).json({ success: false, error: 'ไม่สามารถรวม polygon ได้' });
        }

        const geomJSON = JSON.parse(result.rows[0].geom);
        const area = Number(result.rows[0].shpsplit_sqm.toFixed(2));

        await pool.query(
            `UPDATE public.reclass_${tb}
             SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                 shpsplit_sqm = $2,
                 editor = $3
             WHERE sub_id = $4 AND "Classtype"='rubber'`,
            [JSON.stringify(geomJSON), area, displayName, id_list[0]]
        );

        const idsToDelete = id_list.slice(1);
        if (idsToDelete.length > 0) {
            const delPlaceholders = idsToDelete.map((_, i) => `$${i + 1}`).join(',');
            await pool.query(
                `DELETE FROM public.reclass_${tb} WHERE sub_id IN (${delPlaceholders}) AND "Classtype"='rubber'`,
                idsToDelete
            );
        }

        res.json({ success: true, geom: geomJSON, shpsplit_sqm: area });
    } catch (err) {
        console.error('Collected_feat error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Multer configuration for file upload
const upload = multer({ dest: 'uploads/' });

// Helper to normalize properties: lowercase keys, map SHP attributes to new column schema
const normalizeProperties = (props) => {
    const normalized = {};
    const sourceLower = {};
    for (let key in props) {
        sourceLower[key.toLowerCase()] = props[key];
    }

    normalized.OBJECTID   = parseInt(sourceLower.objectid)    || 0;
    normalized.Land_ID    = sourceLower.land_id    || '';
    normalized.Zone       = sourceLower.zone       || '';
    normalized.Name       = sourceLower.name       || '';
    normalized.Surname    = sourceLower.surname    || '';
    normalized.Farm_ID    = sourceLower.farm_id    || '';
    normalized.Farmer_ID  = sourceLower.farmer_id  || sourceLower.id_farmer || '';
    normalized.F_Moo      = sourceLower.f_moo      || '';
    normalized.F_Tam      = sourceLower.f_tam      || '';
    normalized.F_Amp      = sourceLower.f_amp      || '';
    normalized.F_Prove    = sourceLower.f_prove    || '';
    normalized.Rai        = parseFloat(sourceLower.rai)        || 0;
    normalized.Land_Type  = sourceLower.land_type  || '';
    normalized.Area_Rai   = parseFloat(sourceLower.area_rai)   || 0;
    normalized.Area_Ngan  = parseFloat(sourceLower.area_ngan)  || 0;
    normalized.Area_sqwa  = parseFloat(sourceLower.area_sqwa)  || 0;
    normalized.Plant_Year = parseInt(sourceLower.plant_year)   || 0;
    normalized.Old_Year   = parseInt(sourceLower.old_year)     || 0;
    normalized.DEM        = parseFloat(sourceLower.dem)        || 0;
    normalized.Class_Age  = sourceLower.class_age  || '';
    normalized.Stratum    = sourceLower.stratum    || '';
    normalized.Area_SqM   = parseFloat(sourceLower.area_sqm)   || 0;
    normalized.Rai_Area   = parseFloat(sourceLower.rai_area)   || 0;
    normalized.UTM_East   = parseFloat(sourceLower.utm_east)   || 0;
    normalized.UTM_North  = parseFloat(sourceLower.utm_north)  || 0;
    normalized.Sqm_Rechac = parseFloat(sourceLower.sqm_rechac) || 0;
    normalized.Rai_Rechac = parseFloat(sourceLower.rai_rechac) || 0;

    return normalized;
};

// Upload Shapefile endpoint
app.post('/api/upload-shapefile', upload.single('shpFile'), async (req, res) => {
    const { tb_name, geom_type, remark } = req.body;
    const zipFilePath = req.file?.path;

    if (!tb_name || !zipFilePath || !geom_type) {
        return res.status(400).json({ error: 'Table name, geometry type and shapefile are required' });
    }

    const extractDir = path.join('uploads', `extract_${Date.now()}`);

    try {
        await fs.promises.mkdir(extractDir, { recursive: true });
        await new Promise((resolve, reject) => {
            fs.createReadStream(zipFilePath)
                .pipe(unzipper.Extract({ path: extractDir }))
                .on('close', resolve)
                .on('error', reject);
        });

        const findFiles = (dir, ext) => {
            let results = [];
            const list = fs.readdirSync(dir);
            list.forEach(file => {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                if (stat && stat.isDirectory()) {
                    results = results.concat(findFiles(fullPath, ext));
                } else if (fullPath.toLowerCase().endsWith(ext)) {
                    results.push(fullPath);
                }
            });
            return results;
        };

        const shpFiles = findFiles(extractDir, '.shp');
        const dbfFiles = findFiles(extractDir, '.dbf');
        const cpgFiles = findFiles(extractDir, '.cpg');

        if (shpFiles.length === 0) throw new Error('No .shp file found in the ZIP');

        let encoding = 'tis-620'; // Default to Thai encoding
        if (cpgFiles.length > 0) {
            try {
                const cpgContent = fs.readFileSync(cpgFiles[0], 'utf8').trim().toLowerCase();
                if (cpgContent) encoding = cpgContent;
            } catch (e) {
                console.error('Error reading CPG:', e);
            }
        }

        const source = await shapefile.open(shpFiles[0], dbfFiles.length > 0 ? dbfFiles[0] : null, { encoding });
        const features = [];
        let result = await source.read();
        while (!result.done) {
            features.push(result.value);
            result = await source.read();
        }

        if (features.length === 0) throw new Error('No features found in shapefile');

        let useGeomPoint = geom_type === 'point';

        const createTableSql = `
            CREATE TABLE ${tb_name} (
                id             SERIAL PRIMARY KEY,
                "OBJECTID"     integer,
                "Land_ID"      text,
                "Zone"         text,
                "Name"         text,
                "Surname"      text,
                "Farm_ID"      text,
                "Farmer_ID"    text,
                "F_Moo"        text,
                "F_Tam"        text,
                "F_Amp"        text,
                "F_Prove"      text,
                "Rai"          numeric,
                "Land_Type"    text,
                "Area_Rai"     numeric,
                "Area_Ngan"    numeric,
                "Area_sqwa"    numeric,
                "Plant_Year"   integer,
                "Old_Year"     integer,
                "DEM"          numeric,
                "Class_Age"    text,
                "Stratum"      text,
                "Area_SqM"     numeric,
                "Rai_Area"     numeric,
                "UTM_East"     numeric,
                "UTM_North"    numeric,
                "Sqm_Rechac"   numeric,
                "Rai_Rechac"   numeric,
                geom           GEOMETRY(MultiPolygon, 4326),
                geom_point     GEOMETRY(Point, 4326),
                editor         text,
                ts             timestamp DEFAULT NOW()
            );
            CREATE INDEX idx_${tb_name}_geom ON ${tb_name} USING GIST(geom);
            CREATE INDEX idx_${tb_name}_geom_point ON ${tb_name} USING GIST(geom_point);

            CREATE TABLE reclass_${tb_name} (
                fid SERIAL PRIMARY KEY, id INTEGER, sub_id TEXT, farmer_id TEXT, shpsplit_sqm NUMERIC, "Class_Area" NUMERIC, geom GEOMETRY(MultiPolygon, 4326), geom_point GEOMETRY(Point, 4326), "Classtype" TEXT, editor TEXT, ts TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX idx_reclass_${tb_name}_geom ON reclass_${tb_name} USING GIST(geom);

            CREATE VIEW v_reclass_${tb_name} AS SELECT
                a.id,
                a."OBJECTID", a."Land_ID", a."Zone",
                a."Name", a."Surname", a."Farm_ID", a."Farmer_ID",
                a."F_Moo", a."F_Tam", a."F_Amp", a."F_Prove",
                a."Rai", a."Land_Type", a."Area_Rai", a."Area_Ngan", a."Area_sqwa",
                a."Plant_Year", a."Old_Year", a."DEM", a."Class_Age", a."Stratum",
                a."Area_SqM", a."Rai_Area", a."UTM_East", a."UTM_North",
                a."Sqm_Rechac", a."Rai_Rechac",
                a.editor AS a_editor, a.ts AS a_ts,
                r.fid AS reclass_fid, r.sub_id AS reclass_sub_id,
                r.shpsplit_sqm AS r_shpsplit_sqm,
                CASE WHEN r."Classtype" IS NOT NULL THEN r."Class_Area" ELSE NULL END AS "Class_Area",
                r."Classtype",
                r.editor AS reclass_editor, r.ts AS r_ts, r.geom
            FROM ${tb_name} AS a
            JOIN reclass_${tb_name} AS r ON a.id = r.id;
        `;
        await pool.query(`DROP VIEW IF EXISTS v_reclass_${tb_name}`);
        await pool.query(`DROP TABLE IF EXISTS reclass_${tb_name}`);
        await pool.query(`DROP TABLE IF EXISTS ${tb_name}`);
        await pool.query(`DROP TABLE IF EXISTS backup_${tb_name}`);
        try {
            await pool.query(`DELETE FROM task_assignments WHERE tb_name = $1`, [tb_name]);
        } catch (e) { }

        await pool.query(createTableSql);

        // Detect Source SRID (Automatic UTM vs WGS84 detection)
        let sourceSrid = 4326;
        if (features.length > 0 && features[0].geometry) {
            const getFirstCoord = (geom) => {
                if (geom.type === 'Point') return geom.coordinates;
                if (geom.type === 'Polygon') return geom.coordinates[0][0];
                if (geom.type === 'MultiPolygon') return geom.coordinates[0][0][0];
                return null;
            };
            const firstCoord = getFirstCoord(features[0].geometry);
            if (firstCoord && (Math.abs(firstCoord[0]) > 400 || Math.abs(firstCoord[1]) > 400)) {
                sourceSrid = 32647; // Assume UTM Zone 47N (Common for Thailand)
                console.log(`Detected Projected Coordinates. Using source SRID: ${sourceSrid}`);
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            for (let f of features) {
                const norm = normalizeProperties(f.properties);
                const geomJson = JSON.stringify(f.geometry);
                let geomVal, geomPointVal;
                if (geom_type === 'point') {
                    geomPointVal = `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326)`;
                    geomVal = `NULL`;
                } else {
                    geomVal = `ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326))`;
                    geomPointVal = `ST_Centroid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326))`;
                }

                const insertSql = `
                    WITH main_ins AS (
                        INSERT INTO ${tb_name} (
                            "OBJECTID", "Land_ID", "Zone", "Name", "Surname",
                            "Farm_ID", "Farmer_ID", "F_Moo", "F_Tam", "F_Amp", "F_Prove",
                            "Rai", "Land_Type", "Area_Rai", "Area_Ngan", "Area_sqwa",
                            "Plant_Year", "Old_Year", "DEM", "Class_Age", "Stratum",
                            "Area_SqM", "Rai_Area", "UTM_East", "UTM_North",
                            "Sqm_Rechac", "Rai_Rechac",
                            geom, geom_point
                        )
                        VALUES (
                            $2,$3,$4,$5,$6,
                            $7,$8,$9,$10,$11,$12,
                            $13,$14,$15,$16,$17,
                            $18,$19,$20,$21,$22,
                            $23,$24,$25,$26,
                            $27,$28,
                            ${geomVal}, ${geomPointVal}
                        )
                        RETURNING id, "Farmer_ID" AS farmer_id, "Sqm_Rechac" AS shpsplit_sqm, geom, geom_point
                    )
                    INSERT INTO reclass_${tb_name} (id, sub_id, farmer_id, shpsplit_sqm, "Class_Area", geom, geom_point, "Classtype")
                    SELECT id, id::text, farmer_id, shpsplit_sqm, NULL, geom, geom_point, NULL FROM main_ins;
                `;
                const params = [
                    geomJson,
                    norm.OBJECTID, norm.Land_ID, norm.Zone, norm.Name, norm.Surname,
                    norm.Farm_ID, norm.Farmer_ID, norm.F_Moo, norm.F_Tam, norm.F_Amp, norm.F_Prove,
                    norm.Rai, norm.Land_Type, norm.Area_Rai, norm.Area_Ngan, norm.Area_sqwa,
                    norm.Plant_Year, norm.Old_Year, norm.DEM, norm.Class_Age, norm.Stratum,
                    norm.Area_SqM, norm.Rai_Area, norm.UTM_East, norm.UTM_North,
                    norm.Sqm_Rechac, norm.Rai_Rechac
                ];
                await client.query(insertSql, params);
            }
            await client.query('COMMIT');

            await pool.query(`INSERT INTO layerlist (tb_name, remark) VALUES ($1, $2) ON CONFLICT (tb_name) DO UPDATE SET updated_at = NOW()`, [tb_name, remark || `${geom_type} layer`]);

            // ── AUTO BACKUP: copy main table → backup_{tb_name} ──────────────────
            try {
                await pool.query(`DROP TABLE IF EXISTS backup_${tb_name}`);
                await pool.query(`CREATE TABLE backup_${tb_name} AS SELECT * FROM ${tb_name}`);
                await pool.query(`ALTER TABLE backup_${tb_name} ADD COLUMN backup_at TIMESTAMPTZ DEFAULT NOW()`);
                await pool.query(`UPDATE backup_${tb_name} SET backup_at = NOW()`);
                console.log(`[BACKUP] Created backup_${tb_name} with ${features.length} rows`);
            } catch (backupErr) {
                console.error('[BACKUP] Warning: backup table creation failed:', backupErr.message);
                // ไม่ throw error เพื่อไม่ให้กระทบ response หลัก
            }
            // ─────────────────────────────────────────────────────────────────────

            res.json({ success: true, message: 'Shapefile uploaded successfully', recordCount: features.length, tableName: tb_name });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
});

app.get('/api/export-sql', async (req, res) => {
    try {
        const { exec } = require('child_process');
        const fileName = `${process.env.DB_NAME || 'rub_v3'}.sql`;
        const filePath = path.join(__dirname, '..', 'uploads', fileName);
        if (!fs.existsSync(path.join(__dirname, '..', 'uploads'))) fs.mkdirSync(path.join(__dirname, '..', 'uploads'));
        process.env.PGPASSWORD = process.env.DB_PASSWORD;
        const command = `pg_dump -h ${process.env.DB_HOST} -U ${process.env.DB_USER} -d ${process.env.DB_NAME} -f "${filePath}"`;
        exec(command, (error) => {
            if (error) return res.status(500).json({ error: 'Failed' });
            res.download(filePath, fileName);
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ────────────────────────────────────────────────────────────
   NEW: Create Project – build empty table from template
   POST /api/create-project
   body: { tb_name: "champhon_earn", remark: "..." }
──────────────────────────────────────────────────────────── */
app.post('/api/create-project', async (req, res) => {
    const { tb_name, remark } = req.body;

    if (!tb_name) {
        return res.status(400).json({ error: 'tb_name is required' });
    }

    // Validate table name (letters, numbers, underscore — case insensitive input)
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(tb_name)) {
        return res.status(400).json({ error: 'Table name must start with a letter and contain only letters, numbers and underscores' });
    }

    // Use lowercase only for PostgreSQL table/index/view identifiers (PG folds unquoted identifiers)
    // Original tb_name is preserved for display in layerlist
    const safe_name = tb_name.toLowerCase();

    try {
        // Check for duplicate project name (case-insensitive)
        const dupCheck = await pool.query('SELECT tb_name FROM layerlist WHERE LOWER(tb_name) = $1', [safe_name]);
        if (dupCheck.rows.length > 0) {
            return res.status(409).json({ error: `ชื่อ Project "${dupCheck.rows[0].tb_name}" มีอยู่แล้ว กรุณาใช้ชื่ออื่น` });
        }

        // Drop existing objects first (idempotent re-create)
        await pool.query(`DROP VIEW IF EXISTS v_reclass_${safe_name}`);
        await pool.query(`DROP TABLE IF EXISTS reclass_${safe_name}`);
        await pool.query(`DROP TABLE IF EXISTS ${safe_name}`);
        await pool.query(`DROP TABLE IF EXISTS backup_${safe_name}`);
        try {
            await pool.query(`DELETE FROM task_assignments WHERE LOWER(tb_name) = $1`, [safe_name]);
        } catch (e) { }

        // Create main rubber table with full template schema
        const createMainTable = `
            CREATE TABLE ${safe_name} (
                id             SERIAL PRIMARY KEY,
                "OBJECTID"     integer,
                "Land_ID"      text,
                "Zone"         text,
                "Name"         text,
                "Surname"      text,
                "Farm_ID"      text,
                "Farmer_ID"    text,
                "F_Moo"        text,
                "F_Tam"        text,
                "F_Amp"        text,
                "F_Prove"      text,
                "Rai"          numeric,
                "Land_Type"    text,
                "Area_Rai"     numeric,
                "Area_Ngan"    numeric,
                "Area_sqwa"    numeric,
                "Plant_Year"   integer,
                "Old_Year"     integer,
                "DEM"          numeric,
                "Class_Age"    text,
                "Stratum"      text,
                "Area_SqM"     numeric,
                "Rai_Area"     numeric,
                "UTM_East"     numeric,
                "UTM_North"    numeric,
                "Sqm_Rechac"   numeric,
                "Rai_Rechac"   numeric,
                geom           GEOMETRY(MultiPolygon, 4326),
                geom_point     GEOMETRY(Point, 4326),
                editor         text,
                ts             timestamp DEFAULT NOW()
            );
            CREATE INDEX idx_${safe_name}_geom       ON ${safe_name} USING GIST(geom);
            CREATE INDEX idx_${safe_name}_geom_point ON ${safe_name} USING GIST(geom_point);
        `;
        await pool.query(createMainTable);

        // Create companion reclass table
        const createReclassTable = `
            CREATE TABLE reclass_${safe_name} (
                fid          SERIAL PRIMARY KEY,
                id           INTEGER,
                sub_id       TEXT,
                farmer_id    TEXT,
                shpsplit_sqm NUMERIC,
                "Class_Area" NUMERIC,
                geom         GEOMETRY(MultiPolygon, 4326),
                geom_point   GEOMETRY(Point, 4326),
                "Classtype"  TEXT,
                editor       TEXT,
                ts           TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX idx_reclass_${safe_name}_geom ON reclass_${safe_name} USING GIST(geom);
        `;
        await pool.query(createReclassTable);

        // Create view
        const createView = `
            CREATE VIEW v_reclass_${safe_name} AS
            SELECT
                a.id,
                a."OBJECTID", a."Land_ID", a."Zone",
                a."Name", a."Surname", a."Farm_ID", a."Farmer_ID",
                a."F_Moo", a."F_Tam", a."F_Amp", a."F_Prove",
                a."Rai", a."Land_Type", a."Area_Rai", a."Area_Ngan", a."Area_sqwa",
                a."Plant_Year", a."Old_Year", a."DEM", a."Class_Age", a."Stratum",
                a."Area_SqM", a."Rai_Area", a."UTM_East", a."UTM_North",
                a."Sqm_Rechac", a."Rai_Rechac",
                a.editor AS a_editor, a.ts AS a_ts,
                r.fid AS reclass_fid, r.sub_id AS reclass_sub_id,
                r.shpsplit_sqm AS r_shpsplit_sqm,
                CASE WHEN r."Classtype" IS NOT NULL THEN r."Class_Area" ELSE NULL END AS "Class_Area",
                r."Classtype",
                r.editor AS reclass_editor, r.ts AS r_ts, r.geom
            FROM ${safe_name} AS a
            JOIN reclass_${safe_name} AS r ON a.id = r.id;
        `;
        await pool.query(createView);

        // Register in layerlist with original case (idempotent – skip if already exists)
        await pool.query(
            `INSERT INTO layerlist (tb_name, remark)
             VALUES ($1, $2)
             ON CONFLICT (tb_name) DO UPDATE SET remark = EXCLUDED.remark, updated_at = NOW()`,
            [tb_name, remark || '']
        );

        res.json({ success: true, tb_name });
    } catch (err) {
        console.error('create-project error:', err);
        res.status(500).json({ error: err.message });
    }
});

/* ────────────────────────────────────────────────────────────
   NEW: Upload shapefile to an EXISTING table
   POST /api/upload-shapefile-to-table
   multipart: shpFile (ZIP), tb_name, geom_type (polygon|point)

   • polygon → stored in  geom        column (MultiPolygon 4326)
   • point   → stored in  geom_point  column (Point 4326)
──────────────────────────────────────────────────────────── */
app.post('/api/upload-shapefile-to-table', upload.single('shpFile'), async (req, res) => {
    const { tb_name, geom_type } = req.body;
    const zipFilePath = req.file?.path;

    if (!tb_name || !zipFilePath || !geom_type) {
        return res.status(400).json({ error: 'tb_name, geom_type and shapefile are required' });
    }
    if (!['polygon', 'point'].includes(geom_type)) {
        return res.status(400).json({ error: 'geom_type must be polygon or point' });
    }

    // PostgreSQL table names are always lowercase (PG folds unquoted identifiers)
    const safe_name = tb_name.toLowerCase();

    const extractDir = path.join('uploads', `extract_${Date.now()}`);

    try {
        // Check table exists (use lowercase for PostgreSQL catalog lookup)
        const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [safe_name]
        );
        if (!tableCheck.rows[0].exists) {
            return res.status(404).json({ error: `Table "${tb_name}" not found. Please create the project first.` });
        }

        // Ensure reclass table has required columns before uploading
        await pool.query(`
            DO $$ BEGIN
                ALTER TABLE reclass_${safe_name} ADD COLUMN "Class_Area" numeric;
            EXCEPTION
                WHEN duplicate_column THEN NULL;
                WHEN undefined_table THEN NULL;
            END $$;
        `);
        await pool.query(`
            DO $$ BEGIN
                ALTER TABLE reclass_${safe_name} ADD COLUMN "Classtype" text;
            EXCEPTION
                WHEN duplicate_column THEN NULL;
                WHEN undefined_table THEN NULL;
            END $$;
        `);

        await fs.promises.mkdir(extractDir, { recursive: true });
        await new Promise((resolve, reject) => {
            fs.createReadStream(zipFilePath)
                .pipe(unzipper.Extract({ path: extractDir }))
                .on('close', resolve)
                .on('error', reject);
        });

        const findFiles = (dir, ext) => {
            let results = [];
            const list = fs.readdirSync(dir);
            list.forEach(file => {
                const fullPath = path.join(dir, file);
                const stat = fs.statSync(fullPath);
                if (stat && stat.isDirectory()) {
                    results = results.concat(findFiles(fullPath, ext));
                } else if (fullPath.toLowerCase().endsWith(ext)) {
                    results.push(fullPath);
                }
            });
            return results;
        };

        const shpFiles = findFiles(extractDir, '.shp');
        const dbfFiles = findFiles(extractDir, '.dbf');
        const cpgFiles = findFiles(extractDir, '.cpg');

        if (shpFiles.length === 0) throw new Error('No .shp file found in the ZIP');

        let encoding = 'tis-620';
        if (cpgFiles.length > 0) {
            try {
                const cpgContent = fs.readFileSync(cpgFiles[0], 'utf8').trim().toLowerCase();
                if (cpgContent) encoding = cpgContent;
            } catch (e) { }
        }

        const source = await shapefile.open(shpFiles[0], dbfFiles.length > 0 ? dbfFiles[0] : null, { encoding });
        const features = [];
        let result = await source.read();
        while (!result.done) {
            features.push(result.value);
            result = await source.read();
        }
        if (features.length === 0) throw new Error('No features found in shapefile');

        // Detect source SRID
        let sourceSrid = 4326;
        if (features.length > 0 && features[0].geometry) {
            const getFirstCoord = (geom) => {
                if (geom.type === 'Point') return geom.coordinates;
                if (geom.type === 'Polygon') return geom.coordinates[0][0];
                if (geom.type === 'MultiPolygon') return geom.coordinates[0][0][0];
                return null;
            };
            const firstCoord = getFirstCoord(features[0].geometry);
            if (firstCoord && (Math.abs(firstCoord[0]) > 400 || Math.abs(firstCoord[1]) > 400)) {
                sourceSrid = 32647;
            }
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (let f of features) {
                const norm = normalizeProperties(f.properties);
                const geomJson = JSON.stringify(f.geometry);

                let geomVal, geomPointVal;
                if (geom_type === 'point') {
                    geomPointVal = `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326)`;
                    geomVal = `NULL`;
                } else {
                    geomVal = `ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326))`;
                    geomPointVal = `ST_Centroid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326))`;
                }

                const insertSql = `
                    WITH main_ins AS (
                        INSERT INTO ${safe_name} (
                            "OBJECTID", "Land_ID", "Zone", "Name", "Surname",
                            "Farm_ID", "Farmer_ID", "F_Moo", "F_Tam", "F_Amp", "F_Prove",
                            "Rai", "Land_Type", "Area_Rai", "Area_Ngan", "Area_sqwa",
                            "Plant_Year", "Old_Year", "DEM", "Class_Age", "Stratum",
                            "Area_SqM", "Rai_Area", "UTM_East", "UTM_North",
                            "Sqm_Rechac", "Rai_Rechac",
                            geom, geom_point
                        )
                        VALUES (
                            $2,$3,$4,$5,$6,
                            $7,$8,$9,$10,$11,$12,
                            $13,$14,$15,$16,$17,
                            $18,$19,$20,$21,$22,
                            $23,$24,$25,$26,
                            $27,$28,
                            ${geomVal}, ${geomPointVal}
                        )
                        RETURNING id, "Farmer_ID" AS farmer_id, "Sqm_Rechac" AS shpsplit_sqm, geom, geom_point
                    )
                    INSERT INTO reclass_${safe_name} (id, sub_id, farmer_id, shpsplit_sqm, "Class_Area", geom, geom_point, "Classtype")
                    SELECT id, id::text, farmer_id, shpsplit_sqm, NULL, geom, geom_point, NULL FROM main_ins;
                `;
                const params = [
                    geomJson,
                    norm.OBJECTID, norm.Land_ID, norm.Zone, norm.Name, norm.Surname,
                    norm.Farm_ID, norm.Farmer_ID, norm.F_Moo, norm.F_Tam, norm.F_Amp, norm.F_Prove,
                    norm.Rai, norm.Land_Type, norm.Area_Rai, norm.Area_Ngan, norm.Area_sqwa,
                    norm.Plant_Year, norm.Old_Year, norm.DEM, norm.Class_Age, norm.Stratum,
                    norm.Area_SqM, norm.Rai_Area, norm.UTM_East, norm.UTM_North,
                    norm.Sqm_Rechac, norm.Rai_Rechac
                ];
                await client.query(insertSql, params);
            }

            await client.query('COMMIT');

            // ── AUTO BACKUP: upsert new rows into backup_{safe_name} ────────────
            try {
                // ตรวจสอบว่า backup table มีแล้วหรือยัง
                const bkCheck = await pool.query(
                    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
                    [`backup_${safe_name}`]
                );
                if (!bkCheck.rows[0].exists) {
                    // สร้าง backup table ใหม่จาก structure ของ main table + คอลัมน์ backup_at
                    await pool.query(`CREATE TABLE backup_${safe_name} AS SELECT * FROM ${safe_name} WHERE FALSE`);
                    await pool.query(`ALTER TABLE backup_${safe_name} ADD COLUMN backup_at TIMESTAMPTZ DEFAULT NOW()`);
                }

                // เพิ่มข้อมูลที่ upload ใหม่ล่าสุดเข้า backup (rows ที่ไม่มีใน backup)
                const backupInsertResult = await pool.query(`
                    INSERT INTO backup_${safe_name}
                    SELECT m.*, NOW() AS backup_at
                    FROM ${safe_name} m
                    WHERE NOT EXISTS (
                        SELECT 1 FROM backup_${safe_name} b WHERE b.id = m.id
                    )
                `);
                console.log(`[BACKUP] Appended ${backupInsertResult.rowCount} new rows to backup_${safe_name}`);
            } catch (backupErr) {
                console.error('[BACKUP] Warning: backup append failed:', backupErr.message);
                // ไม่ throw error เพื่อไม่ให้กระทบ response หลัก
            }
            // ─────────────────────────────────────────────────────────────────────

            res.json({
                success: true,
                message: 'Shapefile uploaded successfully',
                recordCount: features.length,
                tableName: tb_name,
                geomType: geom_type
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('upload-shapefile-to-table error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
});

// ════════════════════════════════════════════════════════════
// BACKUP API ENDPOINTS
// ════════════════════════════════════════════════════════════

/**
 * GET /api/backup/:tb
 * ดูข้อมูลทั้งหมดใน backup table ของ tb
 */
app.get('/api/backup/:tb', async (req, res) => {
    let { tb } = req.params;
    tb = tb.toLowerCase();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
        return res.status(400).json({ error: 'Invalid table name' });
    }
    try {
        const checkResult = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [`backup_${tb}`]
        );
        if (!checkResult.rows[0].exists) {
            return res.status(404).json({ success: false, error: `Backup table backup_${tb} not found` });
        }
        const result = await pool.query(`SELECT * FROM backup_${tb} ORDER BY id`);
        res.json({ success: true, count: result.rowCount, data: result.rows });
    } catch (err) {
        console.error('[BACKUP] GET error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/restore-from-backup/:tb/:id
 * restore แถวที่มี id=$id จาก backup_tb กลับไปยัง tb
 *
 * กรณีที่ 1 – id หายไปจาก tb (ถูกลบ):
 *   → INSERT แถวกลับเข้า main table ด้วยค่าต้นฉบับจาก backup ทั้งหมด
 *   → INSERT เข้า reclass_tb ด้วย shpsplit_sqm = shparea_sq (ค่าต้นฉบับ)
 *
 * กรณีที่ 2 – id ยังมีอยู่ใน tb แต่ต้องการ reset ค่าเนื้อที่กลับเป็นต้นฉบับ:
 *   → UPDATE shparea_sq, geom, geom_point ใน main table จาก backup
 *   → UPDATE shpsplit_sqm ใน reclass_tb ด้วยค่าต้นฉบับจาก backup
 *
 * Query param: ?mode=reset  → บังคับ reset ค่าแม้ id ยังอยู่
 */
app.post('/api/restore-from-backup/:tb/:id', async (req, res) => {
    let { tb, id } = req.params;
    tb = tb.toLowerCase();
    const mode = req.query.mode || 'auto'; // 'auto' | 'reset'

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
        return res.status(400).json({ error: 'Invalid table name' });
    }
    const featureId = parseInt(id, 10);
    if (isNaN(featureId)) {
        return res.status(400).json({ error: 'ID must be a number' });
    }
    try {
        // ── ตรวจสอบว่า backup table มีอยู่ ──────────────────────────────────────
        const backupCheck = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [`backup_${tb}`]
        );
        if (!backupCheck.rows[0].exists) {
            return res.status(404).json({ success: false, error: `Backup table backup_${tb} not found` });
        }

        // ── ดึงแถวต้นฉบับจาก backup ────────────────────────────────────────────
        const backupRow = await pool.query(
            `SELECT *, ST_AsGeoJSON(geom) AS geom_json FROM backup_${tb} WHERE id = $1 LIMIT 1`,
            [featureId]
        );
        if (backupRow.rowCount === 0) {
            return res.status(404).json({ success: false, error: `ID ${featureId} not found in backup_${tb}` });
        }
        const bk = backupRow.rows[0];
        const originalShparea = bk['Sqm_Rechac']; // ค่าเนื้อที่ขณะนี้ (ต้นฉบับ)

        // ── ตรวจสอบว่า id ยังมีอยู่ใน main table หรือไม่ ──────────────────────
        const mainRow = await pool.query(`SELECT id FROM ${tb} WHERE id = $1`, [featureId]);
        const idExists = mainRow.rowCount > 0;

        let restoredRow = null;
        let actionTaken = '';

        if (!idExists) {
            // ════ กรณีที่ 1: id หายไป → INSERT กลับด้วยค่าต้นฉบับทั้งหมด ═══════

            // ดึงคอลัมน์ใน main table (ไม่รวม backup_at)
            const colsResult = await pool.query(
                `SELECT column_name FROM information_schema.columns
                 WHERE table_schema='public' AND table_name=$1
                 ORDER BY ordinal_position`,
                [tb]
            );
            const mainCols = colsResult.rows.map(r => r.column_name);
            const colList = mainCols.join(', ');

            const restoreResult = await pool.query(`
                INSERT INTO ${tb} (${colList})
                SELECT ${colList}
                FROM backup_${tb}
                WHERE id = $1
                ON CONFLICT (id) DO NOTHING
                RETURNING *
            `, [featureId]);

            if (restoreResult.rowCount === 0) {
                return res.status(409).json({ success: false, error: `ID ${featureId} conflict during insert, restore skipped.` });
            }
            restoredRow = restoreResult.rows[0];
            actionTaken = 'inserted';

        } else if (mode === 'reset') {
            // ════ กรณีที่ 2: id มีอยู่ + mode=reset → UPDATE ค่ากลับเป็นต้นฉบับ ═

            const updateResult = await pool.query(`
                UPDATE ${tb}
                SET "Sqm_Rechac" = b."Sqm_Rechac",
                    geom         = b.geom,
                    geom_point   = b.geom_point
                FROM backup_${tb} b
                WHERE ${tb}.id = $1
                  AND b.id     = $1
                RETURNING ${tb}.*
            `, [featureId]);

            restoredRow = updateResult.rows[0];
            actionTaken = 'reset';

        } else {
            // id มีอยู่ ไม่ได้ส่ง mode=reset
            return res.status(409).json({
                success: false,
                error: `ID ${featureId} already exists in ${tb}. ส่ง ?mode=reset เพื่อ reset ค่าเนื้อที่กลับเป็นต้นฉบับ`,
                hint: `POST /api/restore-from-backup/${tb}/${featureId}?mode=reset`
            });
        }

        // ── Sync reclass_tb: อัปเดต shpsplit_sqm ด้วยค่าต้นฉบับจาก backup ─────
        const reclassCheck = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [`reclass_${tb}`]
        );
        let reclassRestored = 0;
        if (reclassCheck.rows[0].exists) {
            const reclassExists = await pool.query(
                `SELECT id FROM reclass_${tb} WHERE id = $1 LIMIT 1`,
                [featureId]
            );

            if (reclassExists.rowCount === 0) {
                // ไม่มีใน reclass → INSERT row ใหม่ด้วยค่าต้นฉบับ
                await pool.query(`
                    INSERT INTO reclass_${tb} (id, sub_id, farmer_id, shpsplit_sqm, "Class_Area", geom, "Classtype")
                    VALUES ($1, $2::text, $3, $4, NULL, ST_GeomFromGeoJSON($5), NULL)
                    ON CONFLICT DO NOTHING
                `, [
                    featureId,
                    featureId.toString(),
                    restoredRow['Farmer_ID'],
                    originalShparea,
                    restoredRow.geom
                ]);
                reclassRestored = 1;
            } else {
                // มีอยู่ใน reclass → UPDATE shpsplit_sqm กลับเป็นค่าต้นฉบับ
                await pool.query(`
                    UPDATE reclass_${tb}
                    SET shpsplit_sqm = $1, "Class_Area" = ROUND(($1::numeric / 1600.0), 2),
                        geom        = $2
                    WHERE id = $3
                      AND (sub_id = $4 OR sub_id = $3::text)
                `, [
                    originalShparea,           // ← ค่าเนื้อที่ต้นฉบับจาก backup
                    restoredRow.geom,
                    featureId,
                    featureId.toString()
                ]);
                reclassRestored = 1;
            }
        }

        res.json({
            success: true,
            action: actionTaken,
            message: `ID ${featureId} ${actionTaken} from backup_${tb} (shparea_sq = ${originalShparea})`,
            originalShparea,
            restored: restoredRow,
            reclassRestored
        });
    } catch (err) {
        console.error('[BACKUP] restore error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});


/**
 * GET /api/backup-diff/:tb
 * เปรียบเทียบ ids ที่อยู่ใน backup แต่หายไปจาก main table
 * ช่วยให้รู้ว่า id ไหนบ้างที่หาย
 */
app.get('/api/backup-diff/:tb', async (req, res) => {
    let { tb } = req.params;
    tb = tb.toLowerCase();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
        return res.status(400).json({ error: 'Invalid table name' });
    }
    try {
        const backupCheck = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [`backup_${tb}`]
        );
        if (!backupCheck.rows[0].exists) {
            return res.status(404).json({ success: false, error: `Backup table backup_${tb} not found` });
        }

        // หา id ที่อยู่ใน backup แต่ไม่มีใน main table
        const diffResult = await pool.query(`
            SELECT b.id, b."Farmer_ID", b."Name", b."Surname", b.backup_at
            FROM backup_${tb} b
            WHERE NOT EXISTS (
                SELECT 1 FROM ${tb} m WHERE m.id = b.id
            )
            ORDER BY b.id
        `);

        res.json({
            success: true,
            missingCount: diffResult.rowCount,
            missingIds: diffResult.rows
        });
    } catch (err) {
        console.error('[BACKUP] diff error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* ══════════════════════════════════════════════════════════════
   TASK ASSIGNMENT APIs
   เก็บ assignment ของแต่ละคนต่อ table (tb_name, assignee, id_from, id_to)
══════════════════════════════════════════════════════════════ */

async function ensureTaskAssignmentsTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS task_assignments (
            id        SERIAL PRIMARY KEY,
            tb_name   TEXT NOT NULL,
            assignee_name  TEXT NOT NULL,
            assignee_photo TEXT,
            id_from   INTEGER NOT NULL,
            id_to     INTEGER NOT NULL,
            note      TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
}

/* GET /api/task-assignments/:tb  – ดึง assignments ของ table นั้น */
app.get('/api/task-assignments/:tb', async (req, res) => {
    try {
        await ensureTaskAssignmentsTable();
        const tb = req.params.tb.toLowerCase();
        const result = await pool.query(
            `SELECT * FROM task_assignments WHERE LOWER(tb_name) = $1 ORDER BY id_from`,
            [tb]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/task-assignments-all  – ดึง assignments ทั้งหมด */
app.get('/api/task-assignments-all', async (req, res) => {
    try {
        await ensureTaskAssignmentsTable();
        const result = await pool.query(
            `SELECT * FROM task_assignments ORDER BY tb_name, id_from`
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* POST /api/task-assignments  – สร้าง assignment ใหม่ */
app.post('/api/task-assignments', async (req, res) => {
    try {
        await ensureTaskAssignmentsTable();
        await ensureTaskAssignmentColumns();
        const { tb_name, assignee_name, assignee_email, assignee_photo, user_id, id_from, id_to, note } = req.body;
        if (!tb_name || !assignee_name || id_from == null || id_to == null) {
            return res.status(400).json({ error: 'tb_name, assignee_name, id_from, id_to are required' });
        }
        if (parseInt(id_from) > parseInt(id_to)) {
            return res.status(400).json({ error: 'id_from must be <= id_to' });
        }
        const result = await pool.query(
            `INSERT INTO task_assignments (tb_name, assignee_name, assignee_email, assignee_photo, user_id, id_from, id_to, note)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [tb_name, assignee_name, assignee_email || null, assignee_photo || null,
             user_id ? parseInt(user_id) : null, parseInt(id_from), parseInt(id_to), note || null]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* PUT /api/task-assignments/:id  – อัปเดต assignment */
app.put('/api/task-assignments/:id', async (req, res) => {
    try {
        await ensureTaskAssignmentsTable();
        await ensureTaskAssignmentColumns();
        const { id } = req.params;
        const { assignee_name, assignee_email, assignee_photo, user_id, id_from, id_to, note } = req.body;
        if (!assignee_name || id_from == null || id_to == null) {
            return res.status(400).json({ error: 'assignee_name, id_from, id_to are required' });
        }
        if (parseInt(id_from) > parseInt(id_to)) {
            return res.status(400).json({ error: 'id_from must be <= id_to' });
        }
        const result = await pool.query(
            `UPDATE task_assignments
             SET assignee_name=$1, assignee_email=$2, assignee_photo=$3, user_id=$4,
                 id_from=$5, id_to=$6, note=$7, updated_at=NOW()
             WHERE id=$8
             RETURNING *`,
            [assignee_name, assignee_email || null, assignee_photo || null,
             user_id ? parseInt(user_id) : null,
             parseInt(id_from), parseInt(id_to), note || null, parseInt(id)]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Assignment not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* DELETE /api/task-assignments/:id  – ลบ assignment */
app.delete('/api/task-assignments/:id', async (req, res) => {
    try {
        await ensureTaskAssignmentsTable();
        const { id } = req.params;
        const result = await pool.query(
            `DELETE FROM task_assignments WHERE id=$1 RETURNING id`,
            [parseInt(id)]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Assignment not found' });
        res.json({ success: true, deleted: parseInt(id) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/task-progress/:tb
   คำนวณ progress ของแต่ละ assignment โดยนับ ID ที่ classified=true ในช่วง id_from..id_to
   พร้อม editor คนล่าสุดใน reclass_<tb> และ ts ล่าสุด */
app.get('/api/task-progress/:tb', async (req, res) => {
    try {
        await ensureTaskAssignmentsTable();
        const tb = req.params.tb.toLowerCase();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        // ดึง assignments ของ table นี้
        const assignRes = await pool.query(
            `SELECT id, assignee_name, assignee_photo, id_from, id_to, note
             FROM task_assignments WHERE LOWER(tb_name) = $1 ORDER BY id_from`,
            [tb]
        );
        if (assignRes.rowCount === 0) {
            return res.json({ success: true, data: [] });
        }

        // ตรวจว่า reclass table มีอยู่
        const reclassCheck = await pool.query(
            `SELECT EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name=$1)`,
            [`reclass_${tb}`]
        );
        const hasReclass = reclassCheck.rows[0].exists;

        // สร้าง progress สำหรับแต่ละ assignment
        const progressData = await Promise.all(assignRes.rows.map(async (a) => {
            const total = a.id_to - a.id_from + 1;

            // นับ classified
            let done = 0;
            if (hasReclass) {
                const doneRes = await pool.query(
                    `SELECT COUNT(DISTINCT r.id) AS cnt FROM ${tb} m
                     JOIN reclass_${tb} r ON m.id = r.id
                     WHERE m.id >= $1 AND m.id <= $2 AND r."Classtype" IS NOT NULL`,
                    [a.id_from, a.id_to]
                );
                done = parseInt(doneRes.rows[0].cnt) || 0;
            }

            // หา editor + ts ล่าสุดจาก reclass table
            let last_editor = null;
            let last_ts = null;
            if (hasReclass) {
                const editorRes = await pool.query(
                    `SELECT editor, ts FROM reclass_${tb}
                     WHERE id >= $1 AND id <= $2
                       AND editor IS NOT NULL
                     ORDER BY ts DESC LIMIT 1`,
                    [a.id_from, a.id_to]
                );
                if (editorRes.rowCount > 0) {
                    last_editor = editorRes.rows[0].editor;
                    last_ts = editorRes.rows[0].ts;
                }
            }

            return {
                ...a,
                total,
                done,
                pct: total > 0 ? Math.round((done / total) * 100) : 0,
                last_editor,
                last_ts
            };
        }));

        res.json({ success: true, data: progressData });
    } catch (err) {
        console.error('[TASK-PROGRESS]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* ── Helper: แปลง sqm → { total_sqm, area_rai, area_ngan, area_sqwa, area_rai_decimal } ── */
function toAreaObj(sqm) {
    const s = parseFloat(sqm) || 0;
    if (s <= 0) return { total_sqm: 0, area_rai: 0, area_ngan: 0, area_sqwa: 0, area_rai_decimal: 0 };
    const rai = Math.floor(s / 1600);
    const rem = s - rai * 1600;
    return {
        total_sqm: parseFloat(s.toFixed(2)),
        area_rai: rai,
        area_ngan: Math.floor(rem / 400),
        area_sqwa: Math.floor((rem % 400) / 4),
        area_rai_decimal: parseFloat((s / 1600).toFixed(4))
    };
}
const emptyArea = { total_sqm: 0, area_rai: 0, area_ngan: 0, area_sqwa: 0, area_rai_decimal: 0 };

/* GET /api/worker-summary-all
   สรุปงานต่อคนข้ามทุก table ใน layerlist แบ่ง 3 หมวด:
   reshape (โฉนด), reclass_all, reclass_rubber (เฉพาะยางพาราลงทะเบียน) */
app.get('/api/worker-summary-all', async (req, res) => {
    try {
        const layersRes = await pool.query(`SELECT tb_name FROM layerlist ORDER BY created_at`);
        const usersRes = await pool.query(`SELECT display_name, photo FROM users`);
        const photoMap = {};
        usersRes.rows.forEach(u => { photoMap[u.display_name] = u.photo; });

        const editorMap = {};
        const ensureEditor = (name) => {
            if (!editorMap[name]) {
                editorMap[name] = {
                    editor: name,
                    photo: photoMap[name] || null,
                    projects: [],
                    reshape:        { ...emptyArea, farmer_count: 0 },
                    reclass_all:    { ...emptyArea, sub_plot_count: 0, farmer_count: 0 },
                    reclass_rubber: { ...emptyArea, sub_plot_count: 0, farmer_count: 0 }
                };
            }
        };

        for (const layer of layersRes.rows) {
            const tb = layer.tb_name.toLowerCase();
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) continue;

            // ── Reshape from main table ──
            const mainReshapeRows = await pool.query(`
                SELECT editor,
                    COUNT(*) AS farmer_count,
                    ROUND(COALESCE(SUM("Sqm_Rechac"), 0)::numeric, 2) AS total_sqm
                FROM ${tb}
                WHERE editor IS NOT NULL AND editor != ''
                GROUP BY editor
            `).catch(() => ({ rows: [] }));

            const projReshape = {};
            for (const r of mainReshapeRows.rows) {
                ensureEditor(r.editor);
                const a = toAreaObj(r.total_sqm);
                const fc = parseInt(r.farmer_count);
                projReshape[r.editor] = { ...a, farmer_count: fc };
                editorMap[r.editor].reshape.total_sqm        += a.total_sqm;
                editorMap[r.editor].reshape.farmer_count     += fc;
            }

            // ── Reclass from reclass table ──
            const reclassExists = await pool.query(
                `SELECT EXISTS(SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name=$1)`,
                [`reclass_${tb}`]
            );
            const projReclassAll = {};
            const projReclassRubber = {};

            if (reclassExists.rows[0].exists) {
                const [allRes, rubberRes] = await Promise.all([
                    pool.query(`
                        SELECT editor, COUNT(*) AS sp, COUNT(DISTINCT id) AS fc,
                            ROUND(COALESCE(SUM(shpsplit_sqm),0)::numeric,2) AS total_sqm
                        FROM reclass_${tb}
                        WHERE editor IS NOT NULL AND editor != ''
                        GROUP BY editor
                    `),
                    pool.query(`
                        SELECT editor, COUNT(*) AS sp, COUNT(DISTINCT id) AS fc,
                            ROUND(COALESCE(SUM(shpsplit_sqm),0)::numeric,2) AS total_sqm
                        FROM reclass_${tb}
                        WHERE editor IS NOT NULL AND editor != ''
                            AND LOWER(TRIM("Classtype")) = 'rubber'
                        GROUP BY editor
                    `)
                ]);
                for (const r of allRes.rows) {
                    ensureEditor(r.editor);
                    const a = toAreaObj(r.total_sqm);
                    const sp = parseInt(r.sp), fc = parseInt(r.fc);
                    projReclassAll[r.editor] = { ...a, sub_plot_count: sp, farmer_count: fc };
                    editorMap[r.editor].reclass_all.total_sqm    += a.total_sqm;
                    editorMap[r.editor].reclass_all.sub_plot_count += sp;
                    editorMap[r.editor].reclass_all.farmer_count  += fc;
                }
                for (const r of rubberRes.rows) {
                    ensureEditor(r.editor);
                    const a = toAreaObj(r.total_sqm);
                    const sp = parseInt(r.sp), fc = parseInt(r.fc);
                    projReclassRubber[r.editor] = { ...a, sub_plot_count: sp, farmer_count: fc };
                    editorMap[r.editor].reclass_rubber.total_sqm    += a.total_sqm;
                    editorMap[r.editor].reclass_rubber.sub_plot_count += sp;
                    editorMap[r.editor].reclass_rubber.farmer_count  += fc;
                }
            }

            // รวม project entry เฉพาะที่มีข้อมูล
            const allEditorsInProject = new Set([
                ...Object.keys(projReshape),
                ...Object.keys(projReclassAll),
                ...Object.keys(projReclassRubber)
            ]);
            for (const ed of allEditorsInProject) {
                editorMap[ed].projects.push({
                    tb_name: layer.tb_name,
                    reshape:        projReshape[ed]        || { ...emptyArea, farmer_count: 0 },
                    reclass_all:    projReclassAll[ed]     || { ...emptyArea, sub_plot_count: 0, farmer_count: 0 },
                    reclass_rubber: projReclassRubber[ed]  || { ...emptyArea, sub_plot_count: 0, farmer_count: 0 }
                });
            }
        }

        // คำนวณ rai/ngan/sqwa รวมจาก total_sqm
        const data = Object.values(editorMap).map(e => {
            ['reshape', 'reclass_all', 'reclass_rubber'].forEach(k => {
                const a = toAreaObj(e[k].total_sqm);
                Object.assign(e[k], a);
            });
            return e;
        }).sort((a, b) => b.reclass_rubber.total_sqm - a.reclass_rubber.total_sqm);

        res.json({ success: true, data });
    } catch (err) {
        console.error('[WORKER-SUMMARY-ALL]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/worker-summary/:tb
   สรุปงานต่อคนใน table เดียว แบ่ง 3 หมวด:
   reshape, reclass_all, reclass_rubber */
app.get('/api/worker-summary/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const usersRes = await pool.query(`SELECT display_name, photo FROM users`);
        const photoMap = {};
        usersRes.rows.forEach(u => { photoMap[u.display_name] = u.photo; });

        // ── Reshape ──
        const reshapeMap = {};
        await pool.query(`
            SELECT editor,
                COUNT(*) AS farmer_count,
                ROUND(COALESCE(SUM("Sqm_Rechac"), 0)::numeric, 2) AS total_sqm
            FROM ${tb}
            WHERE editor IS NOT NULL AND editor != ''
            GROUP BY editor
        `).then(r => r.rows.forEach(row => {
            reshapeMap[row.editor] = { ...toAreaObj(row.total_sqm), farmer_count: parseInt(row.farmer_count) };
        })).catch(() => {});

        // ── Reclass ──
        const reclassAllMap = {}, reclassRubberMap = {};
        const reclassExists = await pool.query(
            `SELECT EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name=$1)`,
            [`reclass_${tb}`]
        );
        if (reclassExists.rows[0].exists) {
            const [allRes, rubberRes] = await Promise.all([
                pool.query(`
                    SELECT editor, COUNT(*) AS sp, COUNT(DISTINCT id) AS fc,
                        ROUND(COALESCE(SUM(shpsplit_sqm),0)::numeric,2) AS total_sqm
                    FROM reclass_${tb}
                    WHERE editor IS NOT NULL AND editor != ''
                    GROUP BY editor
                `),
                pool.query(`
                    SELECT editor, COUNT(*) AS sp, COUNT(DISTINCT id) AS fc,
                        ROUND(COALESCE(SUM(shpsplit_sqm),0)::numeric,2) AS total_sqm
                    FROM reclass_${tb}
                    WHERE editor IS NOT NULL AND editor != ''
                        AND LOWER(TRIM("Classtype")) = 'rubber'
                    GROUP BY editor
                `)
            ]);
            allRes.rows.forEach(r => {
                reclassAllMap[r.editor] = { ...toAreaObj(r.total_sqm), sub_plot_count: parseInt(r.sp), farmer_count: parseInt(r.fc) };
            });
            rubberRes.rows.forEach(r => {
                reclassRubberMap[r.editor] = { ...toAreaObj(r.total_sqm), sub_plot_count: parseInt(r.sp), farmer_count: parseInt(r.fc) };
            });
        }

        const allEditors = new Set([...Object.keys(reshapeMap), ...Object.keys(reclassAllMap), ...Object.keys(reclassRubberMap)]);
        const emptyR  = { ...emptyArea, farmer_count: 0 };
        const emptyRC = { ...emptyArea, sub_plot_count: 0, farmer_count: 0 };

        const data = [...allEditors].map(editor => ({
            editor,
            photo: photoMap[editor] || null,
            reshape:        reshapeMap[editor]      || emptyR,
            reclass_all:    reclassAllMap[editor]   || emptyRC,
            reclass_rubber: reclassRubberMap[editor] || emptyRC
        })).sort((a, b) => b.reclass_rubber.total_sqm - a.reclass_rubber.total_sqm);

        res.json({ success: true, data });
    } catch (err) {
        console.error('[WORKER-SUMMARY]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/* GET /api/checker-summary/:tb
   สรุปงานตรวจ (reviewer) ต่อคนใน table เดียว */
app.get('/api/checker-summary/:tb', async (req, res) => {
    try {
        const tb = req.params.tb.toLowerCase();
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tb)) {
            return res.status(400).json({ error: 'Invalid table name' });
        }

        const usersRes = await pool.query(`SELECT display_name, photo FROM users`);
        const photoMap = {};
        usersRes.rows.forEach(u => { photoMap[u.display_name] = u.photo; });

        const reclassExists = await pool.query(
            `SELECT EXISTS(SELECT 1 FROM information_schema.tables
              WHERE table_schema='public' AND table_name=$1)`,
            [`reclass_${tb}`]
        );
        if (!reclassExists.rows[0].exists) {
            return res.json({ success: true, data: [] });
        }

        await ensureReclassReviewColumns(tb);

        const [classRes, deedRes] = await Promise.all([
            pool.query(`
                SELECT reviewer,
                    COUNT(*) AS sub_plot_count,
                    COUNT(DISTINCT id) AS farmer_count,
                    COUNT(CASE WHEN "Classtype" = 'rubber' THEN 1 END) AS rubber_sub_plot_count,
                    COUNT(DISTINCT CASE WHEN "Classtype" = 'rubber' THEN id END) AS rubber_farmer_count,
                    ROUND(COALESCE(SUM(shpsplit_sqm), 0)::numeric, 2) AS class_sqm,
                    ROUND(COALESCE(SUM(CASE WHEN "Classtype" = 'rubber' THEN shpsplit_sqm ELSE 0 END), 0)::numeric, 2) AS rubber_sqm
                FROM reclass_${tb}
                WHERE reviewer IS NOT NULL AND reviewer != ''
                GROUP BY reviewer
                ORDER BY class_sqm DESC
            `),
            pool.query(`
                SELECT r.reviewer,
                    ROUND(COALESCE(SUM(t."Sqm_Rechac"), 0)::numeric, 2) AS deed_sqm
                FROM (
                    SELECT DISTINCT reviewer, id
                    FROM reclass_${tb}
                    WHERE reviewer IS NOT NULL AND reviewer != ''
                ) r
                JOIN ${tb} t ON t.id = r.id
                GROUP BY r.reviewer
            `)
        ]);

        const deedMap = {};
        deedRes.rows.forEach(r => {
            deedMap[r.reviewer] = {
                deed_sqm:   parseFloat(r.deed_sqm)   || 0
            };
        });

        const data = classRes.rows.map(r => {
            const d = deedMap[r.reviewer] || { deed_sqm: 0 };
            const class_sqm = parseFloat(r.class_sqm) || 0;
            const rubber_sqm = parseFloat(r.rubber_sqm) || 0;
            return {
                reviewer:       r.reviewer,
                photo:          photoMap[r.reviewer] || null,
                sub_plot_count: parseInt(r.sub_plot_count) || 0,
                farmer_count:   parseInt(r.farmer_count) || 0,
                rubber_sub_plot_count: parseInt(r.rubber_sub_plot_count) || 0,
                rubber_farmer_count: parseInt(r.rubber_farmer_count) || 0,
                class_sqm,
                class_rai:   class_sqm / 1600,
                deed_sqm:    d.deed_sqm,
                deed_rai:    d.deed_sqm / 1600,
                rubber_sqm:  rubber_sqm,
                rubber_rai:  rubber_sqm / 1600
            };
        });

        res.json({ success: true, data });
    } catch (err) {
        console.error('[CHECKER-SUMMARY]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = app;

