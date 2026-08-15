# Gastos en cuotas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cargar un gasto de socios en N cuotas mensuales (una fila `socio_moves` por cuota, atadas por `cuota_grupo`), con preview, chip de cuota futura y borrado en grupo.

**Architecture:** Helper puro `armarCuotas` en `utils/socios.ts` (TDD). `addSocioMove` evoluciona a `addSocioMoves(inputs[])` con un solo insert atómico (único call chain App→SociosTab→SociosSection). Columna nueva `cuota_grupo text` vía migración MCP. UI solo en el form de Gasto de AdminSociosSection.

**Tech Stack:** React 19 + Vite + TS, Supabase, vitest. Gates: `npx tsc -b`, `npm run build`.

**Spec:** `docs/superpowers/specs/2026-08-15-gastos-en-cuotas-design.md`

---

### Task 1: `armarCuotas` con TDD

**Files:**
- Modify: `src/utils/socios.ts` (agregar helper + tipo `Cuota`)
- Test: `src/utils/socios.cuotas.test.ts` (archivo nuevo; no tocar tests existentes si los hay)

- [ ] **Step 1: Test que falla**:

```ts
import { describe, expect, it } from 'vitest';
import { armarCuotas } from './socios';

describe('armarCuotas', () => {
  it('n=1: una cuota con el total y la fecha tal cual', () => {
    expect(armarCuotas(1500, 1, '2026-08-15')).toEqual([{ monto: 1500, fecha: '2026-08-15' }]);
  });
  it('divide en cuotas iguales, la última absorbe los centavos', () => {
    const c = armarCuotas(1000, 3, '2026-08-15');
    expect(c.map(x => x.monto)).toEqual([333.33, 333.33, 333.34]);
    expect(c.map(x => x.fecha)).toEqual(['2026-08-15', '2026-09-15', '2026-10-15']);
    expect(Math.round(c.reduce((s, x) => s + x.monto, 0) * 100) / 100).toBe(1000);
  });
  it('fin de mes con tope: compra el 31 → 30/28 en meses cortos', () => {
    const c = armarCuotas(300, 4, '2026-08-31');
    expect(c.map(x => x.fecha)).toEqual(['2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30']);
  });
  it('cruza el año y pisa febrero', () => {
    const c = armarCuotas(600, 3, '2026-12-31');
    expect(c.map(x => x.fecha)).toEqual(['2026-12-31', '2027-01-31', '2027-02-28']);
  });
  it('12 cuotas: 12 meses corridos', () => {
    const c = armarCuotas(12000, 12, '2026-08-15');
    expect(c).toHaveLength(12);
    expect(c[11].fecha).toBe('2027-07-15');
    expect(c.every(x => x.monto === 1000)).toBe(true);
  });
});
```

- [ ] **Step 2**: `npx vitest run src/utils/socios.cuotas.test.ts` → FAIL (armarCuotas no existe).

- [ ] **Step 3: Implementación** en `utils/socios.ts`:

```ts
export interface Cuota { monto: number; fecha: string }

/**
 * Divide una compra en n cuotas mensuales. La cuota se redondea a centésimos y
 * la ÚLTIMA absorbe la diferencia (la suma da exacto el total). Fechas: mismo
 * día que la primera, con tope de fin de mes (31/8 → 30/9), como la tarjeta.
 * La fecha se inyecta (nada de Date.now()): tests deterministas.
 */
export function armarCuotas(total: number, n: number, primeraISO: string): Cuota[] {
  const [y, m, d] = primeraISO.split('-').map(Number);
  const base = Math.round((total / n) * 100) / 100;
  const cuotas: Cuota[] = [];
  for (let i = 0; i < n; i++) {
    const mesIdx = (m - 1) + i;
    const yy = y + Math.floor(mesIdx / 12);
    const mm = (mesIdx % 12) + 1;
    const ultimoDia = new Date(yy, mm, 0).getDate();
    const dd = Math.min(d, ultimoDia);
    cuotas.push({ monto: base, fecha: `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` });
  }
  cuotas[n - 1] = { ...cuotas[n - 1], monto: Math.round((total - base * (n - 1)) * 100) / 100 };
  return cuotas;
}
```

- [ ] **Step 4**: `npx vitest run` → verde. `npx tsc -b` limpio.
- [ ] **Step 5**: Commit `feat(socios): armarCuotas — division en cuotas mensuales con tope de fin de mes`.

### Task 2: Migración `cuota_grupo`

- [ ] **Step 1**: `apply_migration` (nombre `socio_moves_cuota_grupo`):

```sql
alter table socio_moves add column if not exists cuota_grupo text;
```

- [ ] **Step 2**: Verificar con `select column_name from information_schema.columns where table_name='socio_moves';` que la columna existe.

### Task 3: Tipos + service (insert atómico en lote, delete por grupo)

**Files:**
- Modify: `src/types.ts:116-148` (SocioMove + SocioMoveInput: `cuotaGrupo`)
- Modify: `src/services/supabaseService.ts:387-452`

- [ ] **Step 1**: `SocioMove` gana `cuotaGrupo: string | null;` (después de `source`); `SocioMoveInput` gana `cuotaGrupo?: string | null;`.
- [ ] **Step 2**: `getSocioMoves` mapea `cuotaGrupo: row.cuota_grupo ?? null`.
- [ ] **Step 3**: Reemplazar `addSocioMove` por:

```ts
/**
 * Alta de movimientos de socios. Acepta varios (las cuotas de una compra van
 * juntas) y hace UN solo insert: o entran todas o ninguna. Cada fila tiene que
 * cerrar en cero por su cuenta (protege la contabilidad ante bugs del form).
 */
async addSocioMoves(inputs: SocioMoveInput[]): Promise<boolean> {
  if (!supabase || inputs.length === 0) return false;
  for (const input of inputs) {
    const suma = input.impBrian + input.impPaula + input.impGaston;
    if (Math.abs(suma) > 0.04 || !(input.monto > 0)) {
      console.error('Movimiento de socios inválido:', input);
      return false;
    }
  }
  const filas = inputs.map(input => ({
    area: input.area,
    tipo: input.tipo,
    fecha: input.fecha,
    descripcion: input.descripcion,
    monto: Math.round(input.monto * 100) / 100,
    pagador: input.pagador,
    de: input.de,
    para: input.para,
    moneda: 'UYU',
    imp_brian: input.impBrian,
    imp_paula: input.impPaula,
    imp_gaston: input.impGaston,
    source: 'web',
    cuota_grupo: input.cuotaGrupo ?? null,
  }));
  const { error } = await conTechoEscritura(supabase.from('socio_moves').insert(filas));
  if (error) { console.error('Error adding socio moves:', error); return false; }
  return true;
},
```

- [ ] **Step 4**: Agregar `deleteSocioMovesGrupo`:

```ts
/** Borra TODAS las cuotas de una compra (mismo cuota_grupo). */
async deleteSocioMovesGrupo(grupo: string): Promise<boolean> {
  if (!supabase || !grupo) return false;
  const { error } = await conTechoEscritura(supabase.from('socio_moves').delete().eq('cuota_grupo', grupo));
  if (error) { console.error('Error deleting cuotas:', error); return false; }
  return true;
},
```

- [ ] **Step 5**: Actualizar la cadena de props: en App.tsx el render de `AdminSociosTab` pasa `addSocioMoves={SupabaseService.addSocioMoves}` y `deleteSocioMovesGrupo={SupabaseService.deleteSocioMovesGrupo}` (renombrar la prop vieja `addSocioMove`); `AdminSociosTab` los tipa y los re-pasa a `AdminSociosSection` como `onAddMany` y `onDeleteGrupo` (la prop `onAdd` desaparece — el alta simple llama `onAddMany([input])`).
- [ ] **Step 6**: `npx tsc -b` limpio (el compilador delata cualquier call site olvidado). Commit `feat(socios): alta en lote atomica + delete por grupo (tipos, service, props)`.

### Task 4: Form con campo Cuotas + preview

**Files:**
- Modify: `src/components/AdminSociosSection.tsx` (FormState, bloque gasto del modal ~452-475, handleSave 132-157)

- [ ] **Step 1**: `FormState` gana `cuotas: string` (default `'1'` en `FORM_INICIAL`). En el bloque de campos de gasto, junto al monto:

```tsx
<div>
  <label className={labelCls}>Cuotas</label>
  <input type="number" min={1} max={36} step={1} value={form.cuotas}
    onChange={e => setForm(f => ({ ...f, cuotas: e.target.value }))} className={selectCls} />
</div>
```

- [ ] **Step 2**: Derivar `const cuotasNum = Math.floor(Number(form.cuotas) || 1)` y
  `const cuotasOk = form.tipo !== 'gasto' || (cuotasNum >= 1 && cuotasNum <= 36 && (!montoOk || montoNum >= cuotasNum * 0.01))`;
  sumar `cuotasOk` a `formValido`. Preview con n>1 (bajo el monto, usa `armarCuotas` con `form.fecha || hoyISO()`):

```tsx
{form.tipo === 'gasto' && montoOk && cuotasNum > 1 && (
  <p className="text-xs text-gray-500">
    {cuotasNum} cuotas de {money2(cuotasPreview[0].monto)}
    {cuotasPreview[cuotasNum - 1].monto !== cuotasPreview[0].monto && ` (última ${money2(cuotasPreview[cuotasNum - 1].monto)})`}
    {' — '}{mesCorto(cuotasPreview[0].fecha)} a {mesCorto(cuotasPreview[cuotasNum - 1].fecha)}
  </p>
)}
```

  con `mesCorto('2026-09-15') → 'sep-26'` (helper local con array de meses).

- [ ] **Step 3**: `handleSave` para gasto con `cuotasNum > 1`: generar `grupo = 'cuo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)` y mapear `armarCuotas(montoNum, cuotasNum, form.fecha || hoyISO())` a inputs (descripción `«${desc} (cuota ${i + 1}/${n})»`, fecha de la cuota, `pagador`, impactos `impactosGasto(c.monto, form.pagador)`, `cuotaGrupo: grupo`) → `onAddMany(inputs)`. Todos los demás caminos: `onAddMany([input])` sin `cuotaGrupo`. Toast de éxito con n: «Gasto en 6 cuotas agregado a las cuentas».
- [ ] **Step 4**: Smoke en dev + `npx tsc -b`. Commit `feat(socios): campo Cuotas con preview en el alta de gasto`.

### Task 5: Chip «vence» + borrado en grupo

**Files:**
- Modify: `src/components/AdminSociosSection.tsx` (fila de la lista ~360-380, modal de confirmación de borrado, `deleteConfirm`)

- [ ] **Step 1**: En la fila, si `esCuotaFutura(m)`: chip `<span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">vence {mesCorto(m.fecha!)}</span>` (para filas sin fecha con periodo del Excel: mostrar `vence {m.periodo}`).
- [ ] **Step 2**: `deleteConfirm` pasa de `string | null` a `SocioMove | null` (los call sites del tachito pasan `m`). En el modal: si `deleteConfirm.cuotaGrupo`, mostrar cuántas cuotas hermanas hay (`moves.filter(x => x.cuotaGrupo === g).length`) y dos botones: «Borrar solo esta cuota» (flujo actual con `onDelete(m.id)`) y «Borrar la compra entera (N cuotas)» → `handleDeleteGrupo` que llama `onDeleteGrupo(g)` con el mismo patrón saving/toast/refresh. Sin grupo: el confirm de siempre.
- [ ] **Step 3**: `npx tsc -b` + `npx vitest run` (236 esperados). Commit `feat(socios): chip de cuota futura + borrar compra entera por grupo`.

### Task 6: Gates + deploy + E2E

- [ ] `npx vitest run` todo verde, `npx tsc -b`, `npm run build`.
- [ ] `git push` → Vercel; esperar READY vía MCP.
- [ ] E2E prod: alta de gasto de prueba en 3 cuotas ($30, área otros) → verificar 3 filas con fechas ago/sep/oct y saldo hoy solo con la primera; borrar la compra entera; verificar por SQL que no quedó nada. Actualizar memoria volea-estado.

## Self-review del plan

- Spec cubierto: helper→T1, migración→T2, tipos/service/props→T3, form→T4, chip+borrado→T5, testing→T1/T6. Sin huecos.
- Consistencia: `addSocioMoves(inputs)`/`onAddMany`/`onDeleteGrupo`/`cuotaGrupo` usados con el mismo nombre en T3-T5; `armarCuotas(total, n, primeraISO)` idéntico en T1 y T4.
- Orden seguro: la migración (T2) va antes que el código que escribe `cuota_grupo` (T3+); el código viejo ignora la columna nueva.
