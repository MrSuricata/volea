# Tanteador de árbitros con código por partido — diseño

Fecha: 2026-10-27 · Pedido de Brian: "el salto de calidad" de los torneos VOLEA.

## Objetivo

Que cada partido de un torneo del gestor (grupos o llave) lo marque un árbitro desde su celular,
punto a punto, entrando solo con un **código de 4 dígitos de ese partido** (sin cuenta), y que:

- el marcador se vea **en vivo** en la TV del club, en la página pública del torneo y en el panel En vivo;
- al terminar, el **resultado entre solo al cuadro** (el ganador avanza, la cancha se libera), y Brian
  lo pueda corregir después desde el gestor como hoy.

No reemplaza al tanteador de bádminton (`tanteador_partidos`, `/copa`): es otro deporte y queda como está.

## Decisiones de Brian

| Tema | Decisión |
|---|---|
| Tipo de tanteo | Rally o saque tradicional (side out), **elegible por categoría** |
| Formato | Un game o al mejor de 3, **por categoría** (uno para la fase de grupos y otro para la llave) |
| Dónde se ve en vivo | TV del club, página pública del torneo, panel En vivo |
| Cierre | Entra **directo** al cuadro; Brian corrige si hace falta |
| Acceso | **Un código por partido** |

## Reglas de pickleball que implementa el motor

- **Side out (tradicional):** solo suma el que saca. En dobles hay servidor 1 y 2; el primer saque del
  game arranca como servidor 2 ("0-0-2"). Si pierde el servidor 1, pasa al 2; si pierde el 2, side out.
  El que sacó primero en el game está a la derecha con su puntaje par. Canto: saque-recibe-servidor.
  En singles no hay servidor 2. Games a 11 (o 15/21), por 2.
- **Rally:** cada rally suma un punto para el que lo gana; si gana el que recibe, además le pasa el saque.
  Games a 15 o 21 por 2 (configurable). Canto: saque-recibe.
- **Cambio de lado:** en el game decisivo (o único), cuando el primero llega a 6 (game a 11), 8 (a 15) u 11 (a 21).
- **Mejor de 3:** gana el que llega a 2 games; entre games se cambia de lado y saca el que no sacó primero el anterior.
- **Tiempos:** 2 por equipo por game (a 11/15), 3 en games a 21; el árbitro los marca y el marcador lo muestra.

## Arquitectura

### Datos (migración v35, aditiva)

Tabla nueva `arbitraje_partidos` — una fila por partido de torneo que se arbitra:

- `torneo_id text`, `partido_id text` (únicos juntos), `estado` (`pendiente` / `en_juego` / `terminado`).
- El **código vive en otra tabla, `arbitraje_codigos`**, sin lectura pública ni Realtime: la tabla del
  marcador se transmite a todos los que miran y el código no puede viajar ahí.
- `formato jsonb`: `{tipo: 'rally'|'sideout', a: 11|15|21, mejorDe: 1|3, dobles: bool}`, copiado de la
  categoría al crear el código.
- `jugadas jsonb`: la lista de eventos (`saque_inicial`, `gana_saque`, `gana_recibe`, `tiempo`, `deshacer`
  no se guarda: se borra el último), de la que el motor reconstruye el estado completo.
- `marcador jsonb`: resumen ya calculado (games, puntos, quién saca, servidor, lado), para que la TV y la
  web pública lo lean sin rehacer el cálculo.
- `version int` (control de concurrencia), `actualizado timestamptz`, `intentos_fallidos` por IP/código.
- RLS: `arbitraje_partidos` lectura pública (no tiene secretos); `arbitraje_codigos` sin acceso para
  nadie salvo las funciones. Escritura **solo** por RPC.
- `arbitraje_intentos (origen, cuando)`: los códigos fallidos, para frenar a quien prueba números.
- Realtime activado (como `tanteador_partidos`).

### Funciones de la base (SECURITY DEFINER)

- `arbitro_entrar(codigo)`: valida el código (partido no terminado), con freno a los intentos al azar
  (10 fallos en 10 minutos desde el mismo origen → espera), y devuelve `torneo_id`, `partido_id`,
  formato, jugadas, estado y `version`. Los nombres los arma la pantalla leyendo el cuadro público
  (`rk_torneos`) con el motor de llaves, así funcionan también los cruces que dependen de otro partido.
- `arbitro_marcar(codigo, version, jugadas, marcador)`: guarda el estado nuevo si `version` coincide
  (si no, devuelve el estado vigente para que el celular se ponga al día).
- `arbitro_terminar(codigo, version)`: valida que el marcador final sea un resultado legal, lo escribe en
  `rk_torneos.data` (puntos del partido; en mejor de 3, los games ganados + el detalle de cada game en
  `games`), con el mismo bloqueo optimista por `updated_at` que usa hoy `guardarResultado`, marca
  `cargadoEl`, libera la cancha en `rk_en_cancha` y deja el código sin efecto.
- `admin_codigos_torneo(torneo_id)` (solo equipo): crea los códigos que falten para todos los partidos del
  torneo y devuelve la lista para la hoja.

### Web

- **Motor puro** `src/torneos/arbitraje/motor.ts` (+ tests): `estadoDe(formato, jugadas)` → marcador,
  quién saca, servidor, lado, canto, aviso de cambio de lado, fin de game/partido. Todo determinista.
- **Pantalla del árbitro** `/arbitro` (pública, sin login, apta celular en vertical):
  código → confirmar partido → elegir quién saca primero y quién arranca a la derecha → dos botones
  grandes "Ganó el que saca" / "Ganó el que recibe", Deshacer, Tiempo, canto en grande, aviso de cambio
  de lado y de fin de game → Terminar (pide confirmación con el resultado) → "Resultado cargado".
  Guarda en el teléfono la cola de jugadas sin enviar y la sube cuando vuelve la señal.
- **Gestor**: en Ajustes de cada categoría, el formato de arbitraje (tipo, puntos, mejor de 3, y si cambia
  para semis/final). Botón **"Códigos de árbitro"**: hoja ordenada por cancha/horario para imprimir o
  copiar por WhatsApp.
- **En vivo / TV / pública**: donde hoy se muestra el partido en cancha, se suma el marcador en vivo
  (games, puntos, quién saca) cuando ese partido tiene árbitro.

### Resultado en el cuadro

- Un game: `puntosA/puntosB` = puntos del game (como hoy).
- Mejor de 3: `puntosA/puntosB` = games ganados (2-0 o 2-1) y `games: [{a, b}]` con el detalle (nuevo
  campo opcional en `PartidoGrupo`/`PartidoLlave`). En una fase de grupos al mejor de 3 la tabla desempata
  por diferencia de games (lo que ya hace con `puntosA/puntosB`). El export a DUPR usa `games` si existe.
- `arbitro_terminar` no pisa un partido que ya tiene resultado (cargado a mano desde el gestor o En vivo).

## Fuera de alcance (v1)

Estadísticas por jugador, video, cuentas de árbitro con usuario, firma de jugadores, subida automática a
DUPR, tanteador de bádminton.

## Pruebas

- Motor: side out (0-0-2, rotación de servidores, side out, lados), rally, cambio de lado a 6/8/11,
  win by 2, mejor de 3, tiempos, deshacer en cualquier punto, fin de partido.
- Base: código inválido / terminado / intentos al azar; versión vieja; terminar dos veces; resultado que
  no cierra; partido de llave que avanza; cancha liberada.
- Pantallas: harness de Playwright con la base en memoria (como los de En vivo), en ancho de celular.
