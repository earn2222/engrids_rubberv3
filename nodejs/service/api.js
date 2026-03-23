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

// get all users
app.get('/api/getfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
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
            return col;
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
        const tb = req.params.tb;
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
            sql = `SELECT r.id, 
                        r.sub_id, 
                        r.classtype, 
                        r.id_farmer, 
                        r.shpsplit_sqm, 
                        t.sqm_yang,
                        ST_ASGeoJSON(r.geom) AS geom,
                        ST_ASGeoJSON(st_makepoint(100, 18)) AS geom_point
                    FROM ${reclassTableName} r
                    JOIN ${tb} t ON r.id = t.id
                    WHERE r.geom IS NOT NULL AND r.id = $1`;
            values = [fid];
        } else {
            // Fallback to original table
            sql = `SELECT id, 
                        id as sub_id, 
                        'rubber' as classtype, 
                        id_farmer, 
                        shparea_sq as shpsplit_sqm, 
                        sqm_yang,
                        ST_ASGeoJSON(geom) AS geom,
                        ST_ASGeoJSON(st_makepoint(100, 18)) AS geom_point
                    FROM ${tb}
                    WHERE geom IS NOT NULL AND id = $1`;
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
        const tb = req.params.tb;
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
        const whereClause = hasGeomPoint ? 'WHERE geom_point IS NOT NULL' : '';

        const sql = `
            SELECT id,
                f_name,
                l_name,
                age,
                refinal,
                id_farmer,
                sqm_pacel,
                shparea_sq,
                classified,
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
        const { tb, id } = req.params;

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
                    // ── Point: reset geom → NULL, restore geom_point ต้นฉบับ + shparea_sq ──
                    updateResult = await pool.query(`
                        UPDATE ${tb} AS t
                        SET geom       = NULL,
                            geom_point = b.geom_point,
                            shparea_sq = b.shparea_sq
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
                        SET geom       = b.geom,
                            geom_point = b.geom_point,
                            shparea_sq = b.shparea_sq
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
                            SET shpsplit_sqm = $1,
                                geom        = NULL,
                                geom_point  = b.geom_point
                            FROM backup_${tb} AS b
                            WHERE reclass_${tb}.id = $2
                              AND b.id = $2
                              AND (reclass_${tb}.sub_id = $3 OR reclass_${tb}.sub_id = $2::text)
                        `, [bk.shparea_sq, featureId, featureId.toString()]);
                    } else {
                        // Polygon: sync shpsplit_sqm เท่านั้น
                        await pool.query(`
                            UPDATE reclass_${tb}
                            SET shpsplit_sqm = $1
                            WHERE id = $2 AND (sub_id = $3 OR sub_id = $2::text)
                        `, [bk.shparea_sq, featureId, featureId.toString()]);
                    }
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

        const rGeom     = geomRow.rows[0].geom;        // อาจ null ถ้าเป็น point
        const rGeomPt   = geomRow.rows[0].geom_point;  // อาจ null ถ้าเป็น polygon
        const isPoint   = rGeom === null;

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
                SET geom = r.geom,
                    shparea_sq = ST_Area(ST_Transform(r.geom, ${epsg}))
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
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const { id, refinal, features, displayName, geometryChanged, currentShpareaSq } = req.body;

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
                    // ✅ ใช้ค่าจากฐานข้อมูลเดิม ไม่คำนวณใหม่
                    const existingRes = await client.query(`SELECT shparea_sq FROM ${tb} WHERE id = $1`, [id]);
                    area = existingRes.rows[0]?.shparea_sq || currentShpareaSq || 0;
                    console.log(`Geometry unchanged for ID ${id}, preserving area: ${area}`);
                }

                // ✅ บันทึกลงฐานข้อมูล
                await client.query(`
                    UPDATE ${tb}
                    SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)),
                        shparea_sq = $3,
                        refinal = $4,
                        editor = $5
                    WHERE id = $2
                `, [
                    geojsonStr,
                    id,
                    area,
                    refinal,
                    displayName
                ]);

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
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // Auto-add review columns if they don't exist (for older tables)
        const alterCols = ['check_area', 'check_shape', 'remark', 'reviewer', 'user_remark', 'review_ts', 'user_remark_ts'];
        for (const col of alterCols) {
            let colType = 'text';
            if (col === 'review_ts' || col === 'user_remark_ts') colType = 'timestamp without time zone';
            await pool.query(`
                DO $$ BEGIN
                    ALTER TABLE reclass_${tb} ADD COLUMN ${col} ${colType};
                EXCEPTION
                    WHEN duplicate_column THEN NULL;
                END $$;
            `);
        }

        const sql = `SELECT a.id,
                    a.sub_id,
                    b.refinal,
                    a.classtype, 
                    a.id_farmer,
                    CONCAT_WS(' ', b.f_name, b.l_name) AS farm_name,
                    b.age,
                    b.sqm_pacel,
                    b.sqm_yang,
                    b.shparea_sq AS shparea_sqm,
                    a.shpsplit_sqm,
                    a.check_area,
                    a.check_shape,
                    a.remark,
                    a.reviewer,
                    a.user_remark,
                    a.user_remark_ts,
                    a.review_ts,
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
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { sub_id, check_area, check_shape, remark, reviewer, user_remark } = req.body;
        if (!sub_id) {
            return res.status(400).json({ error: 'sub_id is required' });
        }

        const sql = `
            UPDATE reclass_${tb}
            SET check_area = $1,
                check_shape = $2,
                remark = $3,
                reviewer = $4,
                user_remark = $5,
                review_ts = NOW()
            WHERE sub_id = $6
            RETURNING *`;

        const values = [check_area || null, check_shape || null, remark || null, reviewer || null, user_remark || null, sub_id];
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
        const tb = req.params.tb;
        const { sub_id } = req.body;
        if (!tb || !sub_id) {
            return res.status(400).json({ error: 'Table name and sub_id are required' });
        }

        const sql = `
            UPDATE reclass_${tb}
            SET check_area = NULL,
                check_shape = NULL,
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

// User remark endpoint
app.put('/api/update_user_remark/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
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
        const { tb, sub_id } = req.params;
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

// GET reshape polygon data for reclassdash map overlay
app.get('/api/getreshapefeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const sql = `SELECT id,
                        id_farmer,
                        sqm_pacel,
                        shparea_sq,
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
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const query = `
        SELECT 
            (SELECT COUNT(*) FROM ${tb}) AS total,
            (SELECT COUNT(*) FROM ${tb} WHERE classified = TRUE) AS reclass,
            (
                CASE 
                    WHEN to_regclass('reclass_${tb}') IS NOT NULL THEN (
                        SELECT COUNT(DISTINCT r.id) 
                        FROM reclass_${tb} r
                        JOIN ${tb} m ON r.id = m.id
                        WHERE r.editor IS NOT NULL AND ABS(r.shpsplit_sqm - m.sqm_pacel) <= 100
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
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const sql = `SELECT
                        classtype,
                        ROUND(SUM(shpsplit_sqm) / 1600.0, 0) AS area_rai
                    FROM ${tb}
                    GROUP BY classtype
                    ORDER BY classtype;`;
        const { rows } = await pool.query(sql);
        res.json(rows);
    } catch (err) {
        console.error(err.stack);
        res.status(500).json({ error: 'Database query failed' });
    }
});

app.post('/api/create_reclass_feature/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
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
            INSERT INTO reclass_${tb} (id, sub_id, id_farmer, shpsplit_sqm, geom)
            SELECT id, $2, id_farmer, shparea_sq, geom
            FROM ${tb}
            WHERE id = $1
            RETURNING id, id_farmer, ST_AsGeoJSON(geom) AS geom;
        `;
        const values = [id, sub_id];
        const result = await pool.query(sql, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found in source table' });
        }

        // uudate reclass column
        const updateSql = `
            UPDATE ${tb}
            SET classified = FALSE
            WHERE id = $1
            RETURNING *;
        `;

        const updateValues = [id];
        const updateResult = await pool.query(updateSql, updateValues);
        if (updateResult.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found in reclass table' });
        }

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
                geom geometry(MultiPolygon,4326),
                classtype text COLLATE pg_catalog."default",
                editor text COLLATE pg_catalog."default",
                check_area text COLLATE pg_catalog."default",
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
                    a.refinal       AS a_refinal,
                    a.editor        AS a_editor,
                    a.ts            AS a_ts,
                    a.classified,
                    a.shparea_sq,
                    r.fid           AS reclass_fid,
                    r.id            AS reclass_parent_id,
                    r.sub_id        AS reclass_sub_id,
                     r.id_farmer     AS reclass_id_farmer,
                    r.shpsplit_sqm,
                    r.classtype,
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
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { polygon_fc, line_fc, srid, displayName } = req.body;
        const polygon    = polygon_fc.geometry;
        const line       = line_fc.geometry;
        const properties = polygon_fc.properties;
        const id         = polygon_fc.properties.id;
        const sub_id     = polygon_fc.properties.sub_id;

        console.log(`Splitting feature in table ${tb} with ID ${id} and sub_id ${sub_id}`);

        if (!properties?.id_farmer) {
            return res.status(400).json({ error: 'id_farmer is required in properties' });
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
                    ROUND(COALESCE($9::numeric, sum_raw) * (raw_area / sum_raw)) AS rounded_area,
                    ROW_NUMBER() OVER (ORDER BY raw_area DESC) AS rn
                FROM calc_areas CROSS JOIN totals
            ),
            final_areas AS (
                SELECT
                    geom_4326,
                    CASE
                        WHEN rn = 1 THEN rounded_area + (
                            COALESCE($9::numeric, (SELECT sum_raw FROM totals)) 
                            - SUM(rounded_area) OVER()
                        )
                        ELSE rounded_area
                    END AS allocated_area
                FROM proportional
            ),
            inserted AS (
                INSERT INTO reclass_${tb} (id_farmer, geom, sub_id, id, classtype, shpsplit_sqm, editor)
                SELECT
                    $4,
                    ST_Multi(geom_4326),
                    $5 || '-' || row_number() OVER (),
                    $6,
                    $7,
                    allocated_area,
                    $8
                FROM final_areas
                RETURNING *
            )
            SELECT id, sub_id, classtype, id_farmer, shpsplit_sqm,
                   ST_AsGeoJSON(geom, 15) AS geom
            FROM inserted
        `, [
            JSON.stringify(polygon),
            JSON.stringify(line),
            srid || 32647,
            properties.id_farmer,
            sub_id,
            id,
            properties.classtype,
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



app.put('/api/update_landuse/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { id, sub_id, classtype, displayName } = req.body;
        if (!sub_id || !classtype) {
            return res.status(400).json({ error: 'ID and classtype are required' });
        }

        const updateReclass = `
            UPDATE reclass_${tb}
            SET classtype = $1, 
                editor = $2
            WHERE sub_id = $3
            RETURNING *`;

        const values = [classtype, displayName, sub_id];
        const result = await pool.query(updateReclass, values);

        const updateReshape = `
            UPDATE ${tb}
            SET classified = TRUE
            WHERE id = $1
            RETURNING *;
        `;
        const updateReshapeValues = [id];
        const updateResult = await pool.query(updateReshape, updateReshapeValues);

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
        const tb = req.params.tb;
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
                geom = g.geom_wgs,
                shpsplit_sqm = ST_Area(ST_Transform(g.geom_wgs, 32647)),
                editor = g.editor
            FROM geom_input g
            WHERE reclass_${tb}.sub_id = g.sub_id
            RETURNING *;
        `;

        const values = [JSON.stringify(geometry), displayName, sub_id];
        const result = await pool.query(query, values);

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
        const tb = req.params.tb;
        const typeFilter = req.query.type; // 'rubber' or 'all_rubber'
        if (!tb) return res.status(400).json({ error: 'Table name is required' });

        let sql;
        // ─── Case 1: Download reclassify (v_reclass_xxx) ───────────────────────────
        if (tb.startsWith('v_reclass_')) {
            const baseTb = tb.replace('v_reclass_', '');
            let extraTypeCondition = '';
            if (typeFilter === 'rubber') {
                extraTypeCondition = "AND LOWER(TRIM(r.classtype)) = 'rubber'";
            } else if (typeFilter === 'all_rubber') {
                extraTypeCondition = "AND LOWER(TRIM(r.classtype)) IN ('rubber', 'not-rubber')";
            }

            sql = `
                SELECT json_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE(json_agg(f.feat) FILTER (WHERE f.feat IS NOT NULL), '[]'::json)
                ) AS geojson
                FROM (
                    SELECT json_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(r.geom)::json,
                        'properties', json_build_object(
                            'classtype',    r.classtype,
                            'shpsplit_sqm', r.shpsplit_sqm,
                            'id',           r.id,
                            'remark',       m.remark,
                            'agency',       m.agency,
                            'id_farmer',    m.id_farmer,
                            'regis_no',     m.regis_no,
                            'no_plot',      m.no_plot,
                            'titl_nam',     m.titl_nam,
                            'f_name',       m.f_name,
                            'l_name',       m.l_name,
                            'address',      m.address,
                            'sub_dis',      m.sub_dis,
                            'district',     m.district,
                            'province',     m.province,
                            'status',       m.status,
                            'title_no',     m.title_no,
                            'title_type',   m.title_type,
                            'yang_rai',     m.yang_rai,
                            'rai',          m.rai,
                            'ng',           m.ng,
                            'sgw',          m.sgw,
                            'pacel_rai',    m.pacel_rai,
                            'age',          m.age,
                            'x',            m.x,
                            'y',            m.y,
                            'sqm_yang',     m.sqm_yang,
                            'sqm_pacel',    m.sqm_pacel,
                            'shparea_sq',   m.shparea_sq,
                            'geom',         ST_AsText(r.geom),
                            'geom_point',   ST_AsGeoJSON(m.geom_point)::json
                        )
                    ) AS feat
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
                    'features', COALESCE(json_agg(f.feat) FILTER (WHERE f.feat IS NOT NULL), '[]'::json)
                ) AS geojson
                FROM (
                    SELECT json_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(m.geom)::json,
                        'properties', json_build_object(
                            'id',           m.id,
                            'remark',       m.remark,
                            'agency',       m.agency,
                            'id_farmer',    m.id_farmer,
                            'regis_no',     m.regis_no,
                            'no_plot',      m.no_plot,
                            'titl_nam',     m.titl_nam,
                            'f_name',       m.f_name,
                            'l_name',       m.l_name,
                            'address',      m.address,
                            'sub_dis',      m.sub_dis,
                            'district',     m.district,
                            'province',     m.province,
                            'status',       m.status,
                            'title_no',     m.title_no,
                            'title_type',   m.title_type,
                            'yang_rai',     m.yang_rai,
                            'rai',          m.rai,
                            'ng',           m.ng,
                            'sgw',          m.sgw,
                            'pacel_rai',    m.pacel_rai,
                            'age',          m.age,
                            'x',            m.x,
                            'y',            m.y,
                            'sqm_yang',     m.sqm_yang,
                            'sqm_pacel',    m.sqm_pacel,
                            'shparea_sq',   m.shparea_sq,
                            'geom',         ST_AsText(m.geom),
                            'geom_point',   ST_AsGeoJSON(m.geom_point)::json
                        )
                    ) AS feat
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

app.get('/api/users', async (req, res) => {
    try {
        // Check if users table exists, if not create it
        const checkTableSql = `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users')`;
        const checkResult = await pool.query(checkTableSql);
        const tableExists = checkResult.rows[0].exists;

        if (!tableExists) {
            const createTableSql = `
                CREATE TABLE users (
                    id SERIAL PRIMARY KEY,
                    google_id TEXT UNIQUE,
                    display_name TEXT,
                    email TEXT,
                    photo TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `;
            await pool.query(createTableSql);
        }

        const sql = `SELECT * FROM users`;
        const result = await pool.query(sql);
        // console.log(result.rows);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
})

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

app.delete('/api/layerlist/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // drop view
        const sql0 = `DROP VIEW IF EXISTS v_reclass_${tb}`;
        await pool.query(sql0);

        const sql1 = `DELETE FROM layerlist WHERE tb_name = $1 RETURNING *`;
        const result = await pool.query(sql1, [tb]);

        // delete reclass table
        const sql2 = `DROP TABLE IF EXISTS reclass_${tb}`;
        await pool.query(sql2);

        // delete source table
        // const sql3 = `DROP TABLE IF EXISTS ${tb}`;
        // await pool.query(sql3);

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
                WHERE sub_id IN (${placeholders}) AND classtype='rubber'
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
             WHERE sub_id = $4 AND classtype='rubber'`,
            [JSON.stringify(geomJSON), area, displayName, id_list[0]]
        );

        const idsToDelete = id_list.slice(1);
        if (idsToDelete.length > 0) {
            const delPlaceholders = idsToDelete.map((_, i) => `$${i + 1}`).join(',');
            await pool.query(
                `DELETE FROM public.reclass_${tb} WHERE sub_id IN (${delPlaceholders}) AND classtype='rubber'`,
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

// Helper to normalize properties: lowercase keys and values, ensure all template columns exist
const normalizeProperties = (props) => {
    const templateCols = [
        'id', 'remark', 'agency', 'id_farmer', 'regis_no', 'no_plot', 'titl_nam', 'f_name',
        'l_name', 'address', 'sub_dis', 'district', 'province', 'status', 'title_no',
        'title_type', 'yang_rai', 'rai', 'ng', 'sgw', 'pacel_rai', 'age', 'x', 'y',
        'sqm_yang', 'sqm_pacel', 'shparea_sq', 'refinal'
    ];

    const normalized = {};
    const sourceLower = {};
    for (let key in props) {
        sourceLower[key.toLowerCase()] = props[key];
    }

    templateCols.forEach(col => {
        let val = sourceLower[col];
        if (val === undefined || val === null) {
            if (['no_plot', 'yang_rai', 'rai', 'ng', 'sgw', 'pacel_rai', 'age', 'x', 'y', 'sqm_yang', 'sqm_pacel', 'shparea_sq'].includes(col)) {
                normalized[col] = 0;
            } else {
                normalized[col] = '';
            }
        } else {
            if (typeof val === 'string') {
                normalized[col] = val.toLowerCase();
            } else {
                normalized[col] = val;
            }
        }
    });

    // Robust fallbacks for Thai rubber shapefiles
    // if (normalized['sqm_pacel'] === 0 && sourceLower['xls_sqm']) normalized['sqm_pacel'] = sourceLower['xls_sqm'];
    if (normalized['shparea_sq'] === 0 && sourceLower['shparea_sqm']) normalized['shparea_sq'] = sourceLower['shparea_sqm'];
    // if (!normalized['id_farmer'] && sourceLower['app_no']) normalized['id_farmer'] = sourceLower['app_no'];

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
                id SERIAL PRIMARY KEY, remark text, agency text, id_farmer text, regis_no text, no_plot numeric, titl_nam text, f_name text, l_name text, address text, sub_dis text, district text, province text, status text, title_no text, title_type text, yang_rai numeric, rai numeric, ng numeric, sgw numeric, pacel_rai numeric, age numeric, x numeric, y numeric, sqm_yang numeric, sqm_pacel numeric, shparea_sq numeric, geom GEOMETRY(MultiPolygon, 4326), geom_point GEOMETRY(Point, 4326), refinal text, classified boolean DEFAULT FALSE, editor text, ts timestamp DEFAULT NOW()
            );
            CREATE INDEX idx_${tb_name}_geom ON ${tb_name} USING GIST(geom);
            CREATE INDEX idx_${tb_name}_geom_point ON ${tb_name} USING GIST(geom_point);

            CREATE TABLE reclass_${tb_name} (
                fid SERIAL PRIMARY KEY, id INTEGER, sub_id TEXT, id_farmer TEXT, shpsplit_sqm NUMERIC, geom GEOMETRY(MultiPolygon, 4326), geom_point GEOMETRY(Point, 4326), classtype TEXT DEFAULT '${geom_type}', editor TEXT, ts TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX idx_reclass_${tb_name}_geom ON reclass_${tb_name} USING GIST(geom);

            CREATE VIEW v_reclass_${tb_name} AS SELECT
                a.id, a.remark AS a_remark, a.agency, a.id_farmer, a.regis_no, a.no_plot, a.titl_nam, a.f_name, a.l_name, a.address, a.sub_dis, a.district, a.province, a.status, a.title_no, a.title_type, a.yang_rai, a.rai, a.ng, a.sgw, a.pacel_rai, a.age, a.x, a.y, a.sqm_yang, a.sqm_pacel, a.shparea_sq, a.refinal, a.classified, a.editor AS a_editor, a.ts AS a_ts,
                r.fid AS reclass_fid, r.sub_id AS reclass_sub_id, r.shpsplit_sqm AS r_shpsplit_sqm, r.classtype, r.editor AS reclass_editor, r.ts AS r_ts, r.geom
            FROM ${tb_name} AS a
            JOIN reclass_${tb_name} AS r ON a.id = r.id;
        `;
        await pool.query(`DROP VIEW IF EXISTS v_reclass_${tb_name}`);
        await pool.query(`DROP TABLE IF EXISTS reclass_${tb_name}`);
        await pool.query(`DROP TABLE IF EXISTS ${tb_name}`);
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
                        INSERT INTO ${tb_name} (remark, agency, id_farmer, regis_no, no_plot, titl_nam, f_name, l_name, address, sub_dis, district, province, status, title_no, title_type, yang_rai, rai, ng, sgw, pacel_rai, age, x, y, sqm_yang, sqm_pacel, shparea_sq, refinal, geom, geom_point)
                        VALUES ($2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, ${geomVal}, ${geomPointVal})
                        RETURNING id, id_farmer, shparea_sq AS shpsplit_sqm, geom, geom_point
                    )
                    INSERT INTO reclass_${tb_name} (id, sub_id, id_farmer, shpsplit_sqm, geom, geom_point, classtype)
                    SELECT id, id::text, id_farmer, shpsplit_sqm, geom, geom_point, '${geom_type}' FROM main_ins;
                `;
                const params = [ geomJson, norm.remark, norm.agency, norm.id_farmer, norm.regis_no, norm.no_plot, norm.titl_nam, norm.f_name, norm.l_name, norm.address, norm.sub_dis, norm.district, norm.province, norm.status, norm.title_no, norm.title_type, norm.yang_rai, norm.rai, norm.ng, norm.sgw, norm.pacel_rai, norm.age, norm.x, norm.y, norm.sqm_yang, norm.sqm_pacel, norm.shparea_sq, norm.refinal ];
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
        const fileName = 'rub2.sql';
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

    // Validate table name (letters, numbers, underscore only)
    if (!/^[a-z][a-z0-9_]*$/.test(tb_name)) {
        return res.status(400).json({ error: 'Table name must start with a letter and contain only lowercase letters, numbers and underscores' });
    }

    try {
        // Drop existing objects first (idempotent re-create)
        await pool.query(`DROP VIEW IF EXISTS v_reclass_${tb_name}`);
        await pool.query(`DROP TABLE IF EXISTS reclass_${tb_name}`);
        await pool.query(`DROP TABLE IF EXISTS ${tb_name}`);

        // Create main rubber table with full template schema
        const createMainTable = `
            CREATE TABLE ${tb_name} (
                id           SERIAL PRIMARY KEY,
                remark       text,
                agency       text,
                id_farmer    text,
                regis_no     text,
                no_plot      numeric,
                titl_nam     text,
                f_name       text,
                l_name       text,
                address      text,
                sub_dis      text,
                district     text,
                province     text,
                status       text,
                title_no     text,
                title_type   text,
                yang_rai     numeric,
                rai          numeric,
                ng           numeric,
                sgw          numeric,
                pacel_rai    numeric,
                age          numeric,
                x            numeric,
                y            numeric,
                sqm_yang     numeric,
                sqm_pacel    numeric,
                shparea_sq   numeric,
                geom         GEOMETRY(MultiPolygon, 4326),
                geom_point   GEOMETRY(Point, 4326),
                refinal      text,
                classified   boolean DEFAULT FALSE,
                editor       text,
                ts           timestamp DEFAULT NOW()
            );
            CREATE INDEX idx_${tb_name}_geom       ON ${tb_name} USING GIST(geom);
            CREATE INDEX idx_${tb_name}_geom_point ON ${tb_name} USING GIST(geom_point);
        `;
        await pool.query(createMainTable);

        // Create companion reclass table
        const createReclassTable = `
            CREATE TABLE reclass_${tb_name} (
                fid          SERIAL PRIMARY KEY,
                id           INTEGER,
                sub_id       TEXT,
                id_farmer    TEXT,
                shpsplit_sqm NUMERIC,
                geom         GEOMETRY(MultiPolygon, 4326),
                geom_point   GEOMETRY(Point, 4326),
                classtype    TEXT,
                editor       TEXT,
                ts           TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX idx_reclass_${tb_name}_geom ON reclass_${tb_name} USING GIST(geom);
        `;
        await pool.query(createReclassTable);

        // Create view
        const createView = `
            CREATE VIEW v_reclass_${tb_name} AS
            SELECT
                a.id, a.remark AS a_remark, a.agency, a.id_farmer, a.regis_no,
                a.no_plot, a.titl_nam, a.f_name, a.l_name, a.address,
                a.sub_dis, a.district, a.province, a.status, a.title_no, a.title_type,
                a.yang_rai, a.rai, a.ng, a.sgw, a.pacel_rai, a.age, a.x, a.y,
                a.sqm_yang, a.sqm_pacel, a.shparea_sq,
                a.refinal, a.classified,
                a.editor AS a_editor, a.ts AS a_ts,
                r.fid AS reclass_fid, r.sub_id AS reclass_sub_id,
                r.shpsplit_sqm AS r_shpsplit_sqm, r.classtype,
                r.editor AS reclass_editor, r.ts AS r_ts, r.geom
            FROM ${tb_name} AS a
            JOIN reclass_${tb_name} AS r ON a.id = r.id;
        `;
        await pool.query(createView);

        // Register in layerlist (idempotent – skip if already exists)
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

    const extractDir = path.join('uploads', `extract_${Date.now()}`);

    try {
        // Check table exists
        const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
            [tb_name]
        );
        if (!tableCheck.rows[0].exists) {
            return res.status(404).json({ error: `Table "${tb_name}" not found. Please create the project first.` });
        }

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
            } catch (e) {}
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
                if (geom.type === 'Point')        return geom.coordinates;
                if (geom.type === 'Polygon')      return geom.coordinates[0][0];
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
                    geomVal      = `NULL`;
                } else {
                    geomVal      = `ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326))`;
                    geomPointVal = `ST_Centroid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), ${sourceSrid}), 4326))`;
                }

                const insertSql = `
                    WITH main_ins AS (
                        INSERT INTO ${tb_name} (
                            remark, agency, id_farmer, regis_no, no_plot, titl_nam, f_name, l_name,
                            address, sub_dis, district, province, status, title_no, title_type,
                            yang_rai, rai, ng, sgw, pacel_rai, age, x, y,
                            sqm_yang, sqm_pacel, shparea_sq, refinal,
                            geom, geom_point
                        )
                        VALUES (
                            $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                            $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
                            ${geomVal}, ${geomPointVal}
                        )
                        RETURNING id, id_farmer, shparea_sq AS shpsplit_sqm, geom, geom_point
                    )
                    INSERT INTO reclass_${tb_name} (id, sub_id, id_farmer, shpsplit_sqm, geom, geom_point, classtype)
                    SELECT id, id::text, id_farmer, shpsplit_sqm, geom, geom_point, '${geom_type}' FROM main_ins;
                `;
                const params = [
                    geomJson,
                    norm.remark, norm.agency, norm.id_farmer, norm.regis_no, norm.no_plot,
                    norm.titl_nam, norm.f_name, norm.l_name, norm.address, norm.sub_dis,
                    norm.district, norm.province, norm.status, norm.title_no, norm.title_type,
                    norm.yang_rai, norm.rai, norm.ng, norm.sgw, norm.pacel_rai, norm.age,
                    norm.x, norm.y, norm.sqm_yang, norm.sqm_pacel, norm.shparea_sq,
                    norm.refinal
                ];
                await client.query(insertSql, params);
            }

            await client.query('COMMIT');

            // ── AUTO BACKUP: upsert new rows into backup_{tb_name} ───────────────
            try {
                // ตรวจสอบว่า backup table มีแล้วหรือยัง
                const bkCheck = await pool.query(
                    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
                    [`backup_${tb_name}`]
                );
                if (!bkCheck.rows[0].exists) {
                    // สร้าง backup table ใหม่จาก structure ของ main table + คอลัมน์ backup_at
                    await pool.query(`CREATE TABLE backup_${tb_name} AS SELECT * FROM ${tb_name} WHERE FALSE`);
                    await pool.query(`ALTER TABLE backup_${tb_name} ADD COLUMN backup_at TIMESTAMPTZ DEFAULT NOW()`);
                }

                // เพิ่มข้อมูลที่ upload ใหม่ล่าสุดเข้า backup (rows ที่ไม่มีใน backup)
                const backupInsertResult = await pool.query(`
                    INSERT INTO backup_${tb_name}
                    SELECT m.*, NOW() AS backup_at
                    FROM ${tb_name} m
                    WHERE NOT EXISTS (
                        SELECT 1 FROM backup_${tb_name} b WHERE b.id = m.id
                    )
                `);
                console.log(`[BACKUP] Appended ${backupInsertResult.rowCount} new rows to backup_${tb_name}`);
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
    const { tb } = req.params;
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
    const { tb, id } = req.params;
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
        const originalShparea = bk.shparea_sq; // ค่าเนื้อที่ต้นฉบับ

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
                SET shparea_sq  = b.shparea_sq,
                    geom        = b.geom,
                    geom_point  = b.geom_point
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
                    INSERT INTO reclass_${tb} (id, sub_id, id_farmer, shpsplit_sqm, geom, classtype)
                    VALUES ($1, $2::text, $3, $4, $5, 'polygon')
                    ON CONFLICT DO NOTHING
                `, [
                    featureId,
                    featureId.toString(),
                    restoredRow.id_farmer,
                    originalShparea,           // ← ค่าเนื้อที่ต้นฉบับจาก backup
                    restoredRow.geom
                ]);
                reclassRestored = 1;
            } else {
                // มีอยู่ใน reclass → UPDATE shpsplit_sqm กลับเป็นค่าต้นฉบับ
                await pool.query(`
                    UPDATE reclass_${tb}
                    SET shpsplit_sqm = $1,
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
    const { tb } = req.params;
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
            SELECT b.id, b.id_farmer, b.f_name, b.l_name, b.backup_at
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

module.exports = app;

