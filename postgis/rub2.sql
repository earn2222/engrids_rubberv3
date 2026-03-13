--
-- PostgreSQL database dump for rub2
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
-- Name: rub2; Type: DATABASE; Schema: -; Owner: postgres
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

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

ALTER SCHEMA public OWNER TO postgres;

--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';

--
-- LayerList table to keep track of all layers
--

CREATE TABLE public.layerlist (
    id SERIAL PRIMARY KEY,
    tb_name text UNIQUE,
    remark text,
    created_at timestamp DEFAULT NOW(),
    updated_at timestamp DEFAULT NOW()
);

ALTER TABLE public.layerlist OWNER TO postgres;

--
-- Template table for rubber plot data
-- Table naming convention: tb_[province]_[person_name]
-- Example: tb_champhon_earn
--

-- This is a template - actual tables will be created dynamically with names like:
-- tb_champhon_earn, tb_rayong_somchai, etc.

CREATE TABLE public.tb_template (
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

ALTER TABLE public.tb_template OWNER TO postgres;

-- Drop template table after schema definition
DROP TABLE IF EXISTS public.tb_template;

--
-- Create indexes for common queries
--

-- Index creation will happen during layer creation

COMMIT;
