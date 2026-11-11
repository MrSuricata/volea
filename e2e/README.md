# Pruebas de punta a punta de torneos (e2e)

Manejan la app real en Chromium (Playwright) contra una **base Supabase falsa en memoria**. No tocan
ninguna base remota: todo pedido a `scftuxrtflfowohiewsc.supabase.co` se resuelve en
`lib/fakeSupabase.cjs` y cualquier otro host externo se aborta.

## Cómo correrlas

```bash
node e2e/run.cjs                 # todo (~31 escenarios, ~8 min)
node e2e/run.cjs --listar        # lista de escenarios
node e2e/run.cjs gestor          # grupo: gestor | gestor-celular | arbitro | publico | sin-base
node e2e/run.cjs arbitro-sin-red # uno suelto
```

El runner levanta Vite en `127.0.0.1:5311` (con `e2e/vite.e2e.config.mjs`, que no vigila `.claude/`)
si no está arriba, y lo apaga al terminar. Requiere `playwright` resoluble con `require` y Chromium
instalado. Capturas y `reporte.json` (pasos, verificaciones fallidas, consola, red, desbordes) quedan
en `$E2E_CAPTURAS/<escenario>/` (por defecto el scratchpad de la sesión). No hace falta `.env.local`:
la URL de Supabase está fija en `src/services/supabaseClient.ts` y la app no lee `VITE_SUPABASE_*`.

## Estructura

- `lib/fakeSupabase.cjs` — GoTrue + PostgREST + RPC (`is_admin_email`, `arbitro_entrar/marcar/terminar`
  v36, `admin_codigos_torneo`) + Realtime (Phoenix vsn 2.0.0).
- `lib/harness.cjs` — navegador, contextos, registro de consola/red, chequeo de desborde y textos cortados.
- `lib/gestor.cjs`, `lib/arbitro.cjs` — cómo se maneja cada pantalla; `lib/oraculo.cjs` — qué tiene que
  dar (gana siempre la pareja más fuerte; tablas, clasificados, tabla general y llaves calculadas aparte;
  tanteo rally/side out escrito aparte del motor de la app).
- `escenarios/` — gestor (8 formatos × una rueda / ida y vuelta, + 3 en celular), árbitro, público, sin base.

## Aproximaciones de la base falsa (pueden esconder bugs reales)

- RLS a mano: `rk_torneos` anon solo `visible = true`, escritura solo equipo; `rk_jugadores/config/programa/en_cancha`
  lectura pública, escritura equipo; `arbitraje_*` según v35. No se ejecutan las políticas reales.
- `rk_torneos.evento` se deriva de `data.evento` (la columna no está definida en el repo).
- Timestamps: se guardan en ms (Postgres guarda µs) y se devuelven con `+00:00`.
- Sin transacciones ni `FOR UPDATE`: las RPC corren atómicas en un solo hilo (no hay carreras reales).
- `x-forwarded-for`: todos los contextos salen por la misma IP (como el wifi del club). En producción
  depende del proxy de Supabase.
- Realtime: se publica todo cambio de `arbitraje_partidos`, `rk_torneos`, `rk_en_cancha`, `rk_programa`
  a cualquiera (sin RLS de Realtime ni filtros por fila).
- Tablas fuera de torneos (productos, pedidos, caja…) devuelven `[]`; storage no está implementado.
- El corte de red se simula abortando los pedidos (Playwright no aplica `setOffline` a pedidos interceptados).
