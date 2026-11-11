import { useEffect, useMemo, useRef, useState } from 'react';
import type { PartidoLlave, SlotLlave, Torneo } from '../engine/tipos';
import { nombreDe } from '../ui/util';
import { armarModelo, describirLugar, proximoListo, type Cruce, type ModeloOpc, type Ronda } from '../ui/opc/modelo';

// Vista pública del One Point Challenge (/torneos/:id de un torneo individual), pensada para el
// público que mira desde el celular: arriba un resumen (en qué ronda va, cuántos cruces faltan,
// cuál es el próximo; o campeón y subcampeón al terminar), después una pestaña por ronda que abre
// en la ronda en juego, y el cuadro completo como alternativa deslizable. Cada cruce es a UN
// punto: no se muestran números, solo quién ganó. La lógica (rondas, nombres, quién pasa directo)
// sale de ui/opc/modelo.ts, la misma que usa la pantalla de control del organizador.

type Vista = 'ronda' | 'cuadro';
type Recuerdo = { vista?: Vista; ronda?: number };

// La pestaña elegida vive en el estado del componente (el refresco de la página solo cambia el
// torneo, no lo remonta) y además en sessionStorage, para que una recarga no la pierda.
const CLAVE = 'volea-opc-publico';
function leer(id: string): Recuerdo {
  try {
    const todo = JSON.parse(sessionStorage.getItem(CLAVE) || '{}') as Record<string, Recuerdo>;
    return todo[id] ?? {};
  } catch {
    return {};
  }
}
function guardar(id: string, r: Recuerdo) {
  try {
    const todo = JSON.parse(sessionStorage.getItem(CLAVE) || '{}') as Record<string, Recuerdo>;
    todo[id] = r;
    sessionStorage.setItem(CLAVE, JSON.stringify(todo));
  } catch { /* sin almacenamiento: queda en memoria */ }
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export default function OpcPublico({ torneo }: { torneo: Torneo }) {
  const partidos = torneo.partidosLlave as PartidoLlave[];
  const modelo = useMemo(() => armarModelo(partidos), [partidos]);
  const recuerdo = useMemo(() => leer(torneo.id), [torneo.id]);
  const [vista, setVista] = useState<Vista>(recuerdo.vista ?? 'ronda');
  // null = seguir la ronda en juego (se mueve sola con los refrescos hasta que el usuario elige una)
  const [elegida, setElegida] = useState<number | null>(recuerdo.ronda ?? null);
  useEffect(() => { guardar(torneo.id, { vista, ronda: elegida ?? undefined }); }, [torneo.id, vista, elegida]);

  const rondaVista = modelo.rondas.find((r) => r.ronda === elegida) ?? modelo.rondas.find((r) => r.ronda === modelo.rondaActual) ?? modelo.rondas[0];
  const proximo = proximoListo(modelo, null);

  if (!rondaVista) return null;
  return (
    <section className="opc-pub" aria-label="Llave del One Point Challenge">
      <Resumen torneo={torneo} modelo={modelo} proximo={proximo} />

      <div role="tablist" aria-label="Cómo ver la llave" className="opc-pub-vistas">
        {([['ronda', 'Por ronda'], ['cuadro', 'Cuadro completo']] as const).map(([v, texto]) => (
          <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}>{texto}</button>
        ))}
      </div>

      {vista === 'ronda' ? (
        <>
          <div role="tablist" aria-label="Rondas" className="opc-pub-rondas">
            {modelo.rondas.map((r) => {
              const completa = r.jugados === r.cruces.length;
              const enJuego = r.ronda === modelo.rondaActual && !completa;
              return (
                <button
                  key={r.ronda}
                  type="button"
                  role="tab"
                  aria-selected={r.ronda === rondaVista.ronda}
                  aria-label={`${r.nombre}: ${r.jugados} de ${r.cruces.length} cruces jugados`}
                  onClick={() => setElegida(r.ronda)}
                  className={enJuego ? 'en-juego' : undefined}
                >
                  <span className="opc-pub-ronda-nombre">{r.nombre}</span>
                  <span className="opc-pub-ronda-avance">{completa ? '✓ ' : ''}{r.jugados}/{r.cruces.length}</span>
                </button>
              );
            })}
          </div>
          <PanelRonda torneo={torneo} modelo={modelo} ronda={rondaVista} proximo={proximo} />
        </>
      ) : (
        <Cuadro torneo={torneo} modelo={modelo} proximo={proximo} />
      )}
    </section>
  );
}

// ─── Resumen de arriba ───────────────────────────────────────────────────────

function Resumen({ torneo, modelo, proximo }: { torneo: Torneo; modelo: ModeloOpc; proximo: Cruce | null }) {
  const nombre = (id: string) => nombreDe(torneo, id);
  if (modelo.campeon) {
    return (
      <div className="opc-pub-podio" aria-label="Podio">
        <div className="opc-pub-trofeo" aria-hidden>🏆</div>
        <p className="opc-pub-rotulo">Campeón</p>
        <h2 className="opc-pub-nombre" data-campeon>{nombre(modelo.campeon)}</h2>
        {modelo.subcampeon && (
          <p className="opc-pub-sub">
            <span aria-hidden>🥈</span> <span className="opc-pub-sub-rotulo">Subcampeón</span>{' '}
            <strong className="opc-pub-nombre" data-subcampeon>{nombre(modelo.subcampeon)}</strong>
          </p>
        )}
        <p className="opc-pub-detalle">{plural(torneo.parejas.length, 'jugador', 'jugadores')} · {plural(modelo.total, 'cruce', 'cruces')} a un punto</p>
      </div>
    );
  }
  const ronda = modelo.rondas.find((r) => r.ronda === modelo.rondaActual);
  const faltan = modelo.total - modelo.jugados;
  const pct = modelo.total ? Math.round((modelo.jugados / modelo.total) * 100) : 0;
  const sinEmpezar = modelo.jugados === 0;
  return (
    <div className="opc-pub-resumen" aria-live="polite">
      <p className="opc-pub-estado">
        {sinEmpezar
          ? <>Arranca la {ronda?.nombre ?? 'Ronda 1'}</>
          : <>{ronda?.nombre ?? `Ronda ${modelo.rondaActual}`} <span>· {faltan === 1 ? 'falta 1 cruce' : `faltan ${faltan} cruces`}</span></>}
      </p>
      <p className="opc-pub-detalle">
        {sinEmpezar
          ? `${plural(torneo.parejas.length, 'jugador', 'jugadores')} · ${plural(modelo.total, 'cruce', 'cruces')} a un punto`
          : `${modelo.jugados} de ${modelo.total} cruces jugados`}
      </p>
      <div className="opc-pub-barra" role="progressbar" aria-valuemin={0} aria-valuemax={modelo.total} aria-valuenow={modelo.jugados} aria-label="Cruces jugados">
        <span style={{ width: `${pct}%` }} />
      </div>
      {proximo && proximo.idA && proximo.idB && (
        <p className="opc-pub-proximo">
          <span className="opc-pub-rotulo">{sinEmpezar ? 'Primer cruce' : 'Próximo'}</span>
          <span className="opc-pub-nombre"><strong>{nombre(proximo.idA)}</strong> vs <strong>{nombre(proximo.idB)}</strong></span>
          <span className="opc-pub-donde">Cruce {proximo.numero} · {modelo.rondas.find((r) => r.ronda === proximo.ronda)?.nombre}</span>
        </p>
      )}
    </div>
  );
}

// ─── Una ronda ───────────────────────────────────────────────────────────────

/** De qué ronda viene un lugar que no sale de un cruce de la ronda anterior (el que pasó directo). */
function vieneDirecto(modelo: ModeloOpc, ronda: Ronda, slot: SlotLlave | null): Ronda | null {
  const anterior = modelo.rondas.find((r) => r.ronda === ronda.ronda - 1);
  if (!anterior?.pasaDirecto || !slot) return null;
  const s = anterior.pasaDirecto.slot;
  const igual = s.tipo === 'seed' ? slot.tipo === 'seed' && slot.parejaId === s.parejaId : slot.tipo !== 'seed' && slot.tipo === s.tipo && slot.partidoId === s.partidoId;
  return igual ? anterior : null;
}

function PanelRonda({ torneo, modelo, ronda, proximo }: { torneo: Torneo; modelo: ModeloOpc; ronda: Ronda; proximo: Cruce | null }) {
  return (
    <div className="opc-pub-panel" role="tabpanel" aria-label={ronda.nombre}>
      <div className="opc-pub-panel-titulo">
        <h3>{ronda.nombre}</h3>
        <span>{ronda.jugados}/{ronda.cruces.length} jugados · {ronda.vivos} jugadores</span>
      </div>
      <PasaDirecto torneo={torneo} modelo={modelo} ronda={ronda} />
      <ol className="opc-pub-cruces">
        {ronda.cruces.map((c) => (
          <li key={c.partido.id}><CajaCruce torneo={torneo} modelo={modelo} ronda={ronda} cruce={c} proximo={proximo?.partido.id === c.partido.id} /></li>
        ))}
      </ol>
    </div>
  );
}

function PasaDirecto({ torneo, modelo, ronda, compacto = false }: { torneo: Torneo; modelo: ModeloOpc; ronda: Ronda; compacto?: boolean }) {
  if (!ronda.pasaDirecto) return null;
  const sig = modelo.rondas.find((r) => r.ronda === ronda.ronda + 1);
  const quien = ronda.pasaDirecto.id ? nombreDe(torneo, ronda.pasaDirecto.id) : describirLugar(modelo, ronda.pasaDirecto.slot);
  return (
    <p className={`opc-pub-directo${compacto ? ' compacto' : ''}`} data-pasa-directo>
      <span aria-hidden className="opc-pub-flecha">»</span>
      <span>
        <strong className="opc-pub-nombre">{quien}</strong> pasa directo a la {sig ? sig.nombre.replace(/^Ronda/, 'ronda') : 'ronda siguiente'}
        {!compacto && <> (son impares: no juega la {ronda.nombre.replace(/^Ronda/, 'ronda')})</>}
      </span>
    </p>
  );
}

function CajaCruce({ torneo, modelo, ronda, cruce, proximo }: { torneo: Torneo; modelo: ModeloOpc; ronda: Ronda; cruce: Cruce; proximo: boolean }) {
  const estado = cruce.estado === 'jugado' ? 'Jugado' : proximo ? 'Próximo' : cruce.estado === 'listo' ? 'Por jugar' : 'Esperando';
  return (
    <div className={`opc-pub-cruce ${cruce.estado}${proximo ? ' proximo' : ''}`} data-cruce={cruce.numero}>
      <div className="opc-pub-cruce-cabeza">
        <span>Cruce {cruce.numero}</span>
        <span className="opc-pub-chip">{estado}</span>
      </div>
      {(['a', 'b'] as const).map((lado) => {
        const id = lado === 'a' ? cruce.idA : cruce.idB;
        const slot = lado === 'a' ? cruce.partido.a : cruce.partido.b;
        const gano = cruce.estado === 'jugado' && id !== null && cruce.ganador === id;
        const perdio = cruce.estado === 'jugado' && id !== null && cruce.ganador !== id;
        const directo = vieneDirecto(modelo, ronda, slot);
        return (
          <div key={lado} className={`opc-pub-lado${gano ? ' gano' : ''}${perdio ? ' perdio' : ''}${id ? '' : ' a-definir'}`} data-gano={gano || undefined}>
            <span className="opc-pub-lado-texto">
              <span className="opc-pub-nombre">{id ? nombreDe(torneo, id) : describirLugar(modelo, slot)}</span>
              {directo && <span className="opc-pub-viene">pasó directo de la {directo.nombre.replace(/^Ronda/, 'ronda')}</span>}
            </span>
            {gano && <span className="opc-pub-gano"><span aria-hidden>✓</span> Ganó</span>}
          </div>
        );
      })}
    </div>
  );
}

// ─── Cuadro completo (deslizable) ────────────────────────────────────────────

function Cuadro({ torneo, modelo, proximo }: { torneo: Torneo; modelo: ModeloOpc; proximo: Cruce | null }) {
  const carril = useRef<HTMLDivElement>(null);
  const [alFinal, setAlFinal] = useState(false);
  const [alInicio, setAlInicio] = useState(true);
  function medir() {
    const el = carril.current;
    if (!el) return;
    setAlInicio(el.scrollLeft < 8);
    setAlFinal(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
  }
  useEffect(() => {
    // Al abrir: la ronda en juego a la vista.
    const el = carril.current;
    const col = el?.querySelector<HTMLElement>(`[data-ronda="${modelo.rondaActual}"]`);
    if (el && col) el.scrollLeft = Math.max(0, col.offsetLeft - el.offsetLeft - 24);
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
    // solo al abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const columnas = modelo.rondas.length + (modelo.campeon ? 1 : 0);
  return (
    <div className="opc-pub-cuadro">
      <p className="opc-pub-pista" aria-hidden={alFinal && alInicio}>
        {alFinal && alInicio ? `${modelo.rondas.length} rondas` : <>Deslizá de costado para ver las {modelo.rondas.length} rondas <span className="opc-pub-flecha">→</span></>}
      </p>
      <div className={`opc-pub-marco${alFinal ? '' : ' hay-mas'}${alInicio ? '' : ' hay-antes'}`}>
        <div ref={carril} className="opc-pub-carril" onScroll={medir} tabIndex={0} aria-label={`Cuadro completo: ${columnas} columnas, deslizá de costado`}>
          {modelo.rondas.map((r) => (
            <div key={r.ronda} data-ronda={r.ronda} className={`opc-pub-columna${r.ronda === modelo.rondaActual && !modelo.campeon ? ' actual' : ''}`}>
              <div className="opc-pub-columna-titulo">
                <h3>{r.nombre}</h3>
                <span>{r.jugados}/{r.cruces.length}</span>
              </div>
              {r.cruces.map((c) => <CajaCruce key={c.partido.id} torneo={torneo} modelo={modelo} ronda={r} cruce={c} proximo={proximo?.partido.id === c.partido.id} />)}
              <PasaDirecto torneo={torneo} modelo={modelo} ronda={r} compacto />
            </div>
          ))}
          {modelo.campeon && (
            <div className="opc-pub-columna opc-pub-columna-campeon">
              <div className="opc-pub-trofeo" aria-hidden>🏆</div>
              <p className="opc-pub-rotulo">Campeón</p>
              <p className="opc-pub-nombre opc-pub-campeon-nombre">{nombreDe(torneo, modelo.campeon)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
