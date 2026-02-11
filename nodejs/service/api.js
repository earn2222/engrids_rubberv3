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

        // ตรวจสอบว่าตารางมีคอลัมน์ geom_point หรือไม่
        const colCheck = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'geom_point'",
            [tb]
        );
        const hasGeomPoint = colCheck.rowCount > 0;

        const geomPointSelect = hasGeomPoint ? 'ST_ASGeoJSON(geom_point) AS geom_point' : "NULL::json AS geom_point";

        const sql = `SELECT id,
                        farm_name,
                        f_name,
                        l_name,
                        age,
                        refinal,
                        app_no,
                        xls_sqm,
                        shparea_sqm,
                        classified,
                        ST_ASGeoJSON(geom) AS geom,
                        ${geomPointSelect}
                    FROM ${tb}
                    WHERE geom IS NOT NULL ${hasGeomPoint ? 'OR geom_point IS NOT NULL' : ''}`;

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
            sql = `SELECT id, 
                        sub_id, 
                        classtype, 
                        app_no, 
                        shpsplit_sqm, 
                        ST_ASGeoJSON(geom) AS geom,
                        ST_ASGeoJSON(st_makepoint(100, 18)) AS geom_point
                    FROM ${reclassTableName}
                    WHERE geom IS NOT NULL AND id = $1`;
            values = [fid];
        } else {
            // Fallback to original table
            sql = `SELECT id, 
                        id as sub_id, 
                        'rubber' as classtype, 
                        app_no, 
                        shparea_sqm as shpsplit_sqm, 
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
                farm_name,
                f_name,
                l_name,
                age,
                refinal,
                app_no,
                xls_sqm,
                shparea_sqm,
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

// GET: ดึงข้อมูลรายแปลงใส่ตาราง
app.get('/api/getfeaturesv3/:tb/:fid', async (req, res) => {
    try {
        const tb = req.params.tb;
        const fid = req.params.fid;

        if (!tb) return res.status(400).json({ error: 'Table name is required' });
        if (!fid) return res.status(400).json({ error: 'Feature ID is required' });

        const reclassTable = `reclass_${tb}`;
        const colCheck = await pool.query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'geom_point'",
            [reclassTable]
        );
        const hasGeomPoint = colCheck.rowCount > 0;

        const geomPointSelect = hasGeomPoint ? 'ST_AsGeoJSON(geom_point) AS geom_point' : "NULL::json AS geom_point";
        const whereClause = hasGeomPoint ? 'WHERE geom_point IS NOT NULL AND id = $1' : 'WHERE id = $1';

        const sql = `
            SELECT id, 
                   sub_id, 
                   classtype, 
                   app_no, 
                   shpsplit_sqm, 
                   ST_AsGeoJSON(geom) AS geom,
                   ${geomPointSelect}
            FROM ${reclassTable}
            ${whereClause}
        `;
        const result = await pool.query(sql, [fid]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }

        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});



app.get('/api/getsinglefeature/:tb/:fid', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const fid = req.params.fid;
        if (!fid) {
            return res.status(400).json({ error: 'Feature ID is required' });
        }

        const sql = `SELECT id,  
                        app_no, 
                        refinal,
                        xls_sqm,
                        shparea_sqm, 
                        ST_ASGeoJSON(geom) AS geom
                    FROM ${tb}
                    WHERE geom IS NOT NULL AND id = $1`;
        console.log(`Executing SQL: ${sql} with fid: ${fid}`);
        const values = [fid];
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

        const sql = `
        UPDATE ${tb} AS t
        SET geom = r.geom
        FROM reclass_${tb} AS r
        WHERE t.id = $1
          AND r.id = $1
        RETURNING t.*;
      `;
        const { rows, rowCount } = await pool.query(sql, [featureId]);

        if (rowCount === 0) {
            return res.status(404).json({ error: 'Feature not found' });
        }

        return res.status(200).json({
            success: true,
            data: rows[0]
        });

    } catch (err) {
        console.error('Error in /api/restorefeatures:', err);
        return res.status(500).json({ error: err.message });
    }
});

app.put('/api/updateselectedfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;

        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { features } = req.body;
        const client = await pool.connect();
        if (!features || !Array.isArray(features)) {
            return res.status(400).json({ error: 'Invalid input data' });
        }
        if (features.length === 0) {
            return res.status(400).json({ error: 'No features to update' });
        }

        try {
            await client.query('BEGIN');

            const queries = features.map(feature =>
                client.query(`
                    UPDATE reclass_${tb}
                    SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                        shparea_sqm = ST_Area(
                            ST_SetSRID(ST_GeomFromGeoJSON($1), 4326):: geography
                        )
                    WHERE sub_id = $2
                `, [
                    JSON.stringify(feature.geometry),
                    feature.properties.sub_id
                ])
            );

            await Promise.all(queries);
            await client.query('COMMIT');
            res.json({ success: true, updated: features.length });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/updatefeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const { id, refinal, features, displayName } = req.body;

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
                const epsg = getEPSGFromGeoJSON(geometry);
                const geojsonStr = JSON.stringify(geometry);

                // ✅ คำนวณพื้นที่แบบ UTM
                const areaSql = `
                    SELECT ST_Area(
                        ST_Transform(
                            ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                            ${epsg}
                        )
                    ) AS area
                `;
                const areaResult = await client.query(areaSql, [geojsonStr]);
                const area = areaResult.rows[0].area;

                // ✅ บันทึกลงฐานข้อมูล
                await client.query(`
                    UPDATE ${tb}
                    SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                        shparea_sqm = $3,
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




//testv3
// แก้ไข endpoint ให้รองรับ Polygon และ MultiPolygon
app.post('/api/updatefeaturesv3/:tb', async (req, res) => {
    const { tb } = req.params;
    const { geom, id, refinal, editor } = req.body;

    try {
        const geojson = JSON.parse(geom);

        if (!['Polygon', 'MultiPolygon'].includes(geojson.type)) {
            return res.status(400).json({ error: 'Geometry ต้องเป็น Polygon หรือ MultiPolygon เท่านั้น' });
        }

        // ✅ ฟังก์ชันคำนวณ EPSG แบบเดียวกับ /api/area
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
            const coords = geojson.coordinates;
            const type = geojson.type;
            const [lon, lat] = getPolygonCentroid(coords, type);
            if (lon === null || lat === null || isNaN(lon) || isNaN(lat)) {
                return 4326;
            }
            return getUTMEPSGCode(lon, lat);
        }

        const epsg = getEPSGFromGeoJSON(geojson);
        const geojsonStr = JSON.stringify(geojson);

        // ✅ ใช้ EPSG คำนวณเนื้อที่แบบแม่นยำก่อนอัปเดต
        const areaSql = `
            SELECT ST_Area(
                ST_Transform(
                    ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                    ${epsg}
                )
            ) AS area
        `;
        const areaResult = await pool.query(areaSql, [geojsonStr]);
        const area = areaResult.rows[0].area;

        // ✅ บันทึกลงฐานข้อมูล
        const updateSql = `
            UPDATE ${tb}
            SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                shparea_sqm = $3,
                refinal = $4,
                editor = $5
            WHERE id = $2
        `;
        const result = await pool.query(updateSql, [geojsonStr, id, area, refinal, editor]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'ไม่พบข้อมูลที่ต้องการอัปเดต' });
        }

        res.json({ success: true, id, area }); // ✅ ส่ง area กลับ

    } catch (err) {
        console.error('Update error:', err);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล' });
    }
});



app.post('/api/savefeature/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const { id, refinal, features, displayName } = req.body;

        if (!features || !Array.isArray(features) || features.length === 0) {
            return res.status(400).json({ error: 'Invalid input data or no features' });
        }

        const client = await pool.connect();

        // ✅ ฟังก์ชันช่วยคำนวณ EPSG จาก centroid
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

            let unionedGeom = null;
            let totalArea = 0;

            for (const feature of features) {
                const geom = feature.geometry;
                const geomStr = JSON.stringify(geom);

                // ดึง geometry เดิม
                const { rows } = await client.query(
                    `SELECT geom FROM ${tb} WHERE id = $1`, [id]
                );
                if (rows.length === 0) {
                    throw new Error(`ไม่พบข้อมูล id: ${id}`);
                }

                // รวม geometry เดิมกับ geometry ใหม่
                const unionSql = `
                    SELECT ST_Multi(ST_Union(
                        $1::geometry,
                        ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)
                    )) AS merged
                `;
                const unionResult = await client.query(unionSql, [rows[0].geom, geomStr]);
                unionedGeom = unionResult.rows[0].merged;

                // คำนวณ EPSG และพื้นที่
                const epsg = getEPSGFromGeoJSON(geom);
                const areaSql = `
                    SELECT ST_Area(
                        ST_Transform(ST_GeomFromEWKT($1), ${epsg})
                    ) AS area
                `;
                const ewkt = `SRID=4326;${unionedGeom}`;
                const areaResult = await client.query(areaSql, [ewkt]);
                totalArea = areaResult.rows[0].area;

                // อัปเดตในตาราง
                const updateSql = `
                    UPDATE ${tb}
                    SET 
                        geom = ST_GeomFromEWKT($1),
                        shparea_sqm = $3,
                        refinal = $4,
                        editor = $5
                    WHERE id = $2
                `;
                await client.query(updateSql, [
                    ewkt,
                    id,
                    totalArea,
                    refinal,
                    displayName
                ]);
            }

            await client.query('COMMIT');
            res.json({
                success: true,
                id,
                area: totalArea
            });

        } catch (err) {
            await client.query('ROLLBACK');
            console.error('Transaction error:', err);
            res.status(500).json({ error: err.message });
        } finally {
            client.release();
        }

    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/getreclassfeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        // Auto-add review columns if they don't exist (for older tables)
        const alterCols = ['check_area', 'check_shape', 'remark', 'reviewer', 'user_remark'];
        for (const col of alterCols) {
            await pool.query(`
                DO $$ BEGIN
                    ALTER TABLE reclass_${tb} ADD COLUMN ${col} text;
                EXCEPTION
                    WHEN duplicate_column THEN NULL;
                END $$;
            `);
        }

        const sql = `SELECT a.id,
                    a.sub_id,
                    b.refinal,
                    a.classtype, 
                    a.app_no,
                    b.shparea_sqm,
                    a.shpsplit_sqm,
                    a.check_area,
                    a.check_shape,
                    a.remark,
                    a.reviewer,
                    a.user_remark,
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
                user_remark = $5
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

// GET reshape polygon data for reclassdash map overlay
app.get('/api/getreshapefeatures/:tb', async (req, res) => {
    try {
        const tb = req.params.tb;
        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }

        const sql = `SELECT id,
                        app_no,
                        xls_sqm,
                        shparea_sqm,
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
        WITH a AS (
            SELECT COUNT(*) AS reshp
            FROM ${tb}
            WHERE ABS(xls_sqm - shparea_sqm) <= 100
        ),
        c AS (
            SELECT COUNT(DISTINCT id) AS reclass
            FROM reclass_${tb}
        )
        SELECT (SELECT COUNT(*) FROM ${tb}) AS total,
                c.reclass,
                a.reshp
        FROM a
        CROSS JOIN c;
      `;
        const result = await pool.query(query);
        res.json(result.rows[0]);
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
            INSERT INTO reclass_${tb} (id, sub_id, app_no, shpsplit_sqm, geom)
            SELECT id, $2, app_no, shparea_sqm, geom
            FROM ${tb}
            WHERE id = $1
            RETURNING id, app_no, ST_AsGeoJSON(geom) AS geom;
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
                app_no text COLLATE pg_catalog."default",
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
                    a.app_no,
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
                    a.xls_sqm,
                    a.chk,
                    a.diff_chk,
                    a.remark        AS a_remark,
                    a.refinal       AS a_refinal,
                    a.editor        AS a_editor,
                    a.ts            AS a_ts,
                    a.classified,
                    a.shparea_sqm,
                    r.fid           AS reclass_fid,
                    r.id            AS reclass_parent_id,
                    r.sub_id        AS reclass_sub_id,
                    r.app_no        AS reclass_app_no,
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
        const polygon = polygon_fc.geometry;
        const line = line_fc.geometry;
        const properties = polygon_fc.properties;
        const id = polygon_fc.properties.id;
        const sub_id = polygon_fc.properties.sub_id;

        console.log(`Splitting feature in table ${tb} with ID ${id} and sub_id ${sub_id}`);

        if (!properties?.app_no) {
            return res.status(400).json({ error: 'app_no is required in properties' });
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
                    ST_Force2D(ST_GeomFromGeoJSON($1)) AS poly,
                    ST_Force2D(ST_GeomFromGeoJSON($2)) AS line,
                    $3::integer AS processing_srid
            ),
            transformed AS (
                SELECT 
                    ST_Transform(poly, processing_srid) AS poly_projected,
                    ST_Transform(line, processing_srid) AS line_projected
                FROM inputs
            ),
            split AS (
                SELECT ST_Split(poly_projected, line_projected) AS split_geom
                FROM transformed
            ),
            parts AS (
                SELECT (ST_Dump(split_geom)).geom AS geom_projected 
                FROM split
            ),
            inserted AS (
                INSERT INTO reclass_${tb} (app_no, geom, sub_id, id, classtype, shpsplit_sqm, editor)
                SELECT 
                    $4, 
                    ST_Transform(geom_projected, 4326), 
                    $5 || '-' || row_number() OVER (),
                    $6,
                    $7, 
                    ST_Area(geom_projected),
                    $8
                FROM parts, inputs
                WHERE ST_GeometryType(geom_projected) = 'ST_Polygon'
                RETURNING *
            )
            SELECT 
                id, 
                sub_id, 
                classtype, 
                app_no, 
                shpsplit_sqm, 
                ST_ASGeoJSON(geom) AS geom
            FROM inserted
        `, [
            JSON.stringify(polygon),
            JSON.stringify(line),
            srid || 32647,
            properties.app_no,
            sub_id,
            id,
            properties.classtype,
            displayName
        ]);

        if (result.rowCount === 0) {
            return res.status(400).json({ error: 'No split results - check input geometries' });
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

        if (!tb) {
            return res.status(400).json({ error: 'Table name is required' });
        }
        const { rows } = await pool.query(`
        SELECT json_build_object(
          'type',     'FeatureCollection',
          'features', json_agg(features.feature)
        ) AS geojson
        FROM (
          SELECT json_build_object(
            'type',       'Feature',
            'geometry',   ST_AsGeoJSON(geom)::json,
            'properties', to_jsonb(props) - 'geom'
          ) AS feature
          FROM (
            SELECT *
            FROM ${tb}
            WHERE geom IS NOT NULL
          ) AS props
        ) AS features;
      `);

        const geojson = rows[0].geojson;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader(
            'Content-Disposition',
            'attachment; filename="data.geojson"'
        );
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
                    tb_name TEXT NOT NULL,
                    remark TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
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

//

app.post('/api/split', async (req, res) => {
    const { polygon_fc, line_fc, srid } = req.body;

    try {
        const sql = `
        WITH inputs AS(
            SELECT
            ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS poly_geom,
            ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) AS line_geom
        ),
            split AS(
                SELECT ST_Split(poly_geom, line_geom) AS geom_collection
          FROM inputs
            ),
                dumped AS(
                    --Dump each piece out of the GeometryCollection
          SELECT(ST_Dump(geom_collection)).geom AS part_geom
          FROM split
                )
        SELECT ST_AsGeoJSON(part_geom) AS geojson
        FROM dumped;
        `;
        const params = [
            JSON.stringify(polygon_fc.geometry),
            JSON.stringify(line_fc.geometry)
        ];
        const { rows } = await pool.query(sql, params);

        // Parse each GeoJSON string back to an object
        const features = rows.map(r => ({
            type: 'Feature',
            geometry: JSON.parse(r.geojson),
            properties: {}
        }));


        res.status(200).json({
            success: true, data: {
                type: 'FeatureCollection',
                features
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// app.post('/api/collected_feat', async (req, res) => {
//     try {
//         const { id_list, tb } = req.body;

//         if (!Array.isArray(id_list) || id_list.length < 2) {
//             return res.status(400).json({ error: 'ต้องมี polygon อย่างน้อย 2 อัน' });
//         }

//         // รวม geom เฉพาะ rubber
//         const placeholders = id_list.map((_, i) => `$${i + 1}`).join(', ');
//         const sql = `
//             SELECT ST_AsGeoJSON(ST_Union(geom)) AS geom
//             FROM public.reclass_${tb}
//             WHERE sub_id IN (${placeholders}) AND classtype = 'rubber'
//         `;
//         const result = await pool.query(sql, id_list);
//         const collectedGeom = JSON.parse(result.rows[0].geom);

//         // อัปเดต polygon แรกที่เลือกด้วย geom ใหม่
//         const keepSubId = id_list[0];
//         await pool.query(
//             `UPDATE public.reclass_${tb} SET geom = $1 WHERE sub_id = $2 AND classtype = 'rubber'`,
//             [collectedGeom, keepSubId]
//         );

//         // ลบ polygon rubber อื่นที่เหลือ
//         const idsToDelete = id_list.slice(1);
//         if (idsToDelete.length > 0) {
//             const delPlaceholders = idsToDelete.map((_, i) => `$${i + 1}`).join(', ');
//             await pool.query(
//                 `DELETE FROM public.reclass_${tb} WHERE sub_id IN (${delPlaceholders}) AND classtype = 'rubber'`,
//                 idsToDelete
//             );
//         }

//         res.json({ success: true, geom: collectedGeom });

//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ error: error.message });
//     }
// });

// api/collected_feat
app.post('/api/collected_feat', async (req, res) => {
    try {
        const { id_list, tb, displayName } = req.body;
        if (!Array.isArray(id_list) || id_list.length < 2) {
            return res.status(400).json({ success: false, error: 'ต้องมี polygon อย่างน้อย 2 อัน' });
        }

        const placeholders = id_list.map((_, i) => `$${i + 1}`).join(',');

        // รวม polygon แบบ make valid ก่อน union
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
            return res.status(400).json({ success: false, error: 'ไม่สามารถรวม polygon ได้ (ตรวจสอบ polygon ใน DB หรือ geometry invalid)' });
        }

        const geomJSON = JSON.parse(result.rows[0].geom);
        const area = Number(result.rows[0].shpsplit_sqm.toFixed(2));

        // อัปเดต polygon แรก
        await pool.query(
            `UPDATE public.reclass_${tb}
             SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                 shpsplit_sqm = $2,
                 editor = $3
             WHERE sub_id = $4 AND classtype='rubber'`,
            [JSON.stringify(geomJSON), area, displayName, id_list[0]]
        );

        // ลบ polygon อื่น
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

// Upload Shapefile endpoint
app.post('/api/upload-shapefile', upload.single('shpFile'), async (req, res) => {
    const { tb_name, remark } = req.body;
    const zipFilePath = req.file.path;

    if (!tb_name || !zipFilePath) {
        return res.status(400).json({ error: 'Table name and shapefile are required' });
    }

    const extractDir = path.join('uploads', `extract_${Date.now()}`);

    try {
        // Extract ZIP file
        await fs.promises.mkdir(extractDir, { recursive: true });
        await new Promise((resolve, reject) => {
            fs.createReadStream(zipFilePath)
                .pipe(unzipper.Extract({ path: extractDir }))
                .on('close', resolve)
                .on('error', reject);
        });

        // Find shapefile files
        const files = fs.readdirSync(extractDir);
        const shpFile = files.find(f => f.endsWith('.shp'));
        const dbfFile = files.find(f => f.endsWith('.dbf'));

        if (!shpFile) {
            throw new Error('No .shp file found in the ZIP');
        }

        const shpPath = path.join(extractDir, shpFile);
        const dbfPath = dbfFile ? path.join(extractDir, dbfFile) : null;

        // Read shapefile
        const source = await shapefile.open(shpPath, dbfPath);
        const features = [];

        let result = await source.read();
        while (!result.done) {
            features.push(result.value);
            result = await source.read();
        }

        if (features.length === 0) {
            throw new Error('No features found in shapefile');
        }

        // Determine geometry type
        const geomType = features[0].geometry.type;
        if (!geomType) {
            throw new Error('Invalid geometry type in shapefile');
        }
        let geometryType;
        if (geomType === 'Point') {
            geometryType = 'GEOMETRY(Point, 4326)';
        } else if (geomType === 'MultiPoint') {
            geometryType = 'GEOMETRY(MultiPoint, 4326)';
        } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
            geometryType = 'GEOMETRY(MultiLineString, 4326)';
        } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
            geometryType = 'GEOMETRY(MultiPolygon, 4326)';
        } else {
            geometryType = 'GEOMETRY(Geometry, 4326)';
        }

        // Create table
        const createTableSql = `
            CREATE TABLE ${tb_name} (
                id SERIAL PRIMARY KEY,
                geom ${geometryType},
                geom_point GEOMETRY(Point, 4326),
                shparea_sqm NUMERIC,
                xls_sqm NUMERIC,
                app_no TEXT,
                farm_name TEXT,
                f_name TEXT,
                l_name TEXT,
                age NUMERIC,
                refinal TEXT,
                classified BOOLEAN DEFAULT FALSE,
                shparea_sqm_geom NUMERIC,
                editor TEXT,
                ts TIMESTAMP DEFAULT NOW()
            )
        `;
        await pool.query(createTableSql);

        // Insert features
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (const feature of features) {
                const geom = JSON.stringify(feature.geometry);
                const properties = feature.properties || {};

                // Calculate centroid for geom_point
                let geomPointSql = 'ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))';
                let areaSql = 'NULL';
                if (geomType.includes('Polygon')) {
                    areaSql = 'ST_Area(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 32647))';
                }

                const insertSql = `
                    INSERT INTO ${tb_name} (
                        geom, geom_point, shparea_sqm, app_no, farm_name, f_name, l_name, age, refinal
                    ) VALUES (
                        ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                        ${geomPointSql},
                        ${areaSql},
                        $2, $3, $4, $5, $6, $7
                    )
                `;
                await client.query(insertSql, [
                    geom,
                    properties.app_no || null,
                    properties.farm_name || null,
                    properties.f_name || null,
                    properties.l_name || null,
                    properties.age || null,
                    properties.refinal || null
                ]);
            }

            await client.query('COMMIT');

            // Add to layerlist
            const layerlistSql = `
                INSERT INTO layerlist (tb_name, remark)
                VALUES ($1, $2)
                ON CONFLICT (tb_name) DO NOTHING
            `;
            await pool.query(layerlistSql, [tb_name, remark]);

            // Create reclass table
            const createReclassSql = `
                CREATE TABLE reclass_${tb_name} (
                    fid SERIAL PRIMARY KEY,
                    id INTEGER,
                    sub_id TEXT,
                    app_no TEXT,
                    shpsplit_sqm NUMERIC,
                    geom ${geometryType},
                    classtype TEXT DEFAULT '${geomType.includes('Point') ? 'point' : 'rubber'}',
                    editor TEXT,
                    ts TIMESTAMP DEFAULT NOW()
                )
            `;
            await pool.query(createReclassSql);

            res.json({ success: true, message: 'Shapefile uploaded and processed successfully', recordCount: features.length });

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
        // Cleanup
        if (fs.existsSync(extractDir)) {
            fs.rmSync(extractDir, { recursive: true, force: true });
        }
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
    }
});

// export module
module.exports = app;