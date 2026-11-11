// "Datos del evento" en En vivo (modo carga): qué evento muestran /programacion y la TV
// (título, días, canchas, qué cuadros entran y el aviso sin cuadros), sin tocar código.
// Guarda en rk_programa.config.evento (lo lee construirPrograma).
import { useState, type CSSProperties } from 'react';
import { aHora, aMinuto, COLORES_POR_DEFECTO } from './programa';
import type { ConfigEvento, ModoTorneos, Programa } from './programa';

const caja: CSSProperties = { border: '1px solid var(--borde)', borderRadius: 14, background: 'var(--navy-1)', padding: '12px 14px', marginBottom: 14 };
const etiqueta: CSSProperties = { fontSize: '0.78rem', opacity: 0.7, fontWeight: 700 };
const fila: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };

type BorradorDia = { fecha: string; nombre: string; inicio: string };

export default function PanelEvento({ evento, programa, onGuardar }: {
  evento: ConfigEvento | undefined;
  /** El programa que se está mostrando ahora (para precargar lo que vale por defecto). */
  programa: Programa;
  onGuardar: (evento: ConfigEvento) => Promise<string | null>;
}) {
  const [titulo, setTitulo] = useState(evento?.titulo ?? '');
  const [dias, setDias] = useState<BorradorDia[]>(
    () => (evento?.dias?.length ? programa.dias : []).map((d) => ({ fecha: d.fecha, nombre: d.nombre, inicio: aHora(d.inicio) })),
  );
  const [canchas, setCanchas] = useState(String(evento?.canchas ?? programa.canchas.length));
  const [modo, setModo] = useState<ModoTorneos>(evento?.torneos?.modo ?? 'recientes');
  const [valor, setValor] = useState(evento?.torneos?.valor ?? '');
  const [aviso, setAviso] = useState(evento?.avisoSinCuadros ?? '');
  const [colores, setColores] = useState<string[]>(evento?.colores?.length === 3 ? evento.colores : [...COLORES_POR_DEFECTO]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const cambiarDia = (i: number, c: Partial<BorradorDia>) => setDias((l) => l.map((d, j) => (j === i ? { ...d, ...c } : d)));

  async function guardar() {
    const diasOk: NonNullable<ConfigEvento['dias']> = [];
    for (const d of dias) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) { setMensaje('Cada día necesita su fecha.'); return; }
      const inicio = aMinuto(d.inicio);
      if (inicio === null) { setMensaje('Cada día necesita su hora de inicio.'); return; }
      diasOk.push({ fecha: d.fecha, ...(d.nombre.trim() ? { nombre: d.nombre.trim() } : {}), inicio });
    }
    const n = Math.trunc(Number(canchas));
    if (!Number.isInteger(n) || n < 1 || n > 12) { setMensaje('Las canchas van de 1 a 12.'); return; }
    if ((modo === 'evento' || modo === 'texto') && !valor.trim()) { setMensaje('Escribí el texto con el que se buscan los cuadros.'); return; }
    const nuevo: ConfigEvento = {
      ...(titulo.trim() ? { titulo: titulo.trim() } : {}),
      colores,
      dias: diasOk,
      canchas: n,
      torneos: { modo, ...(modo === 'evento' || modo === 'texto' ? { valor: valor.trim() } : {}) },
      ...(aviso.trim() ? { avisoSinCuadros: aviso.trim() } : {}),
    };
    setMensaje('Guardando…');
    const problema = await onGuardar(nuevo);
    setMensaje(problema ?? 'Guardado: la pantalla y la TV lo toman solas. Las canchas deben existir en el tablero «En cancha».');
  }

  return (
    <details style={caja}>
      <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Datos del evento</summary>
      <div style={{ display: 'grid', gap: 16, marginTop: 14 }}>
        <div style={fila}>
          <label style={{ display: 'grid', gap: 4, flex: '1 1 16rem' }}>
            <span style={etiqueta}>Título (vacío = «{programa.titulo}»)</span>
            <input type="text" value={titulo} maxLength={60} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej: SUDAMERICANO DE PICKLEBALL" />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={etiqueta}>Canchas</span>
            <input type="number" inputMode="numeric" min={1} max={12} value={canchas} onChange={(e) => setCanchas(e.target.value)} style={{ width: 80 }} />
          </label>
          {colores.map((c, i) => (
            <label key={i} style={{ display: 'grid', gap: 4 }}>
              <span style={etiqueta}>Color {i + 1}</span>
              <input type="color" value={c} onChange={(e) => setColores(colores.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Color ${i + 1}`} />
            </label>
          ))}
        </div>

        <div>
          <div style={{ ...etiqueta, textTransform: 'uppercase', marginBottom: 8 }}>Días (vacío = solo hoy)</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {dias.map((d, i) => (
              <div key={i} style={fila}>
                <input type="date" value={d.fecha} onChange={(e) => cambiarDia(i, { fecha: e.target.value })} aria-label="Fecha del día" />
                <input type="text" value={d.nombre} onChange={(e) => cambiarDia(i, { nombre: e.target.value })} placeholder="Nombre (ej: Sábado 21)" aria-label="Nombre del día" style={{ width: 170 }} />
                <label style={{ ...fila, fontSize: '0.8rem', opacity: 0.85 }}>
                  arranca <input type="time" value={d.inicio} onChange={(e) => cambiarDia(i, { inicio: e.target.value })} aria-label="Hora de inicio" />
                </label>
                <button className="boton secundario" onClick={() => setDias(dias.filter((_, j) => j !== i))}>Quitar</button>
              </div>
            ))}
          </div>
          <button className="boton secundario" style={{ marginTop: 8 }}
            onClick={() => setDias([...dias, { fecha: '', nombre: '', inicio: '10:00' }])}>Agregar día</button>
        </div>

        <div style={fila}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={etiqueta}>Qué cuadros entran</span>
            <select value={modo} onChange={(e) => setModo(e.target.value as ModoTorneos)}>
              <option value="recientes">Los tocados en los últimos 3 días</option>
              <option value="evento">Los de una etiqueta de evento</option>
              <option value="texto">Los que digan cierto texto</option>
              <option value="todos">Todos los publicados</option>
            </select>
          </label>
          {(modo === 'evento' || modo === 'texto') && (
            <label style={{ display: 'grid', gap: 4, flex: '1 1 14rem' }}>
              <span style={etiqueta}>{modo === 'evento' ? 'Etiqueta de evento contiene' : 'Nombre o evento contiene'}</span>
              <input type="text" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ej: sudamericano" />
            </label>
          )}
        </div>

        <label style={{ display: 'grid', gap: 4 }}>
          <span style={etiqueta}>Aviso mientras no hay cuadros</span>
          <input type="text" value={aviso} maxLength={240} onChange={(e) => setAviso(e.target.value)} placeholder={programa.avisoSinCuadros} />
        </label>

        <div style={fila}>
          <button className="boton" onClick={() => void guardar()}>Guardar datos del evento</button>
          {mensaje && <span role="status" style={{ fontSize: '0.88rem' }}>{mensaje}</span>}
        </div>
      </div>
    </details>
  );
}
