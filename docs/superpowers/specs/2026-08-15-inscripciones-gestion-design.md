# Gestión de inscripciones: armado, parejas, alta manual y export

**Fecha**: 2026-08-15 · **Aprobado por Brian** (chat): alta+edición manual SÍ, umbral de viabilidad
**4** duplas/jugadores, export con el formato de su planilla, dupla 10 = Masculino A confirmado.

## Contexto

La pestaña Inscripciones (2026-08-14) muestra Recientes y Por categoría, pero Brian gestiona a
ciegas: no ve de un vistazo qué categorías "se arman", quién busca pareja, ni puede cargar las
inscripciones que le llegan por WhatsApp (hoy van a un excel que yo sincronizo a mano — v2
sincronizada 15/8: 30 inscripciones, 69 en el padrón). Objetivo: la web pasa a ser LA fuente de
verdad y el excel una foto exportable.

## Pieza 1 — Resumen "Armado" (semáforo)

- Helper puro `resumenArmado(secciones, porId)` en `utils/inscripciones.ts`, sobre el output de
  `armarSeccionesCategoria`. Por categoría:
  - **Dobles**: `duplasArmadas` (mención mutua), `duplasDeclaradas` (suelto CON pareja declarada
    — su compañero existe aunque no se haya anotado), `buscanPareja` (suelto sin pareja).
    Unidades jugables = armadas + declaradas.
  - **Singles**: unidades = personas.
  - `nivel`: verde ≥ 4 unidades · ámbar 2-3 · gris 0-1 (umbral de Brian; constante exportada
    `MIN_UNIDADES_VIABLE = 4`).
- UI: grilla de tarjetas compactas SIEMPRE visible arriba de las vistas (nombre de categoría,
  "N duplas + M buscan" o "N jugadores", borde/punto de color según nivel). Categorías en 0 se
  agrupan al final atenuadas.

## Pieza 2 — Buscan pareja + cruces + falta inscribirse

- `buscanPareja(...)`: sueltos sin pareja por categoría. **Cruces sugeridos**: ≥2 buscando en la
  misma categoría → "podrían jugar juntos". En **Mixto** el género se INFIERE de las otras
  categorías del jugador (`generoDe`: juega algo "Femenino" → F, "Masculino" → M, ambas o
  ninguna → desconocido); se sugieren solo cruces F+M o con desconocido.
- `faltaInscribirse(...)`: parejas declaradas cuyo nombre normalizado no matchea ninguna
  inscripción activa del evento → lista {nombre declarado, lo declaró, categoría}.
- UI: dos tarjetas bajo el semáforo (ámbar "Buscan pareja" con los cruces resaltados; gris
  "Falta que se anoten"), ocultas si están vacías.

## Pieza 3 — Alta y edición manual

- Migración: policy nueva `inscripciones_admin_insert` (`for insert with check (is_admin())`) —
  hoy los admins pueden SELECT/UPDATE/DELETE pero NO insertar (el alta pública va por RPC).
- Service: `addInscripcionAdmin(input: InscripcionInput & { estado })` (insert directo con techo,
  sin las validaciones de la RPC pública: celular OPCIONAL, sirve aunque el evento cierre) y
  `updateInscripcionAdmin(id, cambios)` (nombre, celular, email, categorias, parejas, duprId,
  notas, estado).
- UI: botón **"Nueva inscripción"** en el header de la pestaña + **lápiz** en cada fila de
  Recientes. Modal (en el mismo archivo del tab, patrón AdminCajaTab): nombre con datalist del
  padrón, celular, email, DUPR, chips de categorías del evento (∪ las de la fila al editar),
  un campo de pareja por categoría de dobles elegida (datalist), notas, estado
  (pendiente/confirmada). Validación mínima: nombre + ≥1 categoría.

## Pieza 4 — Export "planilla" (formato Brian)

- `src/utils/inscripcionesExcel.ts`: armado de filas PURO (`armarFilasPlanilla`, testeable) +
  escritor con **exceljs por `import()` dinámico** (chunk aparte, patrón cajaExcel — ojo DEV:
  el primer click puede recargar por optimize de Vite; en prod no pasa).
- Hoja **DOBLES**: columnas `# | Participante | Telefono contacto | Nivel | Estado Pago |
  Forma de pago | MONTO | RACKET POINT | VOLEA`. Duplas numeradas con 2 filas: mutuas → ambos
  inscriptos; declaradas → el inscripto + fila con el nombre declarado; buscan → el inscripto +
  fila "CONFIRMAR". Nivel en el formato del sheet (mapeo INVERSO: "Doble Masculino A" → "MASC A",
  "Singles Femenino B" → "SINGLE FEM B"). Estado Pago: confirmada → "Pagado", pendiente →
  "Pendiente". MONTO/Forma/RACKET POINT/VOLEA vacíos (los completa Brian).
- Hoja **SINGLES**: una fila por jugador por categoría de singles.
- Botón "Exportar planilla" junto a "Actualizar" (estado exporting, patrón Caja).

## Sin cambios

Form público, RPC `inscribir_evento`, badge, sync de torneos, Caja.

## Testing

- Unit: `resumenArmado` (umbral 4, dobles vs singles, declaradas cuentan), `generoDe`,
  cruces de `buscanPareja` (Fem directo, Mixto F+M sí / F+F no, desconocido sí),
  `faltaInscribirse`, `armarFilasPlanilla` (numeración, CONFIRMAR, nivel inverso, estados).
- Gates: suite verde (236+), `npx tsc -b`, `npm run build`. E2E: alta manual de prueba → editar
  → export con la fila → borrar la prueba (dar de baja + verificación SQL).
