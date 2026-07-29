import { useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import type { ConfigPuntos as TConfigPuntos, Jugador, Torneo } from './engine/tipos';
import { CONFIG_PUNTOS_DEFAULT, nuevoId } from './engine/tipos';
import { DialogosProvider, useDialogos } from './ui/dialogos';
import { reconciliarTorneo } from './ui/reconciliar';
import PasoParejas from './ui/PasoParejas';
import PasoGrupos from './ui/PasoGrupos';
import PasoFaseGrupos from './ui/PasoFaseGrupos';
import PasoLlave from './ui/PasoLlave';
import PantallaRanking from './ui/PantallaRanking';
import PantallaJugadores from './ui/PantallaJugadores';
import PantallaConfigPuntos from './ui/ConfigPuntos';

// Estado completo del gestor (mismo shape que el "estado v2" de la app local, sin el campo version)
export type EstadoTorneos = { torneos: Torneo[]; jugadores: Jugador[]; configPuntos?: TConfigPuntos };

const ETIQUETA_FASE: Record<Torneo['fase'], string> = {
  parejas: 'Cargando parejas',
  grupos: 'Armando grupos',
  faseGrupos: 'Fase de grupos',
  llave: 'Llave',
  terminado: 'Terminado 🏆',
};

const ETIQUETA_FORMATO: Record<string, string> = { grupos: 'Grupos + llave', individual: 'One Point Challenge' };

type Props = { estado: EstadoTorneos; setEstado: (cambio: (e: EstadoTorneos) => EstadoTorneos) => void; extraCabecera?: ReactNode };

export default function TorneosApp(props: Props) {
  return (
    <DialogosProvider>
      <TorneosInterno {...props} />
    </DialogosProvider>
  );
}

function TorneosInterno({ estado, setEstado, extraCabecera }: Props) {
  const dialogos = useDialogos();
  const [torneoActivoId, setTorneoActivoId] = useState<string | null>(null);
  const [vista, setVista] = useState<'home' | 'ranking' | 'jugadores' | 'config'>('home');
  const config = estado.configPuntos ?? CONFIG_PUNTOS_DEFAULT;

  const torneo = estado.torneos.find((t) => t.id === torneoActivoId) ?? null;

  function actualizarTorneo(id: string, cambio: (t: Torneo) => Torneo) {
    setEstado((e) => ({ ...e, torneos: e.torneos.map((t) => (t.id === id ? cambio(t) : t)) }));
  }
  function setJugadores(jugadores: Jugador[]) { setEstado((e) => ({ ...e, jugadores })); }
  function setTorneos(torneos: Torneo[]) { setEstado((e) => ({ ...e, torneos })); }
  function setConfig(configPuntos: TConfigPuntos) { setEstado((e) => ({ ...e, configPuntos })); }

  async function vincularTorneo(torneoId: string) {
    const t = estado.torneos.find((x) => x.id === torneoId);
    if (!t) return;
    const r = await reconciliarTorneo(t, estado.jugadores, dialogos);
    if (r.cancelado) return;
    // reconciliarTorneo tarda (pregunta al usuario con dialogos): para cuando `r` resuelve,
    // el estado puede haber avanzado (un pull-merge, otra pestaña). Aplicar como DELTA
    // dentro del updater en vez de pisar con la foto vieja de estado.jugadores/torneos.
    setEstado((e) => {
      const porId = new Map(e.jugadores.map((j) => [j.id, j]));
      for (const j of r.jugadores) porId.set(j.id, j); // r gana por id (altas y alias nuevos de esta reconciliacion)
      const jugadores = [...porId.values()];
      const existe = e.torneos.some((x) => x.id === torneoId);
      const torneos = existe ? e.torneos.map((x) => (x.id === torneoId ? r.torneo : x)) : e.torneos;
      return { ...e, jugadores, torneos };
    });
  }

  async function crearTorneo() {
    const r = await dialogos.pedirTextoConOpcion({
      titulo: 'Nuevo torneo',
      valorInicial: `Torneo ${new Date().toLocaleDateString('es-UY')}`,
      placeholder: 'Nombre del torneo',
      textoConfirmar: 'Crear',
      etiquetaOpciones: 'Formato',
      opciones: [
        { clave: 'grupos', etiqueta: 'Grupos + Llave', ayuda: 'Parejas, fase de grupos y llave final.' },
        { clave: 'individual', etiqueta: 'One Point Challenge', ayuda: 'Jugadores individuales, eliminación directa por rondas.' },
      ],
    });
    if (!r) return;
    const cat = await dialogos.elegirDeLista({
      titulo: 'Categoría del torneo',
      mensaje: 'Para el ranking VOLEA (la A da más puntos que la B). Se puede cambiar después.',
      opciones: [
        { clave: 'A', etiqueta: 'Categoría A', ayuda: 'Puntaje completo.' },
        { clave: 'B', etiqueta: 'Categoría B', ayuda: 'Un escalón menos que la A.' },
      ],
      textoConfirmar: 'Crear',
    });
    const nuevo: Torneo = {
      id: nuevoId(),
      nombre: r.texto,
      creadoEl: new Date().toISOString(),
      fase: 'parejas',
      formato: r.opcion === 'individual' ? 'individual' : 'grupos',
      categoria: cat === 'A' || cat === 'B' ? cat : undefined,
      visible: true,
      parejas: [],
      grupos: [],
      partidosGrupo: [],
      configLlave: null,
      partidosLlave: null,
    };
    setEstado((e) => ({ ...e, torneos: [nuevo, ...e.torneos] }));
    setTorneoActivoId(nuevo.id);
  }

  async function borrarTorneo(id: string) {
    const t = estado.torneos.find((x) => x.id === id);
    if (!t) return;
    const ok = await dialogos.confirmar({ titulo: 'Borrar torneo', mensaje: `¿Borrar "${t.nombre}"? No se puede deshacer.`, textoConfirmar: 'Borrar', peligro: true });
    if (!ok) return;
    setEstado((e) => ({ ...e, torneos: e.torneos.filter((x) => x.id !== id) }));
  }

  function exportar(t: Torneo) {
    const ids = new Set(t.parejas.flatMap((p) => p.jugadorIds ?? []));
    const jugadoresDelTorneo = estado.jugadores.filter((j) => ids.has(j.id));
    const json = JSON.stringify({ tipo: 'pickle-torneo', version: 2, torneo: t, jugadores: jugadoresDelTorneo }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${t.nombre.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.torneo.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importar(ev: ChangeEvent<HTMLInputElement>) {
    const archivo = ev.target.files?.[0];
    ev.target.value = '';
    if (!archivo) return;
    archivo.text().then((texto) => {
      try {
        const dato = JSON.parse(texto) as { tipo?: string; torneo?: Torneo; jugadores?: Jugador[] };
        if (!dato || dato.tipo !== 'pickle-torneo' || !dato.torneo) throw new Error('El archivo no es un torneo exportado por la app');
        const t = dato.torneo;
        const formaValida = typeof t.id === 'string' && typeof t.nombre === 'string' && Array.isArray(t.parejas) && Array.isArray(t.grupos) && Array.isArray(t.partidosGrupo);
        if (!formaValida) throw new Error('El archivo de torneo está dañado o incompleto');
        if (typeof t.creadoEl !== 'string' || !t.creadoEl) throw new Error('Archivo sin fecha de creación');
        setEstado((e) => {
          const idsJ = new Set(e.jugadores.map((j) => j.id));
          const jugadoresNuevos = (dato.jugadores ?? []).filter((j) => j && typeof j.id === 'string' && !idsJ.has(j.id));
          const torneoFinal = e.torneos.some((x) => x.id === t.id) ? { ...t, id: nuevoId(), nombre: `${t.nombre} (importado)` } : t;
          return { ...e, torneos: [torneoFinal, ...e.torneos], jugadores: [...e.jugadores, ...jugadoresNuevos] };
        });
      } catch (err) {
        dialogos.avisar({ titulo: 'No se pudo importar', mensaje: err instanceof Error ? err.message : 'No se pudo importar el archivo' });
      }
    }).catch(() => dialogos.avisar({ titulo: 'No se pudo leer', mensaje: 'No se pudo leer el archivo' }));
  }

  if (!torneo && vista === 'ranking') {
    return <PantallaRanking torneos={estado.torneos} jugadores={estado.jugadores} config={config} onVincular={vincularTorneo} onVolver={() => setVista('home')} />;
  }
  if (!torneo && vista === 'jugadores') {
    return <PantallaJugadores jugadores={estado.jugadores} torneos={estado.torneos} config={config} setJugadores={setJugadores} setTorneos={setTorneos} onVolver={() => setVista('home')} />;
  }
  if (!torneo && vista === 'config') {
    return <PantallaConfigPuntos config={config} setConfig={setConfig} onVolver={() => setVista('home')} />;
  }

  if (!torneo) {
    return (
      <main className="contenedor">
        <header className="cabecera">
          <h1><span className="marca">VOLEA</span> · Torneos</h1>
          <div className="acciones">
            {extraCabecera}
            <button className="boton secundario" onClick={() => setVista('ranking')}>🏆 Ranking</button>
            <button className="boton secundario" onClick={() => setVista('jugadores')}>Jugadores</button>
            <button className="boton secundario" onClick={() => setVista('config')}>Puntos</button>
            <label className="boton secundario">
              Importar
              <input type="file" accept="application/json,.json" onChange={importar} className="oculto-accesible" />
            </label>
            <button className="boton" onClick={crearTorneo}>+ Nuevo torneo</button>
          </div>
        </header>
        {estado.torneos.length === 0 ? (
          <p className="vacio">Todavía no hay torneos. Creá el primero con "+ Nuevo torneo".</p>
        ) : (
          <ul className="lista-torneos">
            {estado.torneos.map((t) => (
              <li key={t.id} className="carta">
                <button className="titulo-torneo" onClick={() => setTorneoActivoId(t.id)}>
                  <strong>{t.nombre}</strong>
                  <span>
                    {new Date(t.creadoEl).toLocaleDateString('es-UY')} · {t.parejas.length} {(t.formato ?? 'grupos') === 'individual' ? 'jugadores' : 'parejas'} · {ETIQUETA_FORMATO[t.formato ?? 'grupos']} · {ETIQUETA_FASE[t.fase]}
                    {t.categoria ? ` · Cat ${t.categoria}` : ' · sin categoría'}
                    {t.visible === false ? ' · 🔒 oculto' : ''}
                  </span>
                </button>
                {t.fase === 'terminado' && t.cuentaParaRanking !== false && t.visible === false && (
                  <span className="chip" style={{ color: 'var(--rojo)' }} title="Está sumando al ranking pero el público no lo ve">⚠ suma oculto</span>
                )}
                <div className="acciones">
                  <button className="boton secundario" onClick={() => exportar(t)}>Exportar</button>
                  <button className="boton peligro" onClick={() => borrarTorneo(t.id)}>Borrar</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  return (
    <main className="contenedor">
      <header className="cabecera">
        <button className="boton secundario" onClick={() => setTorneoActivoId(null)}>← Torneos</button>
        <h1>{torneo.nombre}</h1>
      </header>
      <div className="acciones" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <label>Categoría:{' '}
          <select
            value={torneo.categoria ?? ''}
            onChange={(e) => actualizarTorneo(torneo.id, (t) => ({ ...t, categoria: e.target.value === '' ? undefined : (e.target.value as 'A' | 'B') }))}
          >
            <option value="">— sin categoría —</option>
            <option value="A">A</option>
            <option value="B">B</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={torneo.cuentaParaRanking !== false}
            onChange={(e) => actualizarTorneo(torneo.id, (t) => ({ ...t, cuentaParaRanking: e.target.checked }))}
          />{' '}
          Cuenta para el ranking
        </label>
        <label>
          <input
            type="checkbox"
            checked={torneo.visible !== false}
            onChange={(e) => actualizarTorneo(torneo.id, (t) => ({ ...t, visible: e.target.checked }))}
          />{' '}
          Visible al público
        </label>
      </div>
      <Wizard torneo={torneo} actualizar={(cambio) => actualizarTorneo(torneo.id, cambio)} />
    </main>
  );
}

// Contrato de los pasos del wizard: `cambio` corre dentro del state updater de React,
// así que debe ser PURO (nada de alerts/confirms adentro; esos van antes de llamar a actualizar).
export type PropsPaso = { torneo: Torneo; actualizar: (cambio: (t: Torneo) => Torneo) => void };

const PASOS_GRUPOS: { fase: Exclude<Torneo['fase'], 'terminado'>; titulo: string }[] = [
  { fase: 'parejas', titulo: 'Parejas' },
  { fase: 'grupos', titulo: 'Grupos' },
  { fase: 'faseGrupos', titulo: 'Fase de grupos' },
  { fase: 'llave', titulo: 'Llave' },
];
const PASOS_INDIVIDUAL: { fase: Exclude<Torneo['fase'], 'terminado'>; titulo: string }[] = [
  { fase: 'parejas', titulo: 'Jugadores' },
  { fase: 'llave', titulo: 'Llave' },
];

function Wizard({ torneo, actualizar }: PropsPaso) {
  const dialogos = useDialogos();
  const individual = (torneo.formato ?? 'grupos') === 'individual';
  const PASOS = individual ? PASOS_INDIVIDUAL : PASOS_GRUPOS;
  const faseVisible = torneo.fase === 'terminado' ? 'llave' : torneo.fase;
  const idxActual = PASOS.findIndex((p) => p.fase === faseVisible);

  async function volverA(fase: (typeof PASOS)[number]['fase']) {
    const idx = PASOS.findIndex((p) => p.fase === fase);
    if (idx >= idxActual) return;
    if (fase === 'parejas' && (torneo.partidosGrupo.length > 0 || torneo.partidosLlave !== null)) {
      const ok = await dialogos.confirmar({
        titulo: individual ? 'Volver a Jugadores' : 'Volver a Parejas',
        mensaje: individual
          ? 'Descarta la llave armada. ¿Seguir?'
          : 'Descarta los grupos, el fixture, los resultados y la llave. ¿Seguir?',
        textoConfirmar: 'Volver',
        peligro: true,
      });
      if (!ok) return;
      actualizar((t) => ({ ...t, grupos: [], partidosGrupo: [], configLlave: null, partidosLlave: null, fase: 'parejas' }));
      return;
    }
    if (
      fase === 'grupos' &&
      (torneo.partidosGrupo.some((p) => p.puntosA !== null || p.puntosB !== null) || torneo.partidosLlave !== null)
    ) {
      const ok = await dialogos.confirmar({ titulo: 'Volver a Grupos', mensaje: 'Borra los resultados de la fase de grupos y la llave. ¿Seguir?', textoConfirmar: 'Volver', peligro: true });
      if (!ok) return;
      actualizar((t) => ({ ...t, partidosGrupo: [], configLlave: null, partidosLlave: null, fase: 'grupos' }));
      return;
    }
    actualizar((t) => ({ ...t, fase }));
  }

  return (
    <>
      <nav className="pasos">
        {PASOS.map((p, i) =>
          i < idxActual ? (
            <button key={p.fase} className="paso hecho" onClick={() => volverA(p.fase)} aria-label={`Volver a ${p.titulo}`}>
              {i + 1} · {p.titulo}
            </button>
          ) : (
            <span key={p.fase} className={`paso ${i === idxActual ? 'activo' : ''}`}>
              {i + 1} · {p.titulo}
            </span>
          ),
        )}
      </nav>
      <section className="contenido">
        {faseVisible === 'parejas' && <PasoParejas torneo={torneo} actualizar={actualizar} />}
        {faseVisible === 'grupos' && <PasoGrupos torneo={torneo} actualizar={actualizar} />}
        {faseVisible === 'faseGrupos' && <PasoFaseGrupos torneo={torneo} actualizar={actualizar} />}
        {faseVisible === 'llave' && <PasoLlave torneo={torneo} actualizar={actualizar} />}
      </section>
    </>
  );
}
