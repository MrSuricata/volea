import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PartidoLlave, SlotLlave, Torneo } from '../engine/tipos';
import { resultadoDe } from '../engine/tipos';
import { resolverSlot } from '../engine/llave';
import { normalizar } from '../../utils/nombres';
import { nombreDe } from '../ui/util';
import { listarTorneosPublicos } from './datos';
import type { TorneoPublico } from './datos';
import { RkCargando, RkError } from './Estados';
import { supabase } from '../../services/supabaseClient';
import { almacenLocal } from '../../utils/almacen';
import {
  BLOQUE_OPC, PROGRAMA, aHora, aMinuto, aplicarAjustes, categoriasDelEvento, claveDePartido, minutoDesde,
  momentoDeTorneo, programarEvento,
} from './programa';
import type { AjustesPrograma, CatProg, Fila, ProgramaVigente, RefPartido, ResultadoItem } from './programa';
import '../torneos.css';

// ─── Programación en vivo del evento ─────────────────────────────────────────
// Dos vistas en una: los partidos PENDIENTES con hora y cancha estimadas (el reparto
// de engine/programacion, anclado en la hora actual) y los RESULTADOS que se van
// cargando en el gestor. Pensada para el celular en la cancha y para la TV del club:
// tarjetas grandes, filtro por categoría con un toque, se actualiza sola.
// Qué evento muestra y con qué canchas y horarios sale de ./programa.

// "ANTONELLA TERRA y CRISTINA MAICH" -> "Antonella y Cristina" (para la cinta:
// nombres de pila capitalizados; en nombres triples conserva el compuesto: "Ana Laura").
function nombresPila(nombre: string): string {
  const pila = (persona: string) => {
    const partes = persona.trim().split(/\s+/);
    const sinApellido = partes.length > 1 ? partes.slice(0, -1) : partes;
    return sinApellido.map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  };
  return nombre.split(/\s+y\s+/i).map(pila).join(' y ');
}

// Posiciones de un grupo: victorias, y los empates se resuelven por DUELO DIRECTO
// entre las empatadas (mini-liga: victorias y luego diferencia entre ellas) antes
// que por diferencia global — la regla de la casa (caso Fem C del 22/08).
function posicionesDeGrupo(t: Torneo, parejaIds: string[]): string[] {
  const stats = new Map(parejaIds.map((id) => [id, { w: 0, dif: 0 }]));
  const jugadosEntre = (ids: Set<string>) =>
    t.partidosGrupo.filter((p) => ids.has(p.aId) && ids.has(p.bId) && resultadoDe(p) !== null);
  for (const p of jugadosEntre(new Set(parejaIds))) {
    const r = resultadoDe(p)!;
    const sa = stats.get(p.aId)!;
    const sb = stats.get(p.bId)!;
    sa.dif += r.a - r.b;
    sb.dif += r.b - r.a;
    (r.a > r.b ? sa : sb).w += 1;
  }
  const orden = [...parejaIds].sort((x, y) => stats.get(y)!.w - stats.get(x)!.w);
  // desempate por bloques de igual cantidad de victorias
  const resultado: string[] = [];
  let i = 0;
  while (i < orden.length) {
    let j = i;
    while (j < orden.length && stats.get(orden[j])!.w === stats.get(orden[i])!.w) j++;
    const bloque = orden.slice(i, j);
    if (bloque.length > 1) {
      const ids = new Set(bloque);
      const mini = new Map(bloque.map((id) => [id, { w: 0, dif: 0 }]));
      for (const p of jugadosEntre(ids)) {
        const r = resultadoDe(p)!;
        const sa = mini.get(p.aId)!;
        const sb = mini.get(p.bId)!;
        sa.dif += r.a - r.b;
        sb.dif += r.b - r.a;
        (r.a > r.b ? sa : sb).w += 1;
      }
      bloque.sort((x, y) =>
        mini.get(y)!.w - mini.get(x)!.w
        || mini.get(y)!.dif - mini.get(x)!.dif
        || stats.get(y)!.dif - stats.get(x)!.dif);
    }
    resultado.push(...bloque);
    i = j;
  }
  return resultado;
}

const idCorto = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

// Arma la llave en el servidor cuando la fase de grupos está completa. Soporta
// liga única (final 1° vs 2°) y 2 grupos (semis cruzadas + final). Con 3+ grupos
// (mejores terceros) devuelve un aviso para armarla desde el gestor.
async function armarLlaveEnServidor(torneoId: string): Promise<string | null> {
  const sb = supabase;
  if (!sb) return 'Sin conexión con el servidor';
  const { data: fila, error } = await sb.from('rk_torneos').select('data, updated_at').eq('id', torneoId).maybeSingle();
  if (error || !fila) return 'No se pudo leer el torneo';
  const t = fila.data as Torneo;
  if (t.partidosLlave && t.partidosLlave.length > 0) return null; // ya estaba armada
  if (t.partidosGrupo.length === 0 || t.partidosGrupo.some((p) => resultadoDe(p) === null)) {
    return 'Todavía quedan partidos de grupo sin resultado';
  }
  const seed = (parejaId: string): SlotLlave => ({ tipo: 'seed', parejaId });
  let llave: PartidoLlave[];
  if (t.grupos.length === 1) {
    const pos = posicionesDeGrupo(t, t.grupos[0].parejaIds);
    llave = [{ id: idCorto(), ronda: 1, posicion: 0, esTercerPuesto: false, a: seed(pos[0]), b: seed(pos[1]), puntosA: null, puntosB: null }];
  } else if (t.grupos.length === 2) {
    const posA = posicionesDeGrupo(t, t.grupos[0].parejaIds);
    const posB = posicionesDeGrupo(t, t.grupos[1].parejaIds);
    const sf1 = { id: idCorto(), ronda: 1, posicion: 0, esTercerPuesto: false, a: seed(posA[0]), b: seed(posB[1]), puntosA: null, puntosB: null };
    const sf2 = { id: idCorto(), ronda: 1, posicion: 1, esTercerPuesto: false, a: seed(posB[0]), b: seed(posA[1]), puntosA: null, puntosB: null };
    const final = {
      id: idCorto(), ronda: 2, posicion: 0, esTercerPuesto: false,
      a: { tipo: 'ganadorDe', partidoId: sf1.id } as SlotLlave,
      b: { tipo: 'ganadorDe', partidoId: sf2.id } as SlotLlave,
      puntosA: null, puntosB: null,
    };
    llave = [sf1, sf2, final];
  } else {
    return 'Esta categoría lleva mejores terceros: armá la llave desde el gestor';
  }
  t.partidosLlave = llave;
  t.configLlave = { porGrupo: 2, mejoresExtra: 0, tercerPuesto: false };
  const { data: upd, error: e2 } = await sb.from('rk_torneos')
    .update({ data: t, updated_at: new Date().toISOString() })
    .eq('id', torneoId)
    .eq('updated_at', fila.updated_at as string)
    .select('id');
  if (e2) return 'No se pudo guardar (¿sesión vencida?)';
  if (!upd || upd.length === 0) return 'Se editó desde otro lado: probá de nuevo';
  return null;
}

// Escritura del modo admin: lee la fila fresca, anota el puntaje en ESE partido y
// guarda solo si nadie tocó el torneo en el medio (updated_at como candado optimista).
// El gestor detecta cambios remotos por baseline, así que nunca pisa en silencio.
async function guardarResultado(torneoId: string, tipo: 'grupo' | 'llave', partidoId: string, pa: number | null, pb: number | null): Promise<string | null> {
  const sb = supabase;
  if (!sb) return 'Sin conexión con el servidor';
  for (let intento = 0; intento < 2; intento++) {
    const { data: fila, error } = await sb.from('rk_torneos').select('data, updated_at').eq('id', torneoId).maybeSingle();
    if (error || !fila) return 'No se pudo leer el torneo';
    const t = fila.data as Torneo;
    const lista = tipo === 'grupo' ? t.partidosGrupo : t.partidosLlave ?? [];
    const p = lista.find((x) => x.id === partidoId);
    if (!p) return 'El partido ya no existe (¿se rearmó el cuadro?)';
    p.puntosA = pa;
    p.puntosB = pb;
    const { data: upd, error: e2 } = await sb.from('rk_torneos')
      .update({ data: t, updated_at: new Date().toISOString() })
      .eq('id', torneoId)
      .eq('updated_at', fila.updated_at as string)
      .select('id');
    if (e2) return 'No se pudo guardar (¿sesión vencida?)';
    if (upd && upd.length > 0) {
      // el partido terminó: si estaba marcado en una cancha, la libera (mejor esfuerzo)
      if (pa !== null) {
        await sb.from('rk_en_cancha')
          .update({ torneo_id: null, partido_id: null, updated_at: new Date().toISOString() })
          .eq('partido_id', partidoId);
      }
      return null;
    }
    // otro dispositivo escribió entre la lectura y el guardado: reintenta con la versión fresca
  }
  return 'Se está editando desde otro lado: probá de nuevo';
}

type EnCancha = { cancha: string; torneoId: string | null; partidoId: string | null; desde: string | null; habilitada: boolean };

// Datos legibles de un partido marcado en cancha, buscándolo en los datos vivos.
function etiquetaEnCancha(torneos: Torneo[], e: EnCancha): { cat: string; a: string; b: string; tipo: 'grupo' | 'llave' } | null {
  if (!e.torneoId || !e.partidoId) return null;
  const t = torneos.find((x) => x.id === e.torneoId);
  if (!t) return null;
  const cat = PROGRAMA.nombreCorto(t.nombre);
  const pg = t.partidosGrupo.find((p) => p.id === e.partidoId);
  if (pg) return { cat, a: nombreDe(t, pg.aId), b: nombreDe(t, pg.bId), tipo: 'grupo' };
  const llave = t.partidosLlave ?? [];
  const pl = llave.find((p) => p.id === e.partidoId);
  if (pl) {
    const nom = (s: SlotLlave | null) => {
      const id = resolverSlot(s, llave);
      return id ? nombreDe(t, id) : '¿?';
    };
    return { cat, a: nom(pl.a), b: nom(pl.b), tipo: 'llave' };
  }
  return null;
}

// Mini formulario de carga/edición (solo modo admin, solo partidos reales).
// Con `borrable` ofrece quitar el resultado: el partido vuelve a Próximos.
function CargaResultado({ partido, inicialA, inicialB, borrable, onGuardado }: {
  partido: { a: string; b: string } & RefPartido;
  inicialA?: number;
  inicialB?: number;
  borrable?: boolean;
  onGuardado: () => void;
}) {
  const [pa, setPa] = useState(inicialA !== undefined ? String(inicialA) : '');
  const [pb, setPb] = useState(inicialB !== undefined ? String(inicialB) : '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function mandar(a: number | null, b: number | null) {
    setGuardando(true);
    setError('');
    const problema = await guardarResultado(partido.torneoId!, partido.tipo!, partido.partidoId!, a, b);
    setGuardando(false);
    if (problema) {
      setError(problema);
      return;
    }
    onGuardado();
  }

  function guardar() {
    const a = Number(pa);
    const b = Number(pb);
    if (pa === '' || pb === '' || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
      setError('Puntajes inválidos');
      return;
    }
    if (a === b) {
      setError('No puede haber empate');
      return;
    }
    void mandar(a, b);
  }

  function borrar() {
    if (!window.confirm('¿Quitar este resultado? El partido vuelve a Próximos.')) return;
    void mandar(null, null);
  }

  const caja: React.CSSProperties = { width: 62, textAlign: 'center', fontSize: '1.1rem', fontWeight: 800, padding: '7px 4px' };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
      <input type="number" inputMode="numeric" min={0} value={pa} onChange={(e) => setPa(e.target.value)} placeholder="—" aria-label={`Puntos ${partido.a}`} style={caja} />
      <span style={{ opacity: 0.6, fontWeight: 700 }}>–</span>
      <input type="number" inputMode="numeric" min={0} value={pb} onChange={(e) => setPb(e.target.value)} placeholder="—" aria-label={`Puntos ${partido.b}`} style={caja} />
      <button className="boton" disabled={guardando} onClick={guardar}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
      {borrable && (
        <button className="boton secundario" disabled={guardando} onClick={borrar}>Quitar</button>
      )}
      {error && <span style={{ color: '#ff8fa8', fontSize: '0.85rem' }}>{error}</span>}
    </div>
  );
}

// Un resultado en la lista: en modo carga muestra "Editar" para corregir o quitar.
function FilaResultado({ r, borde, modoCarga, onGuardado }: {
  r: ResultadoItem;
  borde: boolean;
  modoCarga: boolean;
  onGuardado: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const ganaA = r.pa > r.pb;
  return (
    <div style={{ borderTop: borde ? '1px solid var(--borde)' : 'none', paddingTop: borde ? 8 : 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: '0.72rem', opacity: 0.6, textTransform: 'uppercase', fontWeight: 700 }}>
          {r.fase}{r.wo ? ' · W.O.' : ''}
        </span>
        {modoCarga && r.partidoId && (
          <button
            onClick={() => setEditando(!editando)}
            style={{ background: 'none', border: 'none', color: 'var(--lima)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, padding: 0 }}
          >
            {editando ? 'Cancelar' : 'Editar'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '1rem', fontWeight: ganaA ? 700 : 400 }}>
        <span>{r.a}</span>
        <span style={{ color: ganaA ? 'var(--lima)' : 'inherit', fontWeight: 800 }}>{r.pa}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '1rem', fontWeight: ganaA ? 400 : 700 }}>
        <span>{r.b}</span>
        <span style={{ color: ganaA ? 'inherit' : 'var(--lima)', fontWeight: 800 }}>{r.pb}</span>
      </div>
      {editando && (
        <CargaResultado partido={r} inicialA={r.pa} inicialB={r.pb} borrable
          onGuardado={() => { setEditando(false); onGuardado(); }} />
      )}
    </div>
  );
}

type Estado = 'cargando' | 'ok' | 'error';

const chip: React.CSSProperties = {
  fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
  padding: '3px 9px', borderRadius: 999, border: '1px solid var(--borde)', whiteSpace: 'nowrap',
};
const carta: React.CSSProperties = {
  background: 'var(--navy-1)', border: '1px solid var(--borde)', borderRadius: 14, padding: '12px 16px',
};

// ─── Ajustes de horarios (solo modo carga) ───────────────────────────────────

type BorradorCat = { id: string; corto: string; dia: string; noAntes: string };

const etiquetaCampo: React.CSSProperties = { fontSize: '0.78rem', opacity: 0.7, fontWeight: 700 };
const flecha: React.CSSProperties = { padding: '4px 9px', fontSize: '0.8rem', lineHeight: 1 };

// El organizador acomoda el día: cuánto dura un partido, a qué hora arranca cada día, en
// qué orden entran las categorías y si alguna no puede empezar antes de cierta hora.
// Las canchas se prenden y apagan en el tablero "En cancha".
function AjustesHorarios({ vigente, cats, onGuardar }: {
  vigente: ProgramaVigente;
  cats: CatProg[];
  onGuardar: (ajustes: AjustesPrograma) => Promise<string | null>;
}) {
  const [duracion, setDuracion] = useState(String(vigente.duracion));
  const [inicios, setInicios] = useState<Record<string, string>>(
    () => Object.fromEntries(vigente.dias.map((d) => [d.clave, aHora(d.inicio)])),
  );
  const [lista, setLista] = useState<BorradorCat[]>(
    () => cats.map((c) => ({ id: c.torneoId, corto: c.corto, dia: c.dia, noAntes: c.noAntes === null ? '' : aHora(c.noAntes) })),
  );
  const [opc, setOpc] = useState(() => ({
    activo: vigente.bloque !== null,
    dia: vigente.bloque?.dia ?? vigente.dias[vigente.dias.length - 1].clave,
    desde: vigente.bloque ? aHora(vigente.bloque.desde) : '18:00',
    hasta: vigente.bloque ? aHora(vigente.bloque.hasta) : '19:00',
  }));
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null);

  const cambiar = (id: string, cambio: Partial<BorradorCat>) =>
    setLista((l) => l.map((c) => (c.id === id ? { ...c, ...cambio } : c)));
  // sube o baja una categoría entre las de su mismo día
  const mover = (id: string, paso: -1 | 1) => setLista((l) => {
    const diaDeEsta = l.find((c) => c.id === id)?.dia;
    const delDia = l.filter((c) => c.dia === diaDeEsta);
    const i = delDia.findIndex((c) => c.id === id);
    const j = i + paso;
    if (i === -1 || j < 0 || j >= delDia.length) return l;
    const copia = [...l];
    const a = l.indexOf(delDia[i]);
    const b = l.indexOf(delDia[j]);
    [copia[a], copia[b]] = [copia[b], copia[a]];
    return copia;
  });

  async function guardar() {
    const min = Number(duracion);
    if (!Number.isInteger(min) || min < 5 || min > 120) {
      setMensaje({ tono: 'error', texto: 'La duración va entre 5 y 120 minutos' });
      return;
    }
    const nuevosInicios: Record<string, number> = {};
    for (const d of vigente.dias) {
      const m = aMinuto(inicios[d.clave] ?? '');
      if (m === null) {
        setMensaje({ tono: 'error', texto: `Falta la hora de inicio del ${d.nombre.toLowerCase()}` });
        return;
      }
      nuevosInicios[d.clave] = m;
    }
    const categorias: NonNullable<AjustesPrograma['categorias']> = {};
    for (const d of vigente.dias) {
      lista.filter((c) => c.dia === d.clave).forEach((c, orden) => {
        const noAntes = aMinuto(c.noAntes);
        categorias[c.id] = { dia: c.dia, orden, ...(noAntes === null ? {} : { noAntes }) };
      });
    }
    let bloque: AjustesPrograma['bloque'] = null;
    if (opc.activo) {
      const desde = aMinuto(opc.desde);
      const hasta = aMinuto(opc.hasta);
      if (desde === null || hasta === null || hasta <= desde) {
        setMensaje({ tono: 'error', texto: 'Revisá el horario del One Point Challenge' });
        return;
      }
      bloque = { dia: opc.dia, desde, hasta, ...BLOQUE_OPC };
    }
    setGuardando(true);
    setMensaje(null);
    const problema = await onGuardar({ duracion: min, inicios: nuevosInicios, categorias, bloque });
    setGuardando(false);
    setMensaje(problema ? { tono: 'error', texto: problema } : { tono: 'ok', texto: 'Horarios guardados' });
  }

  return (
    <details style={{ ...carta, marginBottom: 14 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Ajustar horarios</summary>
      <div style={{ display: 'grid', gap: 16, marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={etiquetaCampo}>Minutos por partido</span>
            <input type="number" inputMode="numeric" min={5} max={120} value={duracion}
              onChange={(e) => setDuracion(e.target.value)} style={{ width: 96 }} />
          </label>
          {vigente.dias.map((d) => (
            <label key={d.clave} style={{ display: 'grid', gap: 4 }}>
              <span style={etiquetaCampo}>{d.nombre} arranca</span>
              <input type="time" value={inicios[d.clave] ?? ''}
                onChange={(e) => setInicios({ ...inicios, [d.clave]: e.target.value })} />
            </label>
          ))}
        </div>

        {vigente.dias.map((d) => {
          const delDia = lista.filter((c) => c.dia === d.clave);
          if (delDia.length === 0) return null;
          return (
            <div key={d.clave}>
              <div style={{ ...etiquetaCampo, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                {d.nombre} · orden en que arrancan las categorías
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {delDia.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="boton secundario" style={flecha} disabled={i === 0}
                      onClick={() => mover(c.id, -1)} aria-label={`Subir ${c.corto}`}>▲</button>
                    <button className="boton secundario" style={flecha} disabled={i === delDia.length - 1}
                      onClick={() => mover(c.id, 1)} aria-label={`Bajar ${c.corto}`}>▼</button>
                    <strong style={{ flex: '1 1 11rem', fontSize: '0.92rem' }}>{i + 1}. {c.corto}</strong>
                    <select value={c.dia} onChange={(e) => cambiar(c.id, { dia: e.target.value })}
                      aria-label={`Día de ${c.corto}`} style={{ padding: '6px 8px', fontSize: '0.85rem' }}>
                      {vigente.dias.map((x) => <option key={x.clave} value={x.clave}>{x.nombre}</option>)}
                    </select>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8rem', opacity: 0.85 }}>
                      no antes de
                      <input type="time" value={c.noAntes} onChange={(e) => cambiar(c.id, { noAntes: e.target.value })}
                        aria-label={`${c.corto}: no antes de`} />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700 }}>
            <input type="checkbox" checked={opc.activo} onChange={(e) => setOpc({ ...opc, activo: e.target.checked })} />
            One Point Challenge
          </label>
          {opc.activo && (
            <>
              <select value={opc.dia} onChange={(e) => setOpc({ ...opc, dia: e.target.value })}
                aria-label="Día del One Point Challenge" style={{ padding: '6px 8px', fontSize: '0.85rem' }}>
                {vigente.dias.map((x) => <option key={x.clave} value={x.clave}>{x.nombre}</option>)}
              </select>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8rem', opacity: 0.85 }}>
                de <input type="time" value={opc.desde} onChange={(e) => setOpc({ ...opc, desde: e.target.value })} aria-label="One Point Challenge: desde" />
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.8rem', opacity: 0.85 }}>
                a <input type="time" value={opc.hasta} onChange={(e) => setOpc({ ...opc, hasta: e.target.value })} aria-label="One Point Challenge: hasta" />
              </label>
              <span style={{ fontSize: '0.78rem', opacity: 0.6 }}>ocupa todas las canchas</span>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="boton" disabled={guardando} onClick={() => void guardar()}>
            {guardando ? 'Guardando…' : 'Guardar horarios'}
          </button>
          {mensaje && (
            <span role="status" style={{ fontSize: '0.88rem', fontWeight: 700, color: mensaje.tono === 'ok' ? 'var(--lima)' : '#ff8fa8' }}>
              {mensaje.tono === 'ok' ? '✓ ' : ''}{mensaje.texto}
            </span>
          )}
        </div>
      </div>
    </details>
  );
}

// "#F05A28" + 0.16 → "rgba(240,90,40,0.16)" (las luces del fondo usan los colores del flyer).
function conAlfa(hex: string, alfa: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alfa})`;
}

// Día que se muestra al entrar: el que se está jugando; antes del torneo, el primero; después, el último.
function diaInicial(): string {
  const m = momentoDeTorneo(new Date(), PROGRAMA.dias);
  if (m.dia) return m.dia;
  const ultimo = PROGRAMA.dias[PROGRAMA.dias.length - 1];
  return m.fecha > ultimo.fecha ? ultimo.clave : PROGRAMA.dias[0].clave;
}

export default function ProgramacionPage() {
  const [estado, setEstado] = useState<Estado>('cargando');
  const [mensajeError, setMensajeError] = useState('');
  const [torneos, setTorneos] = useState<TorneoPublico[]>([]);
  const [ajustes, setAjustes] = useState<AjustesPrograma | null>(null);
  const [actualizado, setActualizado] = useState<Date | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const [dia, setDia] = useState(diaInicial);
  const [filtro, setFiltro] = useState('');
  const [busqueda, setBusqueda] = useState('');
  // Modo admin: visible solo con sesión iniciada, y aún así apagado por defecto
  // (la misma página va en la TV del club: ahí nadie tiene que ver inputs).
  const [esAdmin, setEsAdmin] = useState(false);
  // persiste entre recargas (cada deploy recarga la pagina y lo apagaba)
  const [modoCargaGuardado, setModoCargaEstado] = useState(() => almacenLocal.leer('volea_envivo_carga') === '1');
  const setModoCarga = (v: boolean) => {
    setModoCargaEstado(v);
    almacenLocal.guardar('volea_envivo_carga', v ? '1' : '0');
  };
  // sin sesión los controles no se muestran aunque el modo haya quedado prendido en este navegador
  const modoCarga = modoCargaGuardado && esAdmin;

  useEffect(() => {
    void supabase?.auth.getSession().then(({ data }) => setEsAdmin(!!data.session));
  }, []);

  const [enCancha, setEnCancha] = useState<EnCancha[]>([]);

  const cargar = useCallback(async (primera: boolean) => {
    if (primera) setEstado('cargando');
    const r = await listarTorneosPublicos();
    if (r.error) {
      if (primera) { setMensajeError(r.error); setEstado('error'); }
      return; // refresh silencioso fallido: se mantiene lo último que se vio
    }
    setTorneos(r.torneos);
    // Tablero de canchas y ajustes de horarios (lectura pública). Si fallan, se conserva lo último visto.
    if (supabase) {
      const [tablero, programa] = await Promise.all([
        supabase.from('rk_en_cancha').select('cancha, torneo_id, partido_id, updated_at, habilitada'),
        supabase.from('rk_programa').select('config').eq('clave', PROGRAMA.clave).maybeSingle(),
      ]);
      if (tablero.data) {
        setEnCancha(tablero.data.map((f) => ({
          cancha: f.cancha as string,
          torneoId: (f.torneo_id as string | null) ?? null,
          partidoId: (f.partido_id as string | null) ?? null,
          desde: (f.updated_at as string | null) ?? null,
          habilitada: (f.habilitada as boolean | null) ?? true,
        })));
      }
      if (!programa.error) setAjustes((programa.data?.config as AjustesPrograma | undefined) ?? null);
    }
    setActualizado(new Date());
    setEstado('ok');
  }, []);

  async function mandarACancha(cancha: string, ref: { torneoId?: string | null; partidoId?: string | null }) {
    const sb = supabase;
    if (!sb || !ref.partidoId) return;
    const ahora = new Date().toISOString();
    // si ya estaba marcado en otra cancha, primero se lo saca de ahí
    await sb.from('rk_en_cancha').update({ torneo_id: null, partido_id: null, updated_at: ahora }).eq('partido_id', ref.partidoId);
    await sb.from('rk_en_cancha').update({ torneo_id: ref.torneoId, partido_id: ref.partidoId, updated_at: ahora }).eq('cancha', cancha);
    void cargar(false);
  }

  async function setHabilitada(cancha: string, valor: boolean) {
    const sb = supabase;
    if (!sb) return;
    await sb.from('rk_en_cancha').update({ habilitada: valor, updated_at: new Date().toISOString() }).eq('cancha', cancha);
    void cargar(false);
  }

  async function liberarCancha(cancha: string) {
    const sb = supabase;
    if (!sb) return;
    await sb.from('rk_en_cancha').update({ torneo_id: null, partido_id: null, updated_at: new Date().toISOString() }).eq('cancha', cancha);
    void cargar(false);
  }

  async function guardarAjustes(nuevos: AjustesPrograma): Promise<string | null> {
    const sb = supabase;
    if (!sb) return 'Sin conexión con el servidor';
    const { error } = await sb.from('rk_programa')
      .upsert({ clave: PROGRAMA.clave, config: nuevos, updated_at: new Date().toISOString() });
    if (error) return 'No se pudo guardar (¿sesión vencida?)';
    setAjustes(nuevos);
    return null;
  }

  const [tick, setTick] = useState(0);

  useEffect(() => {
    void cargar(true);
    // el sondeo queda como respaldo: lo instantaneo lo trae Realtime
    const timer = window.setInterval(() => void cargar(false), 60000);
    const reloj = window.setInterval(() => setTick((t) => t + 1), 15000);
    return () => { window.clearInterval(timer); window.clearInterval(reloj); };
  }, [cargar]);

  // Tiempo real: cualquier cambio en canchas, torneos u horarios (desde este u otro
  // dispositivo, o el gestor) refresca al instante en todos lados, TV incluida.
  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let timer: number | undefined;
    const pedir = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void cargar(false), 250);
    };
    const canal = sb.channel('envivo-programacion')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rk_en_cancha' }, pedir)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rk_torneos' }, pedir)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rk_programa' }, pedir)
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      void sb.removeChannel(canal);
    };
  }, [cargar]);

  const ordenCancha = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const activas = enCancha.length > 0
    ? enCancha.filter((e) => e.habilitada).map((e) => e.cancha).sort(ordenCancha)
    : PROGRAMA.canchas;

  const { filas, resumen, cats, vigente, momento } = useMemo(() => {
    const vigente = aplicarAjustes(PROGRAMA, ajustes);
    const cats = categoriasDelEvento(torneos, PROGRAMA, vigente);
    const momento = momentoDeTorneo(new Date(), vigente.dias);
    const enJuego = enCancha.flatMap((e) => (e.torneoId && e.partidoId && e.desde
      ? [{ cancha: e.cancha, torneoId: e.torneoId, partidoId: e.partidoId, desde: minutoDesde(momento.fecha, new Date(e.desde)) }]
      : []));
    const programado = programarEvento({ cats, vigente, ahora: momento, canchas: { activas, enJuego } });
    return { ...programado, cats, vigente, momento };
  }, [torneos, ajustes, actualizado, enCancha, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (estado === 'cargando') return <RkCargando texto="Armando la programación…" />;
  if (estado === 'error') return <RkError mensaje={mensajeError} onReintentar={() => void cargar(true)} />;

  const indiceDia = (clave: string) => vigente.dias.findIndex((d) => d.clave === clave);
  const diaElegido = vigente.dias.find((d) => d.clave === dia) ?? vigente.dias[0];
  const filasDelDia = filas.filter((f) => f.dia === dia);
  // Categorías del día: las suyas y las que arrastran partidos de un día anterior.
  const catsDelDia = cats.filter((c) => c.dia === dia || filasDelDia.some((f) => f.categoria === c.corto));
  // Búsqueda por jugador o categoría (acento- y mayúscula-insensible), combinable con los chips.
  const q = normalizar(busqueda);
  const coincide = (texto: string) => !q || normalizar(texto).includes(q);
  const canchaDePartido = new Map(
    enCancha.filter((e) => e.torneoId && e.partidoId).map((e) => [claveDePartido(e.torneoId as string, e.partidoId as string), e.cancha]),
  );
  const enCanchaYa = (f: RefPartido) => !!f.torneoId && !!f.partidoId && canchaDePartido.has(claveDePartido(f.torneoId, f.partidoId));
  const pendientes = filasDelDia
    .filter((f) =>
      (!filtro || f.categoria === filtro || f.bloque)
      && coincide(`${f.a} ${f.b} ${f.categoria}`)
      // los que están jugando viven en el tablero de arriba, no se repiten acá
      && !enCanchaYa(f));
  const visibles = verTodos || filtro || q ? pendientes : pendientes.slice(0, 12);
  const conResultados = cats
    .filter((c) => c.dia === dia)
    .map((c) => ({
      ...c,
      resultados: !q || coincide(c.corto) ? c.resultados : c.resultados.filter((r) => coincide(`${r.a} ${r.b}`)),
    }))
    .filter((c) => c.resultados.length > 0 && (!filtro || c.corto === filtro));
  // Lo último que arrancó, primero: el día más nuevo y, dentro del día, la última categoría en entrar.
  const recientesPrimero = cats.slice().reverse().sort((x, y) => indiceDia(y.dia) - indiceDia(x.dia));
  // Cinta de últimos resultados (todas las categorías; dentro de cada una, la llave primero).
  const cinta = recientesPrimero.flatMap((c) => c.resultados.map((r) => ({ cat: c.corto, ...r }))).slice(0, 30);
  // Campeones, el último título arriba.
  const campeones = recientesPrimero.filter((c) => c.campeon);
  const resumenDia = resumen[diaElegido.clave] ?? { partidos: 0, termina: null };
  // Quién está jugando AHORA en alguna cancha (para avisar antes de mandar a
  // una misma persona a dos canchas: pasa con los que juegan varias categorías).
  const ocupados = new Map<string, string>();
  enCancha.forEach((e) => {
    const et = e.partidoId ? etiquetaEnCancha(torneos, e) : null;
    if (!et) return;
    [...et.a.split(/\s+y\s+/i), ...et.b.split(/\s+y\s+/i)].forEach((n) => ocupados.set(normalizar(n), e.cancha));
  });
  const conflictosDe = (f: Fila) =>
    [...f.a.split(/\s+y\s+/i), ...f.b.split(/\s+y\s+/i)]
      .map((n) => ({ jugador: n.trim(), cancha: ocupados.get(normalizar(n)) }))
      .filter((c): c is { jugador: string; cancha: string } => !!c.cancha);
  // Qué poner en cada cancha vacía: lo que el reparto le asignó a esa cancha para ahora y,
  // si eso todavía no se puede mandar (un cruce sin definir), lo primero que sí se pueda.
  // Ignora el buscador y el filtro a propósito: una cancha libre siempre tiene que ofrecer algo.
  const canchasLibres = activas.filter((c) => !enCancha.find((e) => e.cancha === c)?.partidoId);
  const diaTablero = momento.dia ?? dia;
  const jugable = (f: Fila) => !!f.partidoId && !!f.listo && !enCanchaYa(f) && conflictosDe(f).length === 0;
  const porMandar = filas.filter((f) => f.dia === diaTablero && jugable(f));
  const sugerencias = new Map<string, Fila>();
  for (const cancha of canchasLibres) {
    const suya = porMandar.findIndex((f) => f.cancha === cancha && f.ini === porMandar[0].ini);
    const [f] = porMandar.splice(suya === -1 ? 0 : suya, 1);
    if (f) sugerencias.set(cancha, f);
  }
  const [color1, color2, color3] = PROGRAMA.colores;

  return (
    <div className="rk" style={{ position: 'relative' }}>
      {/* Fondo con vida: luces en los colores del flyer del evento + puntillado, fijos y
          sin capturar toques. El contenido va arriba con zIndex 1. */}
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: [
          `radial-gradient(620px 420px at 88% -60px, ${conAlfa(color1, 0.16)}, transparent 70%)`,
          `radial-gradient(720px 520px at -12% 34%, ${conAlfa(color2, 0.12)}, transparent 70%)`,
          `radial-gradient(640px 640px at 72% 112%, ${conAlfa(color3, 0.09)}, transparent 70%)`,
        ].join(', '),
      }} />
      <div aria-hidden style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 0.5,
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.055) 1px, transparent 1.4px)',
        backgroundSize: '22px 22px',
      }} />
      <main className="contenedor" style={{ position: 'relative', zIndex: 1, maxWidth: 1760 }}>
        <div aria-hidden style={{
          height: 4, borderRadius: 999, marginBottom: 14,
          background: `linear-gradient(90deg, ${color1}, ${color2} 55%, ${color3})`,
        }} />

        {cinta.length > 0 && (
          <div className="cinta-resultados" aria-label="Últimos resultados"
            style={{ border: '1px solid var(--borde)', borderRadius: 14, background: 'var(--navy-1)', marginBottom: 14 }}>
            <div className="cinta-track" style={{
              display: 'inline-flex', whiteSpace: 'nowrap', alignItems: 'center',
              animation: `rk-marquee ${Math.max(25, cinta.length * 6)}s linear infinite`, willChange: 'transform',
            }}>
              {[...cinta, ...cinta].map((r, i) => {
                const ganaA = r.pa > r.pb;
                return (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '12px 22px', textTransform: 'uppercase' }}>
                    <span style={{ color: 'var(--lima)', fontWeight: 800, fontSize: '0.95rem', letterSpacing: '0.06em' }}>{r.cat}</span>
                    <span style={{ fontSize: '1.25rem', letterSpacing: '0.02em', color: '#fff' }}>
                      <span style={{ fontWeight: ganaA ? 800 : 500, opacity: ganaA ? 1 : 0.85 }}>
                        {nombresPila(r.a)} <span style={{ color: ganaA ? 'var(--lima)' : '#fff' }}>{r.pa}</span>
                      </span>
                      <span style={{ opacity: 0.5 }}> – </span>
                      <span style={{ fontWeight: ganaA ? 500 : 800, opacity: ganaA ? 0.85 : 1 }}>
                        <span style={{ color: ganaA ? '#fff' : 'var(--lima)' }}>{r.pb}</span> {nombresPila(r.b)}
                      </span>
                    </span>
                    <span style={{ opacity: 0.3, color: 'var(--lima)' }}>◆</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <header className="cabecera">
          <h1><span className="marca">EN VIVO</span> {PROGRAMA.titulo}</h1>
          <div className="acciones">
            <Link className="boton secundario" to="/torneos">Cuadros</Link>
            <button className="boton secundario" onClick={() => void cargar(false)}>Actualizar</button>
            {esAdmin && (
              <button className={`boton ${modoCarga ? '' : 'secundario'}`} onClick={() => setModoCarga(!modoCarga)}>
                {modoCarga ? '✓ Cargando resultados' : 'Cargar resultados'}
              </button>
            )}
          </div>
        </header>

        {modoCarga && (
          <AjustesHorarios
            // se rearma solo si aparece o desaparece una categoría: al guardar (que puede
            // cambiarles el orden) tiene que seguir abierto y mostrando la confirmación
            key={cats.map((c) => c.torneoId).sort().join(',')}
            vigente={vigente} cats={cats} onGuardar={guardarAjustes}
          />
        )}

        {cats.length === 0 ? (
          <div style={{ ...carta, borderColor: 'var(--lima)', textAlign: 'center', padding: '30px 20px' }}>
            <p style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>{PROGRAMA.avisoSinCuadros}</p>
            <p style={{ margin: '10px 0 0', opacity: 0.75 }}>
              {vigente.dias.map((d) => `${d.nombre} desde las ${aHora(d.inicio)}`).join(' · ')}
            </p>
            {modoCarga && (
              <p style={{ margin: '14px 0 0', fontSize: '0.88rem', color: 'var(--lima)' }}>
                Para que un cuadro aparezca acá, su nombre en el gestor tiene que decir ANIVERSARIO
                (por ejemplo «SINGLES FEMENINO ANIVERSARIO»).
              </p>
            )}
          </div>
        ) : (
        <div className="envivo-grid">
        <aside className="col-izq">
          <div style={{ ...carta, borderColor: 'var(--lima)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: '1.4rem' }}>🏆</span>
              <span style={{ fontWeight: 900, letterSpacing: '0.1em', fontSize: '1rem' }}>CAMPEONES</span>
            </div>
            {campeones.length === 0 ? (
              <div style={{ opacity: 0.5, fontSize: '0.9rem' }}>
                {cats.some((c) => c.jugados > 0) ? 'El primer título se está jugando…' : 'Todavía no arrancó el torneo.'}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {campeones.map((c, i) => (
                  <div key={c.torneoId} style={{ borderLeft: '3px solid var(--lima)', paddingLeft: 10 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.08em', color: 'var(--lima)', textTransform: 'uppercase' }}>
                        {c.corto}
                      </span>
                      {i === 0 && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 900, background: 'var(--lima)', color: '#101c33', borderRadius: 999, padding: '1px 7px', letterSpacing: '0.06em' }}>
                          ✨ NUEVO
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.3, textTransform: 'uppercase' }}>
                      {c.campeon}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        {conResultados.length > 0 && (
          <>
            <h2 style={{ fontSize: '1.05rem', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.8, margin: '18px 0 10px' }}>
              Resultados
            </h2>
            <div style={{ display: 'grid', gap: 14 }}>
              {conResultados.map((c) => (
                <div key={c.torneoId} style={carta}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
                    <strong style={{ fontSize: '1.02rem' }}>{c.corto}</strong>
                    <span style={{ fontSize: '0.78rem', opacity: 0.6 }}>{c.jugados}/{c.total} jugados</span>
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {c.resultados.map((r, i) => (
                      <FilaResultado key={r.partidoId ?? i} r={r} borde={i > 0} modoCarga={modoCarga}
                        onGuardado={() => void cargar(false)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        </aside>
        <div className="col-centro">

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          {vigente.dias.map((d) => (
            <button key={d.clave} className={`boton ${dia === d.clave ? '' : 'secundario'}`}
              onClick={() => { setDia(d.clave); setFiltro(''); setVerTodos(false); }}>
              {d.nombre}
            </button>
          ))}
          <span style={{ fontSize: '0.8rem', opacity: 0.65, marginLeft: 'auto' }}>
            Horarios estimados{actualizado ? ` · ${actualizado.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
        </div>
        {resumenDia.termina !== null && (
          <p style={{ margin: '0 0 14px', fontSize: '0.92rem', opacity: 0.85 }}>
            {momento.dia === diaElegido.clave ? '' : `Arranca ${aHora(diaElegido.inicio)} · `}
            <strong>{resumenDia.partidos}</strong> {resumenDia.partidos === 1 ? 'partido' : 'partidos'} por jugar en {activas.length}{' '}
            {activas.length === 1 ? 'cancha' : 'canchas'} · termina cerca de las <strong>{aHora(resumenDia.termina)}</strong>
          </p>
        )}

        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscá tu nombre o categoría…"
          aria-label="Buscar por jugador o categoría"
          style={{ width: '100%', marginBottom: 10, fontSize: '1rem' }}
        />

        {/* Filtro por categoría: un toque y ves solo lo tuyo */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 10 }}>
          <button onClick={() => setFiltro('')}
            style={{ ...chip, cursor: 'pointer', background: filtro === '' ? 'var(--lima)' : 'transparent', color: filtro === '' ? '#101c33' : 'var(--texto)' }}>
            Todas
          </button>
          {catsDelDia.map((c) => (
            <button key={c.torneoId} onClick={() => { setFiltro(filtro === c.corto ? '' : c.corto); setVerTodos(false); }}
              style={{ ...chip, cursor: 'pointer', background: filtro === c.corto ? 'var(--lima)' : 'transparent', color: filtro === c.corto ? '#101c33' : 'var(--texto)' }}>
              {c.corto} {c.terminado ? '✓' : `${c.jugados}/${c.total}`}
            </button>
          ))}
        </div>

            {modoCarga && catsDelDia
              .filter((c) => c.gruposCompletos && !c.llaveArmada && !c.terminado)
              .map((c) => (
                <div key={c.torneoId} style={{ ...carta, borderColor: 'var(--lima)', marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800 }}>🏁 {c.corto}: grupos completos</span>
                  <button className="boton" onClick={async () => {
                    const problema = await armarLlaveEnServidor(c.torneoId);
                    if (problema) window.alert(problema);
                    void cargar(false);
                  }}>
                    {c.nGrupos === 1 ? 'Armar FINAL (1° vs 2°)' : c.nGrupos === 2 ? 'Armar SEMIS + FINAL' : 'Ver cómo armar'}
                  </button>
                </div>
              ))}

            <h2 style={{ fontSize: '1.05rem', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.8, margin: '0 0 10px' }}>
              Próximos partidos
            </h2>
            {pendientes.length === 0 ? (
              <p className="vacio">
                {catsDelDia.length === 0 ? 'Todavía no hay cuadros cargados para este día.' : 'No queda nada pendiente para este día 🎉'}
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
                {visibles.map((f, i) => (
                  <div key={f.partidoId ? claveDePartido(f.torneoId ?? '', f.partidoId) : `${f.categoria}-${f.fase}-${i}`}
                    style={f.bloque ? { ...carta, borderColor: 'var(--lima)' } : carta}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--lima)' }}>{aHora(f.ini)}</span>
                      <span style={chip}>{f.cancha}</span>
                      <span style={chip}>{f.categoria}</span>
                      <span style={{ ...chip, border: 'none', opacity: 0.7, fontWeight: f.fase === 'FINAL' ? 800 : 700 }}>{f.fase}</span>
                    </div>
                    <div style={{ fontSize: '1.02rem', fontWeight: 600, lineHeight: 1.45 }}>
                      {f.bloque ? f.a : (
                        <>
                          {f.a}
                          <span style={{ opacity: 0.55, fontWeight: 400 }}> vs </span>
                          {f.b}
                        </>
                      )}
                    </div>
                    {modoCarga && f.partidoId && f.listo && (() => {
                      const choques = conflictosDe(f);
                      return (
                        <>
                          {choques.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: '0.82rem', color: '#ffd28a', fontWeight: 700 }}>
                              ⚠ {choques.map((c) => `${c.jugador} está jugando en ${c.cancha}`).join(' · ')}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                            <span style={{ fontSize: '0.75rem', opacity: 0.6, fontWeight: 700 }}>Mandar a</span>
                            {activas.map((nombre) => (
                              <button key={nombre} className="boton secundario"
                                style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                                onClick={() => {
                                  if (choques.length > 0 && !window.confirm(
                                    `${choques.map((c) => `${c.jugador} está jugando en ${c.cancha}`).join('. ')}. ¿Mandar igual?`)) return;
                                  void mandarACancha(nombre, f);
                                }}>
                                {nombre.replace('Cancha ', 'C')}
                              </button>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
            {!verTodos && !filtro && !q && pendientes.length > visibles.length && (
              <button className="boton secundario" style={{ width: '100%', marginBottom: 20 }} onClick={() => setVerTodos(true)}>
                Ver los {pendientes.length} pendientes del día
              </button>
            )}

        </div>
        <div className="col-der">
          <h2 style={{ fontSize: '1.05rem', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.8, margin: '0 0 10px' }}>
            En cancha
          </h2>
        {/* Tablero: quién está jugando en cada cancha AHORA (lo ve todo el mundo) */}
        <div style={{ display: 'grid', gap: 10 }}>
          {(modoCarga ? enCancha : enCancha.filter((e) => e.habilitada))
            .slice().sort((a, b) => ordenCancha(a.cancha, b.cancha)).map((e) => {
            const nombre = e.cancha;
            const off = !e.habilitada;
            const et = off ? null : etiquetaEnCancha(torneos, e);
            return (
              <div key={nombre} style={{ ...carta, borderColor: et ? 'var(--lima)' : 'var(--borde)', opacity: off ? 0.55 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ ...chip, background: et ? 'var(--lima)' : 'transparent', color: et ? '#101c33' : 'var(--texto)' }}>
                    {et ? '▶ ' : ''}{nombre}
                  </span>
                  {et && e?.desde && (
                    <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--lima)', fontVariantNumeric: 'tabular-nums' }}>
                      ⏱ {Math.max(0, Math.floor((Date.now() - new Date(e.desde).getTime()) / 60000))}′
                    </span>
                  )}
                </div>
                {et ? (
                  <>
                    <div style={{ fontSize: '0.72rem', opacity: 0.65, textTransform: 'uppercase', fontWeight: 700, marginBottom: 3 }}>{et.cat}</div>
                    <div style={{ fontSize: '0.98rem', fontWeight: 700, lineHeight: 1.35 }}>{et.a} vs {et.b}</div>
                    {modoCarga && e?.torneoId && e?.partidoId && (
                      <>
                        <CargaResultado
                          partido={{ a: et.a, b: et.b, torneoId: e.torneoId, partidoId: e.partidoId, tipo: et.tipo }}
                          onGuardado={() => void cargar(false)}
                        />
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                          <span style={{ fontSize: '0.75rem', opacity: 0.6, fontWeight: 700 }}>Mover a</span>
                          {activas.filter((otra) => otra !== nombre).map((otra) => (
                            <button key={otra} className="boton secundario"
                              style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                              onClick={() => void mandarACancha(otra, e)}>
                              {otra.replace('Cancha ', 'C')}
                            </button>
                          ))}
                          <button className="boton secundario" style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                            onClick={() => void liberarCancha(nombre)}>
                            ✕ Cancelar
                          </button>
                        </div>
                      </>
                    )}
                  </>
                ) : off ? (
                  <div>
                    <div style={{ opacity: 0.6, fontWeight: 700, marginBottom: 8 }}>Deshabilitada</div>
                    {modoCarga && (
                      <button className="boton secundario" style={{ padding: '4px 12px', fontSize: '0.85rem' }}
                        onClick={() => void setHabilitada(nombre, true)}>
                        Habilitar
                      </button>
                    )}
                  </div>
                ) : (() => {
                  const sug = modoCarga ? sugerencias.get(nombre) : undefined;
                  const apagar = modoCarga ? (
                    <button onClick={() => void setHabilitada(nombre, false)}
                      style={{ background: 'none', border: 'none', color: 'var(--lima)', opacity: 0.7, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, padding: 0, marginTop: 8, display: 'block' }}>
                      Deshabilitar cancha
                    </button>
                  ) : null;
                  if (!sug) return <div><div style={{ opacity: 0.45, fontWeight: 600 }}>Libre</div>{apagar}</div>;
                  return (
                    <>
                      <div style={{ fontSize: '0.72rem', opacity: 0.6, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>
                        Libre — sigue: {sug.categoria} · {sug.fase}
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.35, marginBottom: 8 }}>
                        {sug.a} <span style={{ opacity: 0.5, fontWeight: 400 }}>vs</span> {sug.b}
                      </div>
                      <button className="boton" style={{ width: '100%' }} onClick={() => void mandarACancha(nombre, sug)}>
                        Mandar a {nombre}
                      </button>
                      {apagar}
                    </>
                  );
                })()}
              </div>
            );
          })}
        </div>
        </div>
        </div>
        )}
      </main>
    </div>
  );
}
