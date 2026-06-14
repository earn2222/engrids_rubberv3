--
-- PostgreSQL database init for rub2
--

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

--
-- Name: rub2; Type: DATABASE
--

CREATE DATABASE rub2 WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'C';

ALTER DATABASE rub2 OWNER TO postgres;

\connect rub2

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

--
-- Extensions
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

--
-- Users table for Google OAuth authentication
--

CREATE TABLE IF NOT EXISTS public.users (
    id           SERIAL PRIMARY KEY,
    google_id    TEXT UNIQUE,
    display_name TEXT,
    email        TEXT,
    photo        TEXT,
    role         TEXT NOT NULL DEFAULT 'worker',
    created_at   TIMESTAMP DEFAULT NOW()
);

ALTER TABLE public.users OWNER TO postgres;

--
-- Trigger: auto-set admin role for designated admin emails
--

CREATE OR REPLACE FUNCTION public.set_admin_email_role()
RETURNS TRIGGER AS $$
BEGIN
    IF LOWER(NEW.email) IN ('daungjai.16002@gmail.com') THEN
        NEW.role := 'admin';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_admin_email_role
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.set_admin_email_role();

--
-- LayerList table
--

CREATE TABLE IF NOT EXISTS public.layerlist (
    id         SERIAL PRIMARY KEY,
    tb_name    TEXT UNIQUE,
    remark     TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE public.layerlist OWNER TO postgres;

--
-- Template table for rubber plot data
-- Table naming convention: [province]_[person_name]
-- Example: champhon_earn
--

-- This is a template - actual tables will be created dynamically with names like:
-- champhon_earn, rayong_somchai, etc.

CREATE TABLE public.template (
    id integer PRIMARY KEY,
    remark text,
    agency text,
    id_farmer text,
    regis_no text,
    no_plot integer,
    titl_nam text,
    f_name text,
    l_name text,
    address text,
    sub_dis text,
    district text,
    province text,
    status text,
    title_no text,
    title_type text,
    yang_rai integer,
    rai integer,
    ng integer,
    sgw integer,
    pacel_rai numeric,
    age integer,
    x numeric,
    y numeric,
    sqm_yang numeric,
    sqm_pacel numeric,
    shparea_sq numeric,
    geom public.geometry(Polygon, 4326),
    geom_point public.geometry(Point, 4326)
);

ALTER TABLE public.template OWNER TO postgres;

-- Drop template table after schema definition
DROP TABLE IF EXISTS public.template;

--
-- Create indexes for common queries
--

-- Index creation will happen during layer creation

COMMIT;
