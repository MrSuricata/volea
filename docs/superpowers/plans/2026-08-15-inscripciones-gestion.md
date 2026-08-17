# Gestión de inscripciones — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Semáforo de armado por categoría (umbral 4), lista de "buscan pareja" con cruces sugeridos (género inferido en mixto), "falta que se anoten", alta+edición manual de inscripciones y export de la planilla con el formato de Brian.

**Architecture:** Todo sobre la pestaña existente. Helpers puros en `utils/inscripciones.ts` (TDD) derivados de `armarSeccionesCategoria`; modal de alta/edición dentro de `AdminInscripcionesTab.tsx` (patrón AdminCajaTab); insert admin directo (policy nueva) sin tocar la RPC pública; export con exceljs dinámico (patrón cajaExcel) y armado de filas puro testeable.

**Tech Stack:** React 19 + Vite + TS, Supabase, vitest, exceljs. Gates: `npx tsc -b`, `npm run build`.

**Spec:** `docs/superpowers/specs/2026-08-15-inscripciones-gestion-design.md`

---

### Task 1: Helpers puros (TDD) — `resumenArmado`, `generoDe`, `buscanPareja`, `faltaInscribirse`

**Files:** Modify `src/utils/inscripciones.ts` · Test `src/utils/inscripciones.gestion.test.ts` (nuevo)

- [ ] **Step 1: Tests que fallan** (usar el mismo builder `insc()` del test existente):

```ts
import { describe, expect, it } from 'vitest';
import { armarSeccionesCategoria, buscanPareja, faltaInscribirse, generoDe, resumenArmado, MIN_UNIDADES_VIABLE } from './inscripciones';
import type { Inscripcion } from '../types';

const base = { celular: '', email: '', duprId: '', notas: '', estado: 'pendiente' as const, createdAt: '2026-08-15T12:00:00Z', eventId: 'evt', pareja: '' };
const insc = (id: string, nombre: string, categorias: string, parejas: Record<string, string> = {}): Inscripcion =>
  ({ ...base, id, nombre, categorias, parejas });

describe('generoDe', () => {
  it('infiere por las categorías que juega', () => {
    expect(generoDe(insc('1', 'Ana', 'Doble Femenino B, Doble Mixto A'))).toBe('F');
    expect(generoDe(insc('2', 'Juan', 'Singles Masculino A'))).toBe('M');
    expect(generoDe(insc('3', 'X', 'Doble Mixto A'))).toBe(null);
    expect(generoDe(insc('4', 'Raro', 'Doble Femenino A, Doble Masculino A'))).toBe(null);
  });
});

describe('resumenArmado (umbral 4)', () => {
  it('dobles: mutuas + declaradas = unidades; singles: personas', () => {
    const filas = [
      insc('1', 'A', 'Doble Masculino B', { 'Doble Masculino B': 'B' }),
      insc('2', 'B', 'Doble Masculino B', { 'Doble Masculino B': 'A' }),
      insc('3', 'C', 'Doble Masculino B', { 'Doble Masculino B': 'Externo' }),
      insc('4', 'D', 'Doble Masculino B'),
      insc('5', 'S', 'Singles Masculino A'),
    ];
    const secs = armarSeccionesCategoria(filas, ['Doble Masculino B', 'Singles Masculino A']);
    const r = resumenArmado(secs, filas);
    const masc = r.find(x => x.categoria === 'Doble Masculino B')!;
    expect(masc).toMatchObject({ duplasArmadas: 1, duplasDeclaradas: 1, buscanPareja: 1, unidades: 2, nivel: 'ambar' });
    const sing = r.find(x => x.categoria === 'Singles Masculino A')!;
    expect(sing).toMatchObject({ unidades: 1, nivel: 'gris' });
  });
  it('verde con >= MIN_UNIDADES_VIABLE', () => {
    const filas = Array.from({ length: 4 }, (_, i) => insc(String(i), `J${i}`, 'Singles Masculino A'));
    const r = resumenArmado(armarSeccionesCategoria(filas, ['Singles Masculino A']), filas);
    expect(MIN_UNIDADES_VIABLE).toBe(4);
    expect(r[0].nivel).toBe('verde');
  });
});

describe('buscanPareja + cruces', () => {
  it('en categorías de género sugiere cualquier par; en mixto respeta género inferido', () => {
    const filas = [
      insc('1', 'Yesica', 'Doble Femenino A, Doble Mixto B'),
      insc('2', 'Paula', 'Doble Femenino A, Doble Mixto B'),
      insc('3', 'Franco', 'Doble Masculino B, Doble Mixto B'),
    ];
    const b = buscanPareja(armarSeccionesCategoria(filas, ['Doble Femenino A', 'Doble Mixto B']), filas);
    const femA = b.find(x => x.categoria === 'Doble Femenino A')!;
    expect(femA.buscan.map(i => i.nombre)).toEqual(['Yesica', 'Paula']);
    expect(femA.cruces).toContainEqual(['1', '2']);
    const mixtoB = b.find(x => x.categoria === 'Doble Mixto B')!;
    expect(mixtoB.cruces).toContainEqual(['1', '3']);
    expect(mixtoB.cruces).toContainEqual(['2', '3']);
    expect(mixtoB.cruces).not.toContainEqual(['1', '2']);
  });
  it('sin sueltos no devuelve la categoría', () => {
    const filas = [insc('1', 'A', 'Doble Femenino A', { 'Doble Femenino A': 'B' })];
    expect(buscanPareja(armarSeccionesCategoria(filas, ['Doble Femenino A']), filas)).toEqual([]);
  });
});

describe('faltaInscribirse', () => {
  it('lista parejas declaradas sin inscripción propia, sin duplicar', () => {
    const filas = [
      insc('1', 'Ana', 'Doble Femenino A', { 'Doble Femenino A': 'Bea Externa' }),
      insc('2', 'Cami', 'Doble Femenino B', { 'Doble Femenino B': 'BEA EXTERNA' }),
      insc('3', 'Dani', 'Doble Mixto A', { 'Doble Mixto A': 'Ana' }),
    ];
    const f = faltaInscribirse(filas);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ nombre: 'Bea Externa' });
    expect(f[0].declaradaPor.map(d => d.nombre)).toEqual(['Ana', 'Cami']);
  });
});
```

- [ ] **Step 2**: correr → FAIL. **Step 3**: implementar en `utils/inscripciones.ts`:

```ts
export const MIN_UNIDADES_VIABLE = 4; // decisión de Brian 15/8: 4 duplas/jugadores

export type Genero = 'F' | 'M' | null;
export function generoDe(i: Inscripcion): Genero {
  const cats = categoriasDe(i).map(c => c.toLowerCase());
  const f = cats.some(c => c.includes('femenino'));
  const m = cats.some(c => c.includes('masculino'));
  if (f && !m) return 'F';
  if (m && !f) return 'M';
  return null;
}

export interface ArmadoCategoria {
  categoria: string;
  esDoble: boolean;
  duplasArmadas: number;
  duplasDeclaradas: number; // suelto con pareja declarada (el compañero existe, no se anotó)
  buscanPareja: number;     // suelto sin pareja
  totalPersonas: number;
  unidades: number;         // dobles: armadas+declaradas · singles: personas
  nivel: 'verde' | 'ambar' | 'gris';
}

export function resumenArmado(secciones: SeccionCategoria[], inscripciones: Inscripcion[]): ArmadoCategoria[] {
  const porId = new Map(inscripciones.map(i => [i.id, i]));
  return secciones.map(sec => {
    const esDoble = sec.categoria.toLowerCase().includes('doble');
    let declaradas = 0, sinPareja = 0;
    for (const id of sec.sueltos) {
      const i = porId.get(id);
      if (i && parejaDe(i, sec.categoria)) declaradas++; else sinPareja++;
    }
    const unidades = esDoble ? sec.duplas.length + declaradas : sec.total;
    const nivel = unidades >= MIN_UNIDADES_VIABLE ? 'verde' : unidades >= 2 ? 'ambar' : 'gris';
    return { categoria: sec.categoria, esDoble, duplasArmadas: sec.duplas.length, duplasDeclaradas: declaradas, buscanPareja: sinPareja, totalPersonas: sec.total, unidades, nivel };
  });
}

export interface BuscanCategoria { categoria: string; buscan: Inscripcion[]; cruces: [string, string][] }
export function buscanPareja(secciones: SeccionCategoria[], inscripciones: Inscripcion[]): BuscanCategoria[] {
  const porId = new Map(inscripciones.map(i => [i.id, i]));
  const out: BuscanCategoria[] = [];
  for (const sec of secciones) {
    if (!sec.categoria.toLowerCase().includes('doble')) continue;
    const buscan = sec.sueltos.map(id => porId.get(id)).filter((i): i is Inscripcion => !!i && !parejaDe(i, sec.categoria));
    if (buscan.length === 0) continue;
    const esMixto = sec.categoria.toLowerCase().includes('mixto');
    const cruces: [string, string][] = [];
    for (let a = 0; a < buscan.length; a++) {
      for (let b = a + 1; b < buscan.length; b++) {
        if (esMixto) {
          const ga = generoDe(buscan[a]), gb = generoDe(buscan[b]);
          if (ga && gb && ga === gb) continue; // dos del mismo género no juegan mixto
        }
        cruces.push([buscan[a].id, buscan[b].id]);
      }
    }
    out.push({ categoria: sec.categoria, buscan, cruces });
  }
  return out;
}

export interface FaltaInscribirse { nombre: string; declaradaPor: { nombre: string; categoria: string }[] }
export function faltaInscribirse(inscripciones: Inscripcion[]): FaltaInscribirse[] {
  const activos = inscripciones.filter(i => i.estado !== 'baja');
  const inscriptos = new Set(activos.map(i => normalizar(i.nombre)));
  const porNombre = new Map<string, FaltaInscribirse>();
  for (const i of activos) {
    for (const c of categoriasDe(i)) {
      const p = parejaDe(i, c);
      if (!p || inscriptos.has(normalizar(p))) continue;
      const clave = normalizar(p);
      const item = porNombre.get(clave) ?? { nombre: p, declaradaPor: [] };
      item.declaradaPor.push({ nombre: i.nombre, categoria: c });
      porNombre.set(clave, item);
    }
  }
  return [...porNombre.values()];
}
```

- [ ] **Step 4**: suite verde + `npx tsc -b`. **Step 5**: commit `feat(inscripciones): helpers de armado, buscan pareja (genero inferido) y falta inscribirse`.

### Task 2: Migración policy INSERT + service admin

- [ ] **Step 1**: `apply_migration` `inscripciones_admin_insert`:

```sql
-- Los admins hoy pueden ver/editar/borrar pero NO insertar (el alta pública va
-- por la RPC). El alta manual desde el panel necesita INSERT directo.
create policy inscripciones_admin_insert on inscripciones for insert with check (is_admin());
```

- [ ] **Step 2**: verificar en pg_policies. **Step 3**: en `supabaseService.ts`, junto al bloque de inscripciones:

```ts
/** Alta manual desde el admin (WhatsApp): sin las validaciones del form público. */
async addInscripcionAdmin(i: InscripcionInput & { estado: Inscripcion['estado'] }): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await conTechoEscritura(supabase.from('inscripciones').insert({
    event_id: i.eventId,
    nombre: i.nombre.trim(),
    celular: (i.celular || '').trim(),
    email: (i.email || '').trim(),
    categorias: i.categorias,
    pareja: '',
    parejas: i.parejas || {},
    dupr_id: (i.duprId || '').trim(),
    notas: (i.notas || '').trim(),
    estado: i.estado,
  }));
  if (error) { console.error('Error alta inscripción admin:', error); return false; }
  return true;
},

/** Edición completa de una inscripción desde el admin. */
async updateInscripcionAdmin(id: string, i: InscripcionInput & { estado: Inscripcion['estado'] }): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await conTechoEscritura(supabase.from('inscripciones').update({
    nombre: i.nombre.trim(),
    celular: (i.celular || '').trim(),
    email: (i.email || '').trim(),
    categorias: i.categorias,
    parejas: i.parejas || {},
    dupr_id: (i.duprId || '').trim(),
    notas: (i.notas || '').trim(),
    estado: i.estado,
  }).eq('id', id));
  if (error) { console.error('Error edición inscripción admin:', error); return false; }
  return true;
},
```

  (la edición NO toca `pareja` legacy: si la fila vieja tenía texto, se conserva como referencia).
- [ ] **Step 4**: `npx tsc -b` + commit `feat(inscripciones): insert admin (policy) + service de alta/edicion manual`.

### Task 3: UI — semáforo Armado + tarjetas Buscan pareja / Falta anotarse

**Files:** Modify `src/components/AdminInscripcionesTab.tsx`

- [ ] **Step 1**: derivar SIEMPRE (con `filas`): `const armado = resumenArmado(secciones, filas ?? [])`, `const buscan = buscanPareja(secciones, filas ?? [])`, `const faltan = faltaInscribirse(filas ?? [])` (`secciones` ya existe; moverla fuera del branch de vista).
- [ ] **Step 2**: bloque "Armado" entre el selector de vistas y el contenido — grilla `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2`; tarjeta: punto de color (`bg-green-500`/`bg-amber-400`/`bg-gray-300`), nombre de la categoría en font-display chico, y "3 duplas + 1 busca" / "6 jugadores"; `unidades === 0` → texto gris "sin anotados" y opacidad. Orden: las del evento (ya viene así de `armarSeccionesCategoria`), las vacías al final (`sort` estable por `unidades > 0` primero).
- [ ] **Step 3**: tarjeta ámbar "Buscan pareja" (si `buscan.length`): por categoría, chips con los nombres; debajo, cruces como "💡 X + Y podrían jugar juntos". Tarjeta gris "Falta que se anoten" (si `faltan.length`): "Bea Externa — la declaró Ana (Doble Femenino A)".
- [ ] **Step 4**: smoke dev (con los datos reales: Fem A debe sugerir Yesica+Paula) + `npx tsc -b` + commit `feat(inscripciones): semaforo de armado + buscan pareja con cruces + falta anotarse`.

### Task 4: Modal de alta/edición

**Files:** Modify `src/components/AdminInscripcionesTab.tsx` (modal en el mismo archivo) y header de la pestaña.

- [ ] **Step 1**: estado `const [editando, setEditando] = useState<Inscripcion | 'nueva' | null>(null)`; botón "Nueva inscripción" (lime, icono Plus) junto a "Actualizar"; lápiz (icono Pencil) en `filaAcciones` que hace `setEditando(i)`.
- [ ] **Step 2**: `InscripcionModal` (componente local): props `{ evento, inicial: Inscripcion | null, nombresPadron: string[], onClose, onDone }`. Form: nombre (datalist), celular, email, DUPR, chips de categorías (opciones = `evento.categorias` ∪ categorías de `inicial`), inputs de pareja por categoría de dobles elegida (datalist), notas, toggle estado pendiente/confirmada. Cargar `nombresPadron` una vez al abrir el primer modal (`SupabaseService.getJugadoresNombres()`, cache en estado del tab). Guardar: `inicial ? updateInscripcionAdmin(inicial.id, input) : addInscripcionAdmin(input)` → toast + `onDone` (recarga `cargar()`).
- [ ] **Step 3**: validación: nombre no vacío + ≥1 categoría; botón con saving. Escape NO (deuda global de modales, no innovar acá).
- [ ] **Step 4**: smoke dev (alta + edición) + `npx tsc -b` + commit `feat(inscripciones): alta y edicion manual desde el admin`.

### Task 5: Export planilla formato Brian

**Files:** Create `src/utils/inscripcionesExcel.ts` + test `src/utils/inscripcionesExcel.test.ts`; botón en el tab.

- [ ] **Step 1: Test que falla** — `armarFilasPlanilla(inscripciones, categoriasEvento)` → `{ dobles: string[][], singles: string[][] }`:

```ts
// nivel inverso, numeración de duplas, CONFIRMAR, estados:
const filas = [
  insc('1', 'A', 'Doble Masculino A', { 'Doble Masculino A': 'B' }),
  { ...insc('2', 'B', 'Doble Masculino A', { 'Doble Masculino A': 'A' }), estado: 'confirmada' as const },
  insc('3', 'C', 'Doble Masculino A, Singles Masculino B', { 'Doble Masculino A': 'Externo X' }),
  insc('4', 'D', 'Doble Femenino C'),
];
const r = armarFilasPlanilla(filas, ['Doble Masculino A', 'Doble Femenino C', 'Singles Masculino B']);
expect(r.dobles[0]).toEqual(['1', 'A', '', 'MASC A', 'Pendiente']);
expect(r.dobles[1]).toEqual(['', 'B', '', 'MASC A', 'Pagado']);
expect(r.dobles[2]).toEqual(['2', 'C', '', 'MASC A', 'Pendiente']);
expect(r.dobles[3]).toEqual(['', 'Externo X', '', 'MASC A', '']);
expect(r.dobles[4]).toEqual(['3', 'D', '', 'FEM C', 'Pendiente']);
expect(r.dobles[5]).toEqual(['', 'CONFIRMAR', '', 'FEM C', '']);
expect(r.singles[0]).toEqual(['1', 'C', '', 'SINGLE MASC B', 'Pendiente']);
```

- [ ] **Step 2**: implementar: `nivelSheet(categoria)` inverso ("Doble Masculino A"→"MASC A", "Singles Femenino B"→"SINGLE FEM B", desconocida → tal cual); recorrer `armarSeccionesCategoria` en orden: por cada categoría de dobles → duplas mutuas (2 filas, número global incremental), luego sueltos (fila + pareja declarada o "CONFIRMAR"); celular de cada inscripto en su fila; estado como arriba. Singles: número incremental propio.
- [ ] **Step 3**: escritor `exportPlanillaExcel(evento, inscripciones)`: `const ExcelJS = (await import('exceljs')).default`; workbook con hojas DOBLES y SINGLES, encabezado `# | Participante | Telefono contacto | Nivel | Estado Pago | Forma de pago | MONTO | RACKET POINT | VOLEA` en negrita, columnas de plata vacías; descarga como `inscripciones-<evento.id>-<fecha>.xlsx` (mismo patrón de descarga de cajaExcel).
- [ ] **Step 4**: botón "Exportar planilla" (icono FileDown, estado exporting) junto a Actualizar. Suite verde + `npx tsc -b` + commit `feat(inscripciones): export planilla con el formato de la hoja de calculo`.

### Task 6: Gates + deploy + E2E + memoria

- [ ] `npx vitest run` verde, `npx tsc -b`, `npm run build`.
- [ ] Push → Vercel READY (poll del hash del bundle).
- [ ] E2E prod: semáforo con datos reales (Mixto A verde con 6 unidades; Fem A debe sugerir Yesica+Paula); alta manual de prueba → editarla → export → dar de baja y borrar por SQL.
- [ ] Actualizar memoria volea-estado.

## Self-review del plan

- Spec cubierto: P1→T1/T3, P2→T1/T3, P3→T2/T4, P4→T5, testing→T1/T5/T6.
- Consistencia de nombres: `resumenArmado/buscanPareja/faltaInscribirse/generoDe/MIN_UNIDADES_VIABLE` idénticos en T1 y T3; `addInscripcionAdmin/updateInscripcionAdmin` en T2 y T4; `armarFilasPlanilla/exportPlanillaExcel` en T5.
- Migración antes que el código que la usa (T2 antes de T4); todo lo demás es aditivo.
