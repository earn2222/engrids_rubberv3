FROM postgis/postgis:17-3.5

# Bake init SQL into image so Windows bind-mount issues don't matter.
# Files run in alphabetical order on fresh database (docker compose down -v).
COPY rub_v3.sql   /docker-entrypoint-initdb.d/01_rub_v3.sql
