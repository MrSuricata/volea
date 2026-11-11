#!/usr/bin/env bash
# Corre las pruebas de la base del tanteador en una base NUEVA de un Postgres local (nunca en Supabase).
# Uso: supabase/pruebas/correr.sh "host=/tmp port=5432 user=postgres"   (por defecto: localhost)
set -euo pipefail
CONN="${1:-host=localhost user=postgres}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASE="arbitraje_pruebas_$$"
psql "$CONN dbname=postgres" -qAt -v ON_ERROR_STOP=1 -c "CREATE DATABASE $BASE" >/dev/null
trap 'psql "$CONN dbname=postgres" -qAt -c "DROP DATABASE IF EXISTS $BASE" >/dev/null' EXIT
P=(psql "$CONN dbname=$BASE" -qAt -v ON_ERROR_STOP=1)
"${P[@]}" -f "$DIR/pruebas/base_minima.sql" 2>/dev/null
# v37 dos veces: tiene que ser idempotente.
for f in v35_arbitraje.sql v36_arbitraje_formato_por_partido.sql v37_arbitraje_blindaje.sql v37_arbitraje_blindaje.sql; do
  "${P[@]}" -f "$DIR/migraciones_propuestas/$f" >/dev/null 2>&1 || { echo "ERROR aplicando $f"; "${P[@]}" -f "$DIR/migraciones_propuestas/$f"; exit 1; }
done
"${P[@]}" -f "$DIR/pruebas/arbitraje.sql" 2>&1 | grep -E 'ok ·|FALLA|ERROR|PASARON' | sed -E 's/^(psql:[^ ]* )?(NOTICE: +)?//'
"${P[@]}" -f "$DIR/pruebas/paridad_motor.sql" 2>&1 | grep -E 'FALLA|ERROR|PARIDAD' | sed -E 's/^(psql:[^ ]* )?(NOTICE: +)?//'
