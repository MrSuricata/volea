# Caja: cuentas entre socios + export Excel — diseño

Fecha: 2026-07-28 · Pedido de Brian: poder descargar desde la Caja un Excel con el
reporte de gastos/egresos asociado a cada persona que los registra, e incorporar a la
Caja el Excel histórico de gastos de los socios (`Gastos_Marca.xlsx`).

## Contexto

- La Caja del admin muestra `bot_ledger` (ventas/gastos que el equipo carga por el bot
  de Telegram), con `reported_by` como persona que registró.
- Los socios llevaban aparte un Excel con gastos repartidos **Brian 50% / Paula 25% /
  Gastón 25%** en cuatro áreas (Marca, Showroom, Cafetería, Estadía CRP), pagos entre
  socios, repartos de ventas y un neto en ARS del viaje a Bs.As.
- Al verificar ese Excel se detectó que sus saldos visibles estaban desactualizados
  (tablas dinámicas sin refrescar y rangos de suma viejos). Los saldos reales
  recalculados sobre todas las filas: Brian +30.028,15 · Paula +48.105,17 ·
  Gastón −78.133,32 (positivo = debe al grupo; suman 0).

## Decisiones

1. **Tabla nueva `socio_moves`** (no se mezcla con `bot_ledger`, que es la caja
   operativa del bot). Cada fila guarda su impacto exacto por socio
   (`imp_brian/imp_paula/imp_gaston`, suman ~0, con CHECK) para ser fiel al Excel
   incluso en repartos no estándar (tercios de la estadía CRP, filas con 33%).
   RLS: SELECT/INSERT/DELETE solo para admins autenticados (`is_admin()`).
2. **Importación única** de las 463 filas del Excel (`source='excel-2026-07-28'`,
   `orden` preserva el orden original). Verificada por SQL: los saldos importados
   reproducen exactamente el recálculo. Las cuotas futuras ya cargadas (hasta 2027)
   cuentan como deuda asumida, igual que en el Excel. El neto ARS va como una fila
   `ajuste` en moneda ARS y nunca se mezcla con los saldos UYU.
3. **UI**: sección "Cuentas entre socios" al pie de la pestaña Caja
   (`AdminSociosSection.tsx`): saldos por socio, banner ARS, filtros por área/tipo,
   alta de gasto compartido (split 50/25/25 calculado y previsualizado) y de pago
   entre socios, borrado con confirmación. Sin edición: se borra y se vuelve a cargar.
4. **Export**: botón "Descargar Excel" en la Caja (`utils/cajaExcel.ts`, exceljs por
   `import()` dinámico para no engordar el bundle). Hojas: Resumen (totales +
   por persona + saldos socios), Movimientos bot completos, Gastos por persona con
   subtotales, Ventas por persona y método, Cuentas socios.
5. Los movimientos del bot **no** generan filas de socios automáticamente (registran
   personas que no son socios y no todo gasto del bot es repartible); si un gasto del
   bot corresponde a los socios, se carga a mano en la sección.

## Verificación

- Build de producción OK; exceljs en chunk propio (~940 KB solo al exportar).
- E2E con admin temporal (creado y borrado vía SQL): login, saldos exactos en
  pantalla, alta de gasto de prueba (impactos correctos, saldos actualizados),
  borrado (saldos restaurados), export descargado y validado contra la base
  (por persona, totales y 463 filas de socios).
