FROM postgis/postgis:latest

# Bake init SQL into image so Windows bind-mount issues don't matter.
# Files run in alphabetical order on fresh database (docker compose down -v).
COPY rub2.sql   /docker-entrypoint-initdb.d/01_rub2.sql
COPY shpall.sql /docker-entrypoint-initdb.d/02_shpall.sql
