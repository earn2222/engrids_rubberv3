-- =============================================================================
-- rub_v3 Database Initialization Schema
-- =============================================================================
-- Database  : rub_v3
-- Engine    : PostgreSQL + PostGIS
-- Encoding  : UTF8
--
-- TABLE INVENTORY
-- ─────────────────────────────────────────────────────────────────────────────
-- Static tables (always present):
--   public.users              – Google OAuth accounts with role management
--   public.layerlist          – Registry of all uploaded data layers
--   public.task_assignments   – Worker task distribution (ID ranges per layer)
--   public.review_history     – Audit trail for all review state changes
--
-- Dynamic tables (created per project when a shapefile is uploaded):
--   public.{tb}               – Main rubber-plot feature table
--   public.reclass_{tb}       – Reclassification companion table
--   public.backup_{tb}        – Point-in-time backup snapshot of {tb}
--   public.v_reclass_{tb}     – View joining {tb} + reclass_{tb}
--
-- Functions / Triggers:
--   public.set_admin_email_role()   – auto-promotes designated emails to admin
--   trg_admin_email_role            – fires BEFORE INSERT OR UPDATE ON users
-- =============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- =============================================================================
-- DATABASE
-- =============================================================================

SELECT 'CREATE DATABASE rub_v3
    WITH TEMPLATE = template0
    ENCODING = ''UTF8''
    LOCALE_PROVIDER = libc
    LOCALE = ''C'''
WHERE NOT EXISTS (
    SELECT FROM pg_database WHERE datname = 'rub_v3'
)\gexec

\connect rub_v3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER SCHEMA public OWNER TO postgres;

-- =============================================================================
-- EXTENSIONS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
COMMENT ON EXTENSION postgis IS 'PostGIS geometry, geography, and raster spatial types and functions';

CREATE EXTENSION IF NOT EXISTS postgis_topology;
COMMENT ON EXTENSION postgis_topology IS 'PostGIS topology spatial types and functions';

-- =============================================================================
-- FUNCTION: set_admin_email_role
-- Auto-promotes specific email addresses to the 'admin' role on INSERT/UPDATE.
-- Add more emails to the IN(...) list to grant admin access to other users.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_admin_email_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF LOWER(NEW.email) IN ('engrids2025@gmail.com') THEN
        NEW.role := 'admin';
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.set_admin_email_role() OWNER TO postgres;

-- =============================================================================
-- TABLE: public.users
-- Stores Google OAuth user accounts.
-- role values: 'admin' | 'worker'  (default 'worker')
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.users (
    id           SERIAL          PRIMARY KEY,
    google_id    TEXT            UNIQUE,
    display_name TEXT,
    email        TEXT,
    photo        TEXT,
    role         TEXT            NOT NULL DEFAULT 'worker',
    created_at   TIMESTAMP       DEFAULT NOW()
);

ALTER TABLE public.users OWNER TO postgres;

-- Ensure role column exists (idempotent upgrade guard)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'worker';

-- Trigger: auto-set admin role for designated emails
DROP TRIGGER IF EXISTS trg_admin_email_role ON public.users;

CREATE TRIGGER trg_admin_email_role
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.set_admin_email_role();

-- Promote any existing admin emails that were inserted before the trigger existed
UPDATE public.users
SET role = 'admin'
WHERE LOWER(email) = 'engrids2025@gmail.com';

-- =============================================================================
-- TABLE: public.layerlist
-- Registry of all uploaded data layers (one row per province/project table).
-- tb_name must match the actual PostgreSQL table name.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.layerlist (
    id         SERIAL    PRIMARY KEY,
    tb_name    TEXT      UNIQUE  NOT NULL,
    remark     TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE public.layerlist OWNER TO postgres;

-- =============================================================================
-- TABLE: public.task_assignments
-- Assigns a range of feature IDs (id_from → id_to) to a worker for a layer.
-- user_id links to public.users.id; assignee_email is a denormalised copy for
-- display and for joining tasks to a user even before they log in.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.task_assignments (
    id             SERIAL    PRIMARY KEY,
    tb_name        TEXT      NOT NULL,
    assignee_name  TEXT      NOT NULL,
    assignee_photo TEXT,
    assignee_email TEXT,
    id_from        INTEGER   NOT NULL,
    id_to          INTEGER   NOT NULL,
    note           TEXT,
    user_id        INTEGER,
    created_at     TIMESTAMP DEFAULT NOW(),
    updated_at     TIMESTAMP DEFAULT NOW()
);

ALTER TABLE public.task_assignments OWNER TO postgres;

-- Idempotent column additions (for databases upgraded from an older schema)
ALTER TABLE public.task_assignments ADD COLUMN IF NOT EXISTS user_id        INTEGER;
ALTER TABLE public.task_assignments ADD COLUMN IF NOT EXISTS assignee_email TEXT;

-- =============================================================================
-- TABLE: public.review_history
-- Append-only audit trail. Every time a reviewer's check_shape
-- values are cleared (reset), the old values are saved here with a reason.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.review_history (
    id           SERIAL    PRIMARY KEY,
    tb_name      TEXT      NOT NULL,
    parent_id    INTEGER,                              -- id in the main data table
    sub_id       TEXT,                                 -- sub_id in reclass_{tb}
    check_shape  TEXT,
    remark       TEXT,
    reviewer     TEXT,
    review_ts    TIMESTAMP WITHOUT TIME ZONE,
    reset_reason TEXT,
    reset_ts     TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.review_history OWNER TO postgres;

-- Index to speed up history look-ups by layer + feature
CREATE INDEX IF NOT EXISTS idx_review_history_tb_parent
    ON public.review_history (tb_name, parent_id);

-- =============================================================================
-- TEMPLATE: main rubber-plot data table
-- =============================================================================
-- Actual tables are created dynamically (named by province/project) when a
-- shapefile is uploaded via POST /api/create-project or
-- POST /api/upload-shapefile-to-table.
--
-- Each dynamic table gets:
--   • a spatial index on geom        → idx_{tb}_geom
--   • a spatial index on geom_point  → idx_{tb}_geom_point
--
-- Column reference:
--   id           – internal surrogate key (SERIAL)
--   OBJECTID     – original GIS object ID from the shapefile
--   Land_ID      – cadastral land parcel ID
--   Zone         – administrative zone code
--   Name/Surname – owner name
--   Farm_ID      – farm identifier
--   Farmer_ID    – farmer identifier
--   F_Moo        – village sub-unit (หมู่)
--   F_Tam        – sub-district (ตำบล)
--   F_Amp        – district (อำเภอ)
--   F_Prove      – province (จังหวัด)
--   Rai          – area in Thai rai (legacy field)
--   Land_Type    – land title type
--   Area_Rai/Ngan/sqwa – area breakdown in Thai units
--   Plant_Year   – year of rubber planting
--   Old_Year     – age offset year
--   DEM          – elevation (metres)
--   Class_Age    – rubber age class
--   Stratum      – survey stratum
--   Area_SqM     – polygon area in square metres
--   Rai_Area     – polygon area in rai
--   UTM_East/North – UTM centroid coordinates
--   Sqm_Rechac   – recalculated area (sq m)
--   Rai_Rechac   – recalculated area (rai)
--   geom         – MultiPolygon geometry (SRID 4326)
--   geom_point   – Point centroid geometry (SRID 4326)
--   ts           – last modification timestamp
-- =============================================================================

-- (Uncomment the block below to verify the template schema or for reference.)
/*
CREATE TABLE public._template_rubber_plot (
    id             SERIAL  PRIMARY KEY,
    "OBJECTID"     INTEGER,
    "Land_ID"      TEXT,
    "Zone"         TEXT,
    "Name"         TEXT,
    "Surname"      TEXT,
    "Farm_ID"      TEXT,
    "Farmer_ID"    TEXT,
    "F_Moo"        TEXT,
    "F_Tam"        TEXT,
    "F_Amp"        TEXT,
    "F_Prove"      TEXT,
    "Rai"          NUMERIC,
    "Land_Type"    TEXT,
    "Area_Rai"     NUMERIC,
    "Area_Ngan"    NUMERIC,
    "Area_sqwa"    NUMERIC,
    "Plant_Year"   INTEGER,
    "Old_Year"     INTEGER,
    "DEM"          NUMERIC,
    "Class_Age"    TEXT,
    "Stratum"      TEXT,
    "Area_SqM"     NUMERIC,
    "Rai_Area"     NUMERIC,
    "UTM_East"     NUMERIC,
    "UTM_North"    NUMERIC,
    "Sqm_Rechac"   NUMERIC,
    "Rai_Rechac"   NUMERIC,
    geom           public.geometry(MultiPolygon, 4326),
    geom_point     public.geometry(Point, 4326),
    ts             TIMESTAMP DEFAULT NOW()
);
*/

-- =============================================================================
-- TEMPLATE: reclass_{tb} companion table
-- =============================================================================
-- Created automatically alongside each main table. Stores split/reclassified
-- sub-features. Each row is a fragment of a parent feature (linked by id).
--
-- Column reference:
--   fid          – surrogate key for this reclass row
--   id           – FK → {tb}.id (parent feature)
--   sub_id       – unique sub-feature identifier (text, e.g. "123_1")
--   farmer_id    – denormalised farmer ID for quick look-ups
--   shpsplit_sqm – area of this split fragment (sq m)
--   Class_Area    – classified rubber area (sq m)
--   geom         – MultiPolygon geometry of this fragment (SRID 4326)
--   geom_point   – Point centroid of this fragment (SRID 4326)
--   Classtype    – classification label (e.g. 'rubber', 'non-rubber')
--   ts           – last modification timestamp
--   check_shape  – shape review status ('pass' | 'fail' | NULL)
--   remark       – reviewer's free-text remark
--   reviewer     – reviewer username
--   review_ts    – timestamp of last review action
--   user_remark      – worker's own remark
--   user_remark_ts   – timestamp of worker remark
-- =============================================================================

-- =============================================================================
-- TEMPLATE: backup_{tb} snapshot table
-- =============================================================================
-- A copy of the main {tb} rows created at upload time (CREATE TABLE AS SELECT).
-- Has all columns of {tb} plus:
--   backup_at TIMESTAMPTZ DEFAULT NOW()
-- New rows from subsequent uploads are appended (INSERT … WHERE NOT EXISTS).
-- =============================================================================

-- =============================================================================
-- TEMPLATE: v_reclass_{tb} view
-- =============================================================================
-- Joins {tb} (aliased a) with reclass_{tb} (aliased r) on a.id = r.id.
-- Exposes all main-table columns plus reclass columns prefixed with reclass_*.
-- Example (auto-generated by the application):
--
-- CREATE VIEW v_reclass_{tb} AS
-- SELECT
--     a.id,
--     a."OBJECTID", a."Land_ID", a."Zone",
--     a."Name", a."Surname", a."Farm_ID", a."Farmer_ID",
--     a."F_Moo", a."F_Tam", a."F_Amp", a."F_Prove",
--     a."Rai", a."Land_Type", a."Area_Rai", a."Area_Ngan", a."Area_sqwa",
--     a."Plant_Year", a."Old_Year", a."DEM", a."Class_Age", a."Stratum",
--     a."Area_SqM", a."Rai_Area", a."UTM_East", a."UTM_North",
--     a."Sqm_Rechac", a."Rai_Rechac",
--     a.ts AS a_ts,
--     r.fid          AS reclass_fid,
--     r.sub_id       AS reclass_sub_id,
--     r.shpsplit_sqm AS r_shpsplit_sqm,
--     r."Class_Area",
--     r."Classtype",
--     r.ts           AS r_ts,
--     r.geom
-- FROM {tb} AS a
-- JOIN reclass_{tb} AS r ON a.id = r.id;
-- =============================================================================

-- Done
COMMIT;
