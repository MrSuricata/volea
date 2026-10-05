# DUPR en la web VOLEA — guía de puesta en marcha

La web ya tiene armada la conexión oficial con DUPR (Partner API). Está **apagada**:
mientras las claves de abajo no estén cargadas en Vercel, la web funciona exactamente
igual que hoy (el DUPR ID se escribe a mano en la inscripción y el rating se pega en
el panel).

Documentación oficial de DUPR: https://dupr.gitbook.io/dupr-raas

## Qué hace cuando se prende

- **Inscripción:** en vez de escribir el DUPR ID, la persona toca **Conectar con
  DUPR**, inicia sesión en DUPR ahí mismo y autoriza. La web recibe su DUPR ID, su
  rating de dobles y de singles y su año de nacimiento, comprobados contra DUPR.
- **Rating siempre al día:** DUPR le avisa a la web cada vez que a un jugador
  conectado le cambia el rating. Se actualiza solo en el padrón (y por lo tanto en
  los topes por categoría de Inscripciones).
- **Partidos:** desde Panel → Torneos → **DUPR** se revisa un cuadro y se sincroniza:
  sube los partidos nuevos, corrige los que cambiaron y borra los que dejaron de
  corresponder. Los W.O. y los partidos con alguien sin DUPR conectado no van, y la
  lista dice por qué en cada caso.

## Lo que exige DUPR (y cómo está resuelto)

| Requisito de DUPR | En la web |
|---|---|
| Login con DUPR para todos; nada de DUPR ID a mano | Botón Conectar con DUPR en la inscripción y en el panel. Con la integración prendida el campo a mano desaparece del formulario |
| Rating visible y actualizado por avisos | `/api/dupr/webhook` recibe los avisos y actualiza el padrón |
| Controlar que la cuenta esté habilitada | Se consulta al conectar y de nuevo antes de subir partidos; quien no está habilitado queda afuera con el motivo |
| Subir, corregir y borrar partidos, solo el organizador | Panel → DUPR, con sesión de dueño o admin |
| Si se sube por un club, comprobar el rol | Antes de subir se comprueba con la cuenta DUPR de quien sube que es Director u Organizer de ese club |

## 1. Cuando DUPR conteste el mail

DUPR manda por mail las claves del **ambiente de prueba (UAT)**: una *client key*,
un *client secret*, 4 usuarios de prueba y un club de prueba. Las claves de
producción las dan recién después de revisar la integración (paso 4).

## 2. Cargar las claves en Vercel

Las pruebas se hacen en una copia de la web que no es la que ve el público (una
*preview* de la rama `feat/dupr-partner`), para no mezclar usuarios de prueba con
los reales.

En Vercel → proyecto `volea` → **Settings → Environment Variables**, cargá estas
variables **solo para el entorno Preview**:

| Variable | Valor |
|---|---|
| `DUPR_CLIENT_KEY` | la client key de UAT |
| `DUPR_CLIENT_SECRET` | el client secret de UAT |
| `DUPR_WEBHOOK_SECRET` | una clave larga inventada por nosotros (40 letras y números al azar). Es lo que prueba que un aviso viene de DUPR |
| `DUPR_ENTORNO` | `uat` |
| `DUPR_CLUB_ID` | el número del club de prueba. Vacío = los partidos se suben sin club |

`SUPABASE_SERVICE_ROLE_KEY` ya está cargada (la usa Mercado Pago); tiene que estar
disponible también en Preview.

Después: **Deployments → la última de la rama `feat/dupr-partner` → Redeploy**.

Dos cosas a revisar en esa preview:

- Que DUPR pueda llegar al webhook. Si el proyecto tiene *Deployment Protection*
  en las previews, DUPR recibe un 401 al registrar el aviso. O se desactiva para esa
  rama, o se carga `DUPR_WEBHOOK_URL` con la dirección completa del webhook
  incluyendo el parámetro de bypass de Vercel.
- La preview usa la **misma base** que producción. Lo que se guarda de DUPR queda
  marcado como `uat` y nunca toca el padrón, pero la inscripción de prueba hay que
  hacerla en un evento de prueba y borrarla al terminar.

## 3. Probar en UAT

1. Entrá al panel de la preview → Torneos → **DUPR**. Tiene que decir "Ambiente de
   prueba de DUPR (UAT)".
2. **Registrar en DUPR** (el aviso de cambios de rating). Si falla, DUPR no pudo
   llegar al webhook: ver el punto de arriba.
3. **Conectar mi cuenta DUPR** con el usuario de prueba que sea director del club
   de prueba. Tiene que quedar "Puede subir partidos del club".
4. Abrí el formulario de inscripción de un evento de prueba y conectá a los otros
   usuarios de prueba. Cada uno tiene que aparecer en "Cuentas conectadas" con su
   rating.
5. Armá un cuadro de prueba con esos jugadores (vinculados al padrón, con el DUPR ID
   de prueba), cargá resultados y en el panel de DUPR: **Revisar partidos** →
   **Sincronizar**. Después cambiá un resultado y sincronizá de nuevo (corrige), y
   marcá un partido como W.O. y sincronizá (borra).

Lo que hay que mirar con atención en esta etapa, porque no se pudo probar sin claves:

- El mensaje que manda la página de login de DUPR al terminar. El código acepta la
  forma documentada (`userToken`, `refreshToken`); si llegara distinto, "Conectar
  con DUPR" queda esperando.
- La respuesta de "mis clubes" (`/user/club/membership`): DUPR no documenta su
  forma exacta. El código acepta las variantes razonables.
- La renovación del token de un jugador (`/auth/v2.0/refresh`).

## 4. Pedir la revisión a DUPR

Cuando todo lo anterior anda, se le escribe a **tech@mydupr.com** con:

- el link de la preview,
- usuario y contraseña de prueba del panel,
- un resumen de cómo se cumple cada requisito (la tabla de arriba) con los pasos
  para probarlo.

Tardan hasta 10 días hábiles y, si aprueban, mandan las claves de producción.

**Antes de pedir la revisión falta decidir y hacer** (depende de lo que conteste
DUPR al mail inicial):

- **Evento solo para DUPR+.** DUPR pide que la plataforma ofrezca la opción. La
  columna `events.dupr_premium` ya existe; falta el interruptor en el evento y el
  control al inscribirse.
- **Sacar la carga a mano del panel.** Hoy en Jugadores e Inscripciones se puede
  escribir o pegar el DUPR ID y el rating. Con la integración en producción DUPR no
  lo permite: hay que ocultarlo.

## 5. Pasar a producción

1. Cargá en Vercel, para el entorno **Production**: `DUPR_CLIENT_KEY`,
   `DUPR_CLIENT_SECRET` (las de producción), `DUPR_WEBHOOK_SECRET` (una nueva),
   `DUPR_ENTORNO` = `prod` y `DUPR_CLUB_ID` con el club real.
2. Mergeá la rama a `master` y esperá el deploy.
3. Panel → DUPR → **Registrar en DUPR** y **Conectar mi cuenta DUPR**.
4. Avisales a los jugadores: cada uno conecta su cuenta una vez. Los DUPR ID que ya
   estaban cargados a mano no alcanzan: DUPR solo deja ver el rating de quien conectó.

## Por dentro

- `api/_lib/dupr.ts`: llamadas a DUPR y la lógica (qué partido va y cuál no, qué
  subir, corregir o borrar). `api/dupr/`: `config`, `conectar`, `webhook`, `admin`.
- `src/dupr/`: el botón Conectar con DUPR y el panel.
- Base: migración `v31_dupr_base.sql` (ya aplicada, todo aditivo). Tablas
  `dupr_conexiones`, `dupr_tokens`, `dupr_tickets`, `dupr_partidos`, `dupr_eventos`.
- Los tokens de los jugadores se guardan en `dupr_tokens`, una tabla sin ninguna
  política: solo la lee el servidor.
