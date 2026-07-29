import { useState } from 'react';
import type { PropsPaso } from '../TorneosApp';
import { nuevoId } from '../engine/tipos';
import { crearRng, mezclar } from '../engine/rng';
import { useDialogos } from './dialogos';

export default function PasoParejas({ torneo, actualizar }: PropsPaso) {
  const dialogos = useDialogos();
  const individual = (torneo.formato ?? 'grupos') === 'individual';
  const [nombre, setNombre] = useState('');
  const [modoSueltos, setModoSueltos] = useState(false);
  const [sueltos, setSueltos] = useState('');

  function agregarSueltos() {
    const nombres = sueltos.split('\n').map((s) => s.trim()).filter(Boolean);
    if (nombres.length === 0) return;
    actualizar((t) => ({
      ...t,
      parejas: [...t.parejas, ...nombres.map((n) => ({ id: nuevoId(), nombre: n }))],
    }));
    setSueltos('');
    setModoSueltos(false);
  }

  function agregar() {
    const limpio = nombre.trim();
    if (!limpio) return;
    actualizar((t) => ({ ...t, parejas: [...t.parejas, { id: nuevoId(), nombre: limpio }] }));
    setNombre('');
  }

  async function renombrar(id: string, actual: string) {
    const nuevo = await dialogos.pedirTexto({ titulo: 'Renombrar pareja', valorInicial: actual, placeholder: 'Nombre de la pareja', textoConfirmar: 'Guardar' });
    if (!nuevo) return;
    actualizar((t) => ({ ...t, parejas: t.parejas.map((p) => (p.id === id ? { ...p, nombre: nuevo } : p)) }));
  }

  function borrar(id: string) {
    // también se la saca de cualquier grupo por si Brian volvió atrás
    actualizar((t) => ({
      ...t,
      parejas: t.parejas.filter((p) => p.id !== id),
      grupos: t.grupos.map((g) => ({ ...g, parejaIds: g.parejaIds.filter((x) => x !== id) })),
    }));
  }

  // Empareja la lista pegada de a dos y agrega las parejas. Con orden=las líneas tal cual
  // (1º con 2º, 3º con 4º…); sin orden=mezcladas al azar.
  function armarParejasDesdeLista(enOrden: boolean) {
    const nombres = sueltos.split('\n').map((s) => s.trim()).filter(Boolean);
    if (nombres.length < 2) return;
    if (nombres.length % 2 === 1) {
      dialogos.avisar({ titulo: 'Cantidad impar', mensaje: `Son ${nombres.length} jugadores (impar): sacá o sumá uno para poder emparejar.` });
      return;
    }
    const lista = enOrden ? nombres : mezclar(nombres, crearRng(Math.floor(Math.random() * 2 ** 31)));
    actualizar((t) => {
      const nuevas = [...t.parejas];
      for (let i = 0; i < lista.length; i += 2) {
        nuevas.push({ id: nuevoId(), nombre: `${lista[i]} y ${lista[i + 1]}` });
      }
      return { ...t, parejas: nuevas };
    });
    setSueltos('');
    setModoSueltos(false);
  }

  return (
    <section>
      <div className="carta">
        <h2>{individual ? 'Jugadores' : 'Parejas'} ({torneo.parejas.length})</h2>
        <form className="acciones" onSubmit={(e) => { e.preventDefault(); agregar(); }}>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={individual ? 'Nombre del jugador' : 'Ej: "Juan y Pedro" o "Los Primos"'}
            style={{ flex: 1, minWidth: 220 }}
            autoFocus
          />
          <button className="boton" type="submit">Agregar</button>
        </form>
        {torneo.parejas.length === 0 && (
          <p className="vacio">
            {individual ? 'Escribí el primer jugador, o pegá la lista abajo.' : 'Escribí la primera pareja, o usá el sorteo de abajo.'}
          </p>
        )}
        <ul className="lista-torneos" style={{ marginTop: 12 }}>
          {torneo.parejas.map((p, i) => (
            <li key={p.id} className="carta" style={{ padding: '8px 14px' }}>
              <span style={{ flex: 1 }}>
                <span className="chip">{i + 1}</span> <strong>{p.nombre}</strong>
              </span>
              <div className="acciones">
                <button className="boton secundario" onClick={() => renombrar(p.id, p.nombre)}>Editar</button>
                <button className="boton peligro" onClick={() => borrar(p.id)}>Sacar</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="carta" style={{ marginTop: 16 }}>
        <button className="boton secundario" onClick={() => setModoSueltos((m) => !m)}>
          {individual
            ? (modoSueltos ? 'Ocultar pegar lista' : 'Pegar lista de jugadores')
            : (modoSueltos ? 'Ocultar armar parejas' : '¿Tenés jugadores sueltos? Armar parejas')}
        </button>
        {modoSueltos && (
          <div style={{ marginTop: 12 }}>
            <p>
              {individual
                ? 'Un jugador por línea. Se agregan todos a la lista.'
                : 'Un jugador por línea. "Emparejar en orden" arma 1º con 2º, 3º con 4º…; el sorteo los mezcla al azar.'}
            </p>
            <textarea
              rows={8}
              style={{ width: '100%' }}
              value={sueltos}
              onChange={(e) => setSueltos(e.target.value)}
              placeholder={'Ana\nBeto\nCarla\nDiego'}
            />
            {individual ? (
              <button className="boton" onClick={agregarSueltos} style={{ marginTop: 8 }}>Agregar jugadores</button>
            ) : (
              <div className="acciones" style={{ marginTop: 8 }}>
                <button className="boton" onClick={() => armarParejasDesdeLista(true)}>Emparejar en orden</button>
                <button className="boton secundario" onClick={() => armarParejasDesdeLista(false)}>🎲 Sortear al azar</button>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="pie-paso">
        <span />
        {individual ? (
          <button
            className="boton"
            disabled={torneo.parejas.length < 2}
            onClick={() => actualizar((t) => ({ ...t, fase: 'llave' }))}
          >
            {torneo.parejas.length < 2 ? 'Seguir (mínimo 2 jugadores)' : 'Seguir → Llave'}
          </button>
        ) : (
          <button
            className="boton"
            disabled={torneo.parejas.length < 3}
            onClick={() => actualizar((t) => ({ ...t, fase: 'grupos' }))}
          >
            {torneo.parejas.length < 3 ? 'Seguir (mínimo 3 parejas)' : 'Seguir → Grupos'}
          </button>
        )}
      </footer>
    </section>
  );
}
