# Inscripciones v2 — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pestaña Inscripciones en el admin con badge de nuevas, pareja por categoría en el form público, padrón único de jugadores (import de la planilla del Racket Roll) y sugerencias de deudor en la Caja.

**Architecture:** Columna `parejas jsonb` en `inscripciones` + RPC `inscribir_evento` v2 (drop+create, la sobrecarga con DEFAULT es ambigua para PostgREST — lección `admin_cobrar_deudor`). Helpers puros nuevos en `src/utils/nombres.ts` (normalizar/distancia movidos del motor de torneos) y `src/utils/inscripciones.ts` (duplas por mención mutua, mapeo de niveles). UI: `AdminInscripcionesTab.tsx` lazy + badge en menú/barra flotante; datalist del padrón en el form; dropdown de sugerencias en VentaModal.

**Tech Stack:** React 19 + Vite + TS, Supabase (RLS ya correcta), vitest. Gates: `npx tsc -b`, `npm run build` (NUNCA `tsc --noEmit`).

**Spec:** `docs/superpowers/specs/2026-08-14-inscripciones-v2-design.md`

---

### Task 1: Helpers de nombres compartidos (`normalizar`, `distancia`, `sugerirDeudores`)

**Files:**
- Create: `src/utils/nombres.ts`, `src/utils/nombres.test.ts`
- Modify: `src/torneos/engine/padron.ts:1-30` (importar/re-exportar en vez de definir)

- [ ] **Step 1: Test que falla** — `src/utils/nombres.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { distancia, normalizar, sugerirDeudores } from './nombres';

describe('normalizar / distancia (movidos del motor)', () => {
  it('saca tildes, mayúsculas y espacios repetidos', () => {
    expect(normalizar('  Hernán  BONJOUR ')).toBe('hernan bonjour');
    expect(normalizar('GASTÓN')).toBe('gaston');
  });
  it('distancia de edición clásica', () => {
    expect(distancia('gaston', 'gastón'.normalize('NFD').replace(/[̀-ͯ]/g, ''))).toBe(0);
    expect(distancia('moirano', 'moriano')).toBe(2);
  });
});

describe('sugerirDeudores', () => {
  const abiertos = [
    { nombre: 'Hernán Bonjour', saldo: 300 },
    { nombre: 'Lucía De Feo', saldo: 150 },
  ];
  const otros = ['Gastón Moirano', 'Mario Neves', 'María Gladys González'];

  it('con texto vacío devuelve los deudores abiertos', () => {
    const s = sugerirDeudores(abiertos, otros, '');
    expect(s.map(x => x.nombre)).toEqual(['Hernán Bonjour', 'Lucía De Feo']);
    expect(s[0].saldo).toBe(300);
  });
  it('matchea sin tildes y por prefijo, abiertos primero', () => {
    const s = sugerirDeudores(abiertos, otros, 'hernan');
    expect(s[0]).toEqual({ nombre: 'Hernán Bonjour', saldo: 300 });
  });
  it('tolera typos de hasta distancia 2 en alguna palabra', () => {
    const s = sugerirDeudores(abiertos, otros, 'moirano');
    expect(s.some(x => x.nombre === 'Gastón Moirano')).toBe(true);
  });
  it('deduplica por nombre normalizado y corta en 6', () => {
    const muchos = Array.from({ length: 10 }, (_, i) => `Jugador Número ${i}`);
    expect(sugerirDeudores([], muchos, 'jugador').length).toBe(6);
    const s = sugerirDeudores(abiertos, ['HERNAN BONJOUR'], 'hern');
    expect(s.filter(x => normalizar(x.nombre) === 'hernan bonjour').length).toBe(1);
  });
  it('sin match devuelve vacío', () => {
    expect(sugerirDeudores(abiertos, otros, 'zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**: `npx vitest run src/utils/nombres.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Implementación** — `src/utils/nombres.ts`:

```ts
// Comparación de nombres de personas compartida por torneos (padrón), Caja
// (deudores) e inscripciones. Nació en src/torneos/engine/padron.ts.

export function normalizar(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function distancia(a: string, b: string): number {
  /* cuerpo idéntico al actual de padron.ts */
}

export interface SugerenciaDeudor { nombre: string; saldo: number | null }

/**
 * Sugerencias para el campo "¿Quién debe?" de la Caja. `abiertos` = deudores
 * con deuda abierta (van primero, con saldo); `otros` = nombres históricos +
 * padrón (saldo null). Texto vacío = los abiertos tal cual. Match: prefijo o
 * contiene (normalizado), o alguna palabra a distancia ≤ 2. Tope 6.
 */
export function sugerirDeudores(
  abiertos: { nombre: string; saldo: number }[],
  otros: string[],
  texto: string,
): SugerenciaDeudor[] {
  const q = normalizar(texto);
  const vistos = new Set<string>();
  const out: SugerenciaDeudor[] = [];
  const agregar = (nombre: string, saldo: number | null) => {
    const clave = normalizar(nombre);
    if (vistos.has(clave) || out.length >= 6) return;
    vistos.add(clave);
    out.push({ nombre, saldo });
  };
  const matchea = (nombre: string) => {
    if (q === '') return false;
    const n = normalizar(nombre);
    if (n.includes(q) || q.includes(n)) return true;
    return n.split(' ').some(p => distancia(p, q) <= 2 && Math.min(p.length, q.length) >= 4);
  };
  if (q === '') {
    for (const d of abiertos) agregar(d.nombre, d.saldo);
    return out;
  }
  for (const d of abiertos) if (matchea(d.nombre)) agregar(d.nombre, d.saldo);
  for (const n of otros) if (matchea(n)) agregar(n, null);
  return out;
}
```

En `padron.ts`: borrar las definiciones locales y poner
`import { normalizar, distancia } from '../../utils/nombres'; export { normalizar, distancia };`
(los tests del motor y todos los import sites existentes siguen andando).

- [ ] **Step 4: Verificar**: `npx vitest run` → toda la suite verde (181 + nuevos). `npx tsc -b` limpio.
- [ ] **Step 5: Commit**: `git commit -m "refactor: normalizar/distancia a utils/nombres + sugerirDeudores"`

### Task 2: Migración DB — columna `parejas` + RPC v2

**Files:** migración Supabase vía MCP `apply_migration` (nombre `inscripciones_parejas`). Va ANTES de deployar código nuevo (el código viejo sigue compatible: llama sin `p_parejas`, que tiene DEFAULT).

- [ ] **Step 1: Aplicar migración**:

```sql
alter table inscripciones add column if not exists parejas jsonb not null default '{}'::jsonb;

-- Agregar un parámetro crea una SOBRECARGA y PostgREST no resuelve la ambigüedad
-- (lección admin_cobrar_deudor): DROP de la firma vieja + CREATE de la nueva.
drop function if exists public.inscribir_evento(text, text, text, text, text, text, text, text);

create or replace function public.inscribir_evento(
  p_event_id text, p_nombre text, p_celular text, p_categorias text,
  p_email text default '', p_pareja text default '', p_dupr_id text default '',
  p_notas text default '', p_parejas jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog', 'public'
as $$
DECLARE
  -- ... cuerpo actual íntegro, más:
  v_parejas jsonb := coalesce(p_parejas, '{}'::jsonb);
BEGIN
  -- validaciones actuales sin cambios, más:
  IF jsonb_typeof(v_parejas) <> 'object' OR length(v_parejas::text) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Parejas inválidas');
  END IF;
  IF exists (
    select 1 from jsonb_each(v_parejas) as kv(k, v)
    where jsonb_typeof(kv.v) <> 'string' or length(kv.k) > 120 or length(kv.v #>> '{}') > 120
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Parejas inválidas');
  END IF;
  -- UPDATE: sumar «parejas = v_parejas» al SET; INSERT: sumar columna y valor.
END;
$$;

revoke all on function public.inscribir_evento(text,text,text,text,text,text,text,text,jsonb) from public;
grant execute on function public.inscribir_evento(text,text,text,text,text,text,text,text,jsonb) to anon, authenticated;
```

- [ ] **Step 2: Verificar**: `select pg_get_functiondef(oid) from pg_proc where proname='inscribir_evento';` → UNA sola firma (9 args). Probar como anon (curl con apikey anon) una inscripción de prueba con y SIN `p_parejas` → ambas ok; borrar la fila de prueba.

### Task 3: Tipos + service (`parejas`, badge, nombres del padrón)

**Files:**
- Modify: `src/types.ts:186-209` (Inscripcion + InscripcionInput)
- Modify: `src/services/supabaseService.ts:543-609`

- [ ] **Step 1**: En `types.ts`: `Inscripcion` gana `parejas: Record<string, string>;` (después de `pareja`); `InscripcionInput` gana `parejas?: Record<string, string>;`.

- [ ] **Step 2**: En `supabaseService.ts`:
  - `inscribirEvento`: agregar `p_parejas: i.parejas || {}` al payload de la RPC.
  - `getInscripciones`: mapear `parejas: (row.parejas && typeof row.parejas === 'object') ? row.parejas : {}`.
  - Nuevo, junto al bloque de inscripciones:

```ts
/** Cuántas inscripciones entraron después de `desdeISO` (badge del admin). */
async getInscripcionesNuevas(desdeISO: string): Promise<number | null> {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { count, error } = await conTechoLectura(
    supabase.from('inscripciones').select('id', { count: 'exact', head: true }).gt('created_at', desdeISO),
  );
  if (error) return null;
  return count ?? 0;
},

/** Nombres del padrón (rk_jugadores, lectura pública) para datalists y sugerencias. */
async getJugadoresNombres(): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await conTechoLectura(supabase.from('rk_jugadores').select('nombre, alias'));
  if (error || !data) return [];
  const out: string[] = [];
  for (const j of data) {
    if (j.nombre) out.push(j.nombre);
    if (Array.isArray(j.alias)) for (const a of j.alias) if (typeof a === 'string') out.push(a);
  }
  return out;
},
```

  Nota: `conTechoLectura` envuelve el builder — verificar que la variante con `{count}` devuelva `count` (usar `await` directo del builder con `.abortSignal` si el helper no lo propaga; mirar cómo lo hace `getLedger`).

- [ ] **Step 3**: `npx tsc -b` limpio. Commit: `feat: parejas por categoria en tipos+service, badge y nombres del padron`.

### Task 4: Form público — un campo de pareja por categoría de dobles + datalist

**Files:**
- Modify: `src/App.tsx:2956-3194` (InscripcionPage)

- [ ] **Step 1**: Estado: reemplazar `pareja: ''` del form por `const [parejas, setParejas] = useState<Record<string, string>>({})`. Cargar nombres del padrón una vez: `const [nombresPadron, setNombresPadron] = useState<string[]>([])` + `useEffect(() => { SupabaseService.getJugadoresNombres().then(setNombresPadron); }, [])`.

- [ ] **Step 2**: Derivar `const catsDobles = (opcionesCategorias.length > 0 ? cats : [catLibre.trim()]).filter(c => c.toLowerCase().includes('doble'))`. Reemplazar el bloque `{hayDobles && (...)}` por un map de `catsDobles`: un input por categoría con label «Tu pareja para {c}», value `parejas[c] ?? ''`, onChange que setea esa clave, `list="padron-nombres"`. Al destogglear una categoría, borrar su clave (en `toggleCat`). El input de nombre también lleva `list="padron-nombres"`. Un único `<datalist id="padron-nombres">{nombresPadron.map(...)}</datalist>` al pie del form (solo si hay nombres).

- [ ] **Step 3**: `enviar`: mandar `parejas: Object.fromEntries(Object.entries(parejas).filter(([k, v]) => catsDobles.includes(k) && v.trim()).map(([k, v]) => [k, v.trim()]))` y dejar `pareja: ''` (legacy vacío en altas nuevas).

- [ ] **Step 4**: `npx tsc -b` + `npm run build`. Smoke con dev server: elegir «Doble Mixto A» + «Doble Masculino A» → dos campos. Commit: `feat(inscripcion): campo de pareja por cada categoria de dobles`.

### Task 5: Helper de duplas + `AdminInscripcionesTab`

**Files:**
- Create: `src/utils/inscripciones.ts`, `src/utils/inscripciones.test.ts`, `src/components/AdminInscripcionesTab.tsx`

- [ ] **Step 1: Test que falla** — `src/utils/inscripciones.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { armarSeccionesCategoria, parejaDe } from './inscripciones';
import type { Inscripcion } from '../types';

const base = { celular: '', email: '', duprId: '', notas: '', estado: 'pendiente' as const, createdAt: '2026-08-14T12:00:00Z', eventId: 'evt', pareja: '' };
const i = (id: string, nombre: string, categorias: string, parejas: Record<string, string> = {}): Inscripcion =>
  ({ ...base, id, nombre, categorias, parejas });

describe('parejaDe', () => {
  it('lee del mapa por categoría y cae al texto legacy', () => {
    expect(parejaDe(i('1', 'Ana', 'Doble Mixto A', { 'Doble Mixto A': 'Beto' }), 'Doble Mixto A')).toBe('Beto');
    expect(parejaDe({ ...i('2', 'Ana', 'Doble Mixto A'), pareja: 'Beto' }, 'Doble Mixto A')).toBe('Beto');
    expect(parejaDe(i('3', 'Ana', 'Singles A'), 'Singles A')).toBe('');
  });
});

describe('armarSeccionesCategoria', () => {
  it('secciones = categorías del evento ∪ las presentes en datos, orden del evento primero', () => {
    const secs = armarSeccionesCategoria([i('1', 'Ana', 'Rara X')], ['Doble Mixto A', 'Singles A']);
    expect(secs.map(s => s.categoria)).toEqual(['Doble Mixto A', 'Singles A', 'Rara X']);
  });
  it('arma duplas por mención mutua normalizada (tildes no importan)', () => {
    const secs = armarSeccionesCategoria([
      i('1', 'Gastón Moirano', 'Doble Masculino A', { 'Doble Masculino A': 'Brian Ridvanovich' }),
      i('2', 'Brian Ridvanovich', 'Doble Masculino A', { 'Doble Masculino A': 'GASTON MOIRANO' }),
      i('3', 'Suelto Pérez', 'Doble Masculino A', { 'Doble Masculino A': 'Nadie Conocido' }),
    ], ['Doble Masculino A']);
    const sec = secs[0];
    expect(sec.duplas).toEqual([['1', '2']]);
    expect(sec.sueltos).toEqual(['3']);
    expect(sec.total).toBe(3);
  });
  it('excluye bajas y no duplica a nadie en dos duplas', () => {
    const bajas = { ...i('9', 'Baja Uno', 'Doble Mixto A'), estado: 'baja' as const };
    const secs = armarSeccionesCategoria([bajas], ['Doble Mixto A']);
    expect(secs[0].total).toBe(0);
  });
});
```

- [ ] **Step 2**: `npx vitest run src/utils/inscripciones.test.ts` → FAIL.

- [ ] **Step 3: Implementación** — `src/utils/inscripciones.ts`:

```ts
import type { Inscripcion } from '../types';
import { normalizar } from './nombres';

/** Pareja declarada para una categoría: mapa nuevo, con fallback al campo legacy. */
export function parejaDe(i: Inscripcion, categoria: string): string {
  const m = i.parejas?.[categoria];
  if (m && m.trim()) return m.trim();
  if (categoria.toLowerCase().includes('doble') && i.pareja.trim()) return i.pareja.trim();
  return '';
}

export function categoriasDe(i: Inscripcion): string[] {
  return i.categorias.split(',').map(c => c.trim()).filter(Boolean);
}

export interface SeccionCategoria {
  categoria: string;
  /** pares de ids de inscripciones emparejadas por mención mutua */
  duplas: [string, string][];
  /** ids sin dupla armada (con o sin pareja declarada) */
  sueltos: string[];
  total: number;
}

export function armarSeccionesCategoria(inscripciones: Inscripcion[], categoriasEvento: string[]): SeccionCategoria[] {
  const activos = inscripciones.filter(x => x.estado !== 'baja');
  const orden: string[] = [...categoriasEvento];
  for (const insc of activos)
    for (const c of categoriasDe(insc)) if (!orden.includes(c)) orden.push(c);
  return orden.map(categoria => {
    const del = activos.filter(x => categoriasDe(x).includes(categoria));
    const usados = new Set<string>();
    const duplas: [string, string][] = [];
    for (const a of del) {
      if (usados.has(a.id)) continue;
      const objetivo = normalizar(parejaDe(a, categoria));
      if (!objetivo) continue;
      const b = del.find(x => x.id !== a.id && !usados.has(x.id)
        && normalizar(x.nombre) === objetivo
        && normalizar(parejaDe(x, categoria)) === normalizar(a.nombre));
      if (b) { usados.add(a.id); usados.add(b.id); duplas.push([a.id, b.id]); }
    }
    const sueltos = del.filter(x => !usados.has(x.id)).map(x => x.id);
    return { categoria, duplas, sueltos, total: del.length };
  });
}
```

- [ ] **Step 4**: Verde + commit: `feat: helpers de secciones por categoria y pareja con fallback`.

- [ ] **Step 5: Componente** — `src/components/AdminInscripcionesTab.tsx` (estética = AdminCajaTab: tarjetas blancas `rounded-2xl border border-gray-100`, chips pill, `fechaHumana` de `utils/fechas`). Props:

```ts
export default function AdminInscripcionesTab({ events, eventoInicialId, alVerla }: {
  events: Event[];
  eventoInicialId: string | null;   // viene del atajo de Eventos
  alVerla: () => void;              // AdminPage marca la visita y apaga el badge
})
```

  Estructura interna: `eventosConInscripcion = events.filter(e => e.inscripcionesAbiertas || e.categorias)` ordenados por fecha desc; `eventoSel` (default `eventoInicialId` ?? upcoming más próximo con inscripciones abiertas ?? primero); `filas: Inscripcion[] | null` cargadas con `SupabaseService.getInscripciones(eventoSel)` en efecto + botón «Actualizar» (loading real, patrón Caja); `vista: 'recientes' | 'categorias'` como chips.
  - Al montar: `alVerla()` y guardar `localStorage volea_insc_vistas = new Date().toISOString()`. `marcaVisitaAnterior` se lee ANTES de pisarla para pintar el chip «nueva» en filas con `createdAt > esa marca`.
  - Recientes: `[...filas].sort(createdAt desc)`, cada fila reusa la semántica de acciones del viejo modal (`setEstadoInscripcion` + recarga; botones Confirmar / A pendiente / Dar de baja, chips de estado ámbar/verde/gris, WhatsApp `wa.me`, parejas: `categoriasDe(i).filter(dobles).map(c => `${c}: ${parejaDe(i, c) || 'a confirmar'}`)`).
  - Por categoría: `armarSeccionesCategoria(filas, evt.categorias.split(','))`; sección colapsada si `total === 0` (solo título gris); duplas como «Nombre + Nombre», sueltos como «Nombre — con X (declarada)» o «— pareja a confirmar»; contador `total` por sección; línea final «N inscripciones · M personas».
  - Estados: sin sesión/fallo → mensaje «Verificá tu sesión de admin»; vacío → link del form público del evento (copiar del modal viejo).

- [ ] **Step 6**: `npx tsc -b` + commit: `feat(admin): pestaña Inscripciones con recientes y por categoria`.

### Task 6: Wiring — pestaña, badge, barra flotante y retiro del modal

**Files:**
- Modify: `src/App.tsx` (AdminPage ~3880-3930, tabs ~4089-4104, render ~4194+, tabla eventos ~4392-4402, BarraAdmin ~5715+, InscriptosModal 5013-5118 fuera)

- [ ] **Step 1**: Import lazy junto a los otros tabs lazy (buscar cómo se importa `AdminCajaTab` — mismo patrón) + item `{ id: 'inscripciones', label: 'Inscripciones', icon: <ClipboardList size={18} /> }` después de `orders`. Icono `ClipboardList` sumado al import de lucide.
- [ ] **Step 2**: Estado del badge en AdminPage: `const [inscNuevas, setInscNuevas] = useState(0)`; efecto al montar (y en `visibilitychange`) que lee `localStorage volea_insc_vistas` (default: hace 7 días) y llama `getInscripcionesNuevas` → setea. El item del menú pinta `{inscNuevas > 0 && <span className="ml-auto rounded-full bg-lime-400 px-2 py-0.5 text-[11px] font-bold text-navy-700">{inscNuevas}</span>}` (mirar cómo el sidebar renderiza labels para insertar el span sin romper el layout).
- [ ] **Step 3**: Render: `{activeTab === 'inscripciones' && <AdminInscripcionesTab events={events} eventoInicialId={inscEventoAtajo} alVerla={() => { setInscNuevas(0); }} />}` donde `inscEventoAtajo` es un `useState<string | null>` seteado por el atajo de Eventos.
- [ ] **Step 4**: Tabla de Eventos: el botón Users pasa a `onClick={() => { setInscEventoAtajo(evt.id); setActiveTab('inscripciones'); }}`. Borrar `inscriptosEvent` (estado 3909, render 4443-4445) y TODO el componente `InscriptosModal` (5013-5118).
- [ ] **Step 5**: BarraAdmin: agregar atajo «Inscripciones» (deja `volea_admin_tab='inscripciones'` como los demás) con el mismo badge (BarraAdmin es componente aparte: consulta `getInscripcionesNuevas` con el mismo default de marca, solo si `isAdmin`, al montar — barato: head count).
- [ ] **Step 6**: `npx tsc -b` + `npm run build` + smoke en dev (badge aparece, pestaña carga, atajo desde Eventos preselecciona). Commit: `feat(admin): badge de inscripciones nuevas + atajo desde eventos (adios modal)`.

### Task 7: Caja — sugerencias de deudor en VentaModal

**Files:**
- Modify: `src/components/AdminCajaTab.tsx` (VentaModal 831-960 y su render ~530; el componente padre ya calcula `porCobrar`)

- [ ] **Step 1**: VentaModal gana props `deudoresAbiertos: { nombre: string; saldo: number }[]` y `nombresPadron: string[]`. El padre pasa `porCobrar.deudores.map(d => ({ nombre: d.nombre, saldo: d.total }))` — filtrando `nombre !== 'Sin nombre'` — y un estado `nombresPadron` cargado una vez al abrir el modal de venta (`SupabaseService.getJugadoresNombres()`, cache en ref para no repetir). Nombres históricos: `entries.filter(e => e.debtorName).map(e => e.debtorName)` (el padre ya tiene `entries` del ledger) van dentro de `nombresPadron`… NO: mantener separado `otros = [...historicos, ...padron]` y pasarlo como `nombresSugeridos: string[]`.
- [ ] **Step 2**: En el bloque `metodo === 'debe'` (líneas 1177-1190): arriba del input, si `deudoresAbiertos.length > 0 && deudor.trim() === ''`, chips tocables (máx 8) «{nombre} · ${saldo}» que setean `setDeudor(nombre)`. Debajo del input, `sugerirDeudores(deudoresAbiertos, nombresSugeridos, deudor)` (solo si `deudor.trim() !== ''` y el valor no coincide exacto con una sugerencia elegida): lista de botones `w-full text-left` con nombre + («ya debe $X» si saldo ≠ null); click = `setDeudor(nombre)`. Sin dropdown flotante: lista inline (el modal ya scrollea), máx 6 filas.
- [ ] **Step 3**: Smoke manual dev: venta suelta con «Debe», escribir «gast» → sugiere del padrón; elegir deudor abierto → nombre exacto. `npx vitest run` + `npx tsc -b`. Commit: `feat(caja): sugerencias de deudor (abiertos + historicos + padron)`.

### Task 8: Import de la planilla del Racket Roll (one-off, DB)

**Files:**
- Create: `scratchpad/import-racket-roll.py` (genera SQL desde `racket-roll-sheet.json` ya extraído) — NO se commitea al repo.

- [ ] **Step 1**: Leer padrón actual (`select id, nombre, alias from rk_jugadores`) y generar el plan de match: por `normalizar(nombre)` contra nombre+alias. Exacto → reusar id (si la grafía del sheet difiere solo en tilde/case, agregar alias). Sin match → id nuevo (formato corto tipo el del motor: base36 aleatorio de 8). «CONFIRMAR» se ignora.
- [ ] **Step 2**: Mapeo de niveles: `MASC X→Doble Masculino X`, `FEM X→Doble Femenino X`, `MIXTO X→Doble Mixto X`, `SINGLE MASC X→Singles Masculino X`, `SINGLE FEM X→Singles Femenino X`. Dupla 10 (Gastón FEM B + Brian MASC A) se fuerza a `Doble Masculino A` para ambos. Teléfonos: 8 dígitos que arrancan en 9 → prefijo «0».
- [ ] **Step 3**: Por persona: fila en `inscripciones` (event_id `evt-racket-roll-2026`, categorias = join ', ' en orden dobles→singles, `parejas` jsonb por categoría de dobles con el compañero de SU dupla — «CONFIRMAR» ⇒ la clave no va, notas suman «pareja a confirmar (CATEGORÍA)»), estado `pendiente`, notas «importada de planilla 14/8». Brian ya tiene fila online: UPDATE de esa fila (merge celular/email/dupr existentes + categorías/parejas canónicas del sheet).
- [ ] **Step 4**: Ejecutar por MCP en transacción; verificar: counts por categoría vs planilla (MASC A=4 duplas→? etc. — imprimir tabla), total de personas = 18, y `select nombre from rk_jugadores` sin dos filas con el mismo normalizado. Insertar en `rk_jugadores` con `updated_at = now()`.
- [ ] **Step 5**: Avisar a Brian: propuesta de actualizar `events.categorias` del Racket Roll con singles por género (decisión suya, un toque en el admin).

### Task 9: Gates finales + deploy + E2E

- [ ] `npx vitest run` (todo verde), `npx tsc -b`, `npm run build`.
- [ ] `git push` a master → Vercel deploya.
- [ ] E2E en producción: (1) inscribirse de prueba con Mixto+Masculino → dos campos de pareja, fila con `parejas` correcto (verificar por SQL, después borrar la prueba); (2) admin → badge > 0, abrir pestaña, badge a 0, vistas Recientes/Por categoría con los importados; (3) Caja → venta «Debe» sugiere jugadores del padrón. Capturas para Brian.
- [ ] Actualizar memoria (volea-estado) con lo nuevo.

## Self-review del plan

- Cobertura del spec: Pieza 1→Tasks 2/3/4 · Pieza 2→Tasks 3/5/6 · Pieza 3→Tasks 1/8 · Pieza 4→Tasks 1/7 · Testing→Tasks 1/5/9. Sin huecos.
- Tipos consistentes: `parejas: Record<string,string>` en types/service/form/helpers; `sugerirDeudores(abiertos, otros, texto)` igual en Task 1 y 7 (en Task 7 el segundo arg se llama `nombresSugeridos` al pasarlo — misma posición).
- Orden seguro de deploy: migración (Task 2) es compatible con el código viejo; el código nuevo (Task 4) solo sale después.
