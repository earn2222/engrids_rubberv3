const express = require('express');
const app = express.Router();
const { Pool } = require('pg');

const bodyParser = require('body-parser');
const path = require('path');

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

app.get('/api/getfeatures/:tb/:fid', async (req, res) => {
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
                        sub_id, 
                        classtype, 
                        app_no, 
                        shpsplit_sqm, 
                        ST_ASGeoJSON(geom) AS geom
                    FROM reclass_${tb}
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
                    UPDATE ${tb}
                    SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                        shparea_sqm = ST_Area(
                            ST_SetSRID(ST_GeomFromGeoJSON($1), 4326):: geography
                        ),
                        refinal = $3,
                        editor = $4
                    WHERE id = $2
                `, [
                    JSON.stringify(feature.geometry),
                    id,
                    refinal,
                    displayName
                ])
            );

            await Promise.all(queries);
            await client.query('COMMIT');

            res.json({ success: true, updated: features[0].properties.id });
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

        try {
            await client.query('BEGIN');

            for (const feature of features) {
                const geomJson = JSON.stringify(feature.geometry);

                // 👇 ดึง geometry เดิมจากตารางก่อน
                const { rows } = await client.query(
                    `SELECT geom FROM ${tb} WHERE id = $1`, [id]
                );

                if (rows.length === 0) {
                    throw new Error(`ไม่พบข้อมูล id: ${id}`);
                }

                const sql = `
                    UPDATE ${tb}
                    SET 
                        geom = ST_Multi(
                            ST_Union(
                                geom,
                                ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)
                            )
                        ),
                        shparea_sqm = ST_Area(
                            ST_SetSRID(ST_Union(geom, ST_GeomFromGeoJSON($1)), 4326)::geography
                        ),
                        refinal = $3,
                        editor = $4
                    WHERE id = $2
                `;

                await client.query(sql, [
                    geomJson,
                    id,
                    refinal,
                    displayName
                ]);
            }

            await client.query('COMMIT');
            res.json({ success: true });
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
        const sql = `SELECT a.id,
                    a.sub_id,
                    b.refinal,
                    a.classtype, 
                    a.app_no,
                    b.shparea_sqm,
                    a.shpsplit_sqm,
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
        const sql = `SELECT * FROM users`;
        const result = await pool.query(sql);
        // console.log(result.rows);
        if (result.rows.length > 0) {
            res.status(200).json(result.rows)
        }
    } catch (error) {
        res.status(500).json({ error: err.message });
    }
})

app.get('/api/layerlist', async (req, res) => {
    try {
        const sql = `SELECT * FROM layerlist`;
        const result = await pool.query(sql);
        // console.log(result.rows);
        if (result.rows.length > 0) {
            res.status(200).json(result.rows)
        }
    } catch (error) {
        res.status(500).json({ error: err.message });
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
    if (!geometry || !geometry.type) {
        return res.status(400).json({ error: 'Missing GeoJSON geometry' });
    }

    try {
        const sql = `
        SELECT ST_Area(
          ST_SetSRID(
            ST_GeomFromGeoJSON($1),
            4326
          )::geography
        ) AS area;
      `;
        const { rows } = await pool.query(sql, [JSON.stringify(geometry)]);
        return res.json({ area: rows[0].area });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/split', async (req, res) => {
    const { polygon_fc, line_fc, srid } = req.body;

    try {
        const sql = `
        WITH inputs AS (
          SELECT
            ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS poly_geom,
            ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) AS line_geom
        ),
        split AS (
          SELECT ST_Split(poly_geom, line_geom) AS geom_collection
          FROM inputs
        ),
        dumped AS (
          -- Dump each piece out of the GeometryCollection
          SELECT (ST_Dump(geom_collection)).geom AS part_geom
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

        // Wrap as FeatureCollection
        // res.json({
        //     type: 'FeatureCollection',
        //     features
        // });

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


// app.get('/api/ldd_getprovince', async (req, res) => {
//     try {
//         const response_token = await fetch('https://landsmaps.dol.go.th/apiService/JWT/GetJWTAccessToken');
//         const token = await response_token.json();
//         const API_TOKEN = token.result[0].access_token;

//         const url = 'https://landsmaps.dol.go.th/apiService/Master/GetProvince';
//         const response = await fetch(url, {
//             method: 'GET',
//             headers: {
//                 'Authorization': `Bearer ${API_TOKEN}`,
//                 'Accept': 'application/json',
//             }
//         });

//         if (!response.ok) {
//             throw new Error(`HTTP error! status: ${response.status}`);
//         }

//         const data = await response.json();
//         res.status(200).json(data);
//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     }
// })

// app.get('/api/ldd_getamphur/:province', async (req, res) => {
//     try {
//         const province = req.params.province;
//         if (!province) {
//             return res.status(400).json({ error: 'Province is required' });
//         }
//         const response_token = await fetch('https://landsmaps.dol.go.th/apiService/JWT/GetJWTAccessToken');
//         const token = await response_token.json();
//         const API_TOKEN = token.result[0].access_token;

//         const url = `https://landsmaps.dol.go.th/apiService/Master/GetAmphoe/${province}`;
//         const response = await fetch(url, {
//             method: 'GET',
//             headers: {
//                 'Authorization': `Bearer ${API_TOKEN}`,
//                 'Accept': 'application/json'
//             }
//         });

//         if (!response.ok) {
//             throw new Error(`HTTP error! status: ${response.status}`);
//         }

//         const data = await response.json();

//         res.status(200).json(data);
//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     }
// })

// app.get('/api/ldd_getpacelbypacelnumber/:province/:amphur/:parcelnumber', async (req, res) => {
//     try {
//         const { province, amphur, parcelnumber } = req.params;

//         const paramValidation = [
//             { name: 'province', value: province, pattern: /^[a-zA-Z0-9ก-๙]+$/ },
//             { name: 'amphur', value: amphur, pattern: /^[a-zA-Z0-9ก-๙]+$/ },
//             { name: 'parcelnumber', value: parcelnumber, pattern: /^\d+$/ }
//         ];

//         const errors = paramValidation
//             .filter(({ value, pattern }) => !value || !pattern.test(value))
//             .map(({ name }) => `Invalid ${name}`);

//         if (errors.length > 0) {
//             return res.status(400).json({ errors });
//         }

//         const tokenResponse = await fetch('https://landsmaps.dol.go.th/apiService/JWT/GetJWTAccessToken');
//         if (!tokenResponse.ok) throw new Error('Token request failed');

//         const tokenData = await tokenResponse.json();
//         const API_TOKEN = tokenData?.result?.[0]?.access_token;
//         if (!API_TOKEN) throw new Error('Invalid token response');

//         const parcelRes = await fetch(
//             `https://landsmaps.dol.go.th/apiService/LandsMaps/GetParcelByParcelNo/${province}/${amphur}/${parcelnumber}`,
//             {
//                 headers: {
//                     'Authorization': `Bearer ${API_TOKEN}`,
//                     'Accept': 'application/json'
//                 }
//             }
//         );

//         if (!parcelRes.ok) throw new Error(`Parcel API failed with status ${parcelRes.status}`);

//         const parcelJson = await parcelRes.json();
//         const parcelInfo = parcelJson?.result?.[0];
//         if (!parcelInfo) throw new Error('No parcel data found');

//         const geoParams = new URLSearchParams({
//             viewparams: `utmmap:${parcelInfo.utm1}${parcelInfo.utm2}${parcelInfo.utm3}`,
//             service: 'WMS',
//             version: '1.1.1',
//             request: 'GetFeatureInfo',
//             layers: 'LANDSMAPS:V_PARCEL47,LANDSMAPS:V_PARCEL48',
//             bbox: `${parcelInfo.parcellon},${parcelInfo.parcellat},${(Number(parcelInfo.parcellon) + 0.000001).toFixed(6)},${(Number(parcelInfo.parcellat) + 0.000001).toFixed(6)}`,
//             width: '256',
//             height: '256',
//             srs: 'EPSG:4326',
//             query_layers: 'LANDSMAPS:V_PARCEL47,LANDSMAPS:V_PARCEL48',
//             info_format: 'application/json',
//             x: '128',
//             y: '128'
//         });
//         const url = `https://landsmaps.dol.go.th/geoserver/LANDSMAPS/wms?${geoParams}`;
//         console.log(url)
//         const geoResponse = await fetch(url);
//         if (!geoResponse.ok) throw new Error(`Geo API failed with status ${geoResponse.status}`);

//         const geoData = await geoResponse.json();
//         if (!geoData?.features?.[0]) throw new Error('No geo features found');

//         geoData.features[0].properties = {
//             ...parcelInfo,
//             ...geoData.features[0].properties
//         };

//         res.status(200)
//             .set('Cache-Control', 'public, max-age=300')
//             .json(geoData);

//     } catch (error) {
//         console.error(`[${new Date().toISOString()}] Error: ${error.message}`);

//         const statusCode = error.message.includes('failed with status') ? 502 : 500;
//         res.status(statusCode).json({
//             error: statusCode === 502 ? 'Upstream service error' : 'Internal server error',
//             details: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// });

// app.get('/api/ldd_getpacelbypacelnumber2/:province/:amphur/:parcelnumber', async (req, res) => {
//     try {
//         const province = req.params.province;
//         const amphur = req.params.amphur;
//         const parcelnumber = req.params.parcelnumber;
//         if (!province || !amphur || !parcelnumber) {
//             return res.status(400).json({ error: 'Province, amphur and parcelnumber are required' });
//         }
//         const response_token = await fetch('https://landsmaps.dol.go.th/apiService/JWT/GetJWTAccessToken');
//         const token = await response_token.json();
//         const API_TOKEN = token.result[0].access_token;
//         const url = `https://landsmaps.dol.go.th/apiService/LandsMaps/GetParcelByParcelNo/${province}/${amphur}/${parcelnumber}`;
//         const response = await fetch(url, {
//             method: 'GET',
//             headers: {
//                 'Authorization': `Bearer ${API_TOKEN}`,
//                 'Accept': 'application/json'
//             }
//         });
//         if (!response.ok) {
//             throw new Error(`HTTP error! status: ${response.status}`);
//         }

//         const ressonse_json = await response.json();
//         // console.log(ressonse_json);

//         const utm1 = ressonse_json.result[0].utm1;
//         const utm2 = ressonse_json.result[0].utm2;
//         const utm3 = ressonse_json.result[0].utm3;
//         const lat = ressonse_json.result[0].parcellat;
//         const lng = ressonse_json.result[0].parcellon;

//         const urlGeo = `https://landsmaps.dol.go.th/geoserver/LANDSMAPS/wms?viewparams=utmmap:${utm1}${utm2}${utm3}&service=WMS&version=1.1.1&request=GetFeatureInfo&layers=LANDSMAPS:V_PARCEL48&bbox=${lng},${lat},${Number(lng) + 0.000001},${Number(lat) + 0.000001}&width=256&height=256&srs=EPSG:4326&query_layers=LANDSMAPS:V_PARCEL48&info_format=application/json&x=103&y=85`;

//         const response_feat = await fetch(urlGeo);

//         if (!response_feat.ok) {
//             throw new Error(`HTTP error! status: ${response_feat.status}`);
//         }
//         const data_feat = await response_feat.json();
//         data_feat.features[0].properties = ressonse_json.result[0];

//         res.status(200).json(data_feat);
//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     }
// })


// app.post('/api/ldd_loadwms', async (req, res) => {
//     try {
//         const { urlText } = req.body;
//         console.log(urlText);

//         const response_feat = await fetch(urlText);

//         if (!response_feat.ok) {
//             throw new Error(`HTTP error! status: ${response_feat.status}`);
//         }
//         const data_feat = await response_feat.json();

//         console.log(data_feat);

//         data_feat.features[0].properties = ressonse_json.result[0];

//         res.status(200).json(data_feat);
//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     }
// })


// export module
module.exports = app;
