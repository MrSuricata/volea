import { useState } from 'react';
import { ArrowRight, ChevronDown, ClipboardPaste, Pencil, Plus, Shuffle, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import type { PropsPaso } from '../TorneosApp';
import { nuevoId } from '../engine/tipos';
import type { Pareja, Torneo } from '../engine/tipos';
import { crearRng, mezclar } from '../engine/rng';
import { useDialogos } from './dialogos';
import { AreaTexto, Boton, BotonIcono, Entrada, Tarjeta } from '../../admin/ui';
import { cn } from '../../lib/cn';
import { PiePaso } from './piezas';

// Deshacer "Sacar": vuelve a poner la pareja donde estaba (mismo lugar en la lista y en
// su grupo, si Brian había vuelto atrás desde Grupos). Puro, como pide el contrato.
function restaurarPareja(t: Torneo, pareja: Pareja, indice: number, grupo: { id: string; indice: number } | null): Torneo {
  if (t.parejas.some((p) => p.id === pareja.id)) return t; // ya volvió (doble toque en Deshacer)
  const parejas = [...t.parejas];
  parejas.splice(Math.min(indice, parejas.length), 0, pareja);
  const grupos = grupo
    ? t.grupos.map((g) => {
        if (g.id !== grupo.id || g.parejaIds.includes(pareja.id)) return g;
        const ids = [...g.parejaIds];
        ids.splice(Math.min(grupo.indice, ids.length), 0, pareja.id);
        return { ...g, parejaIds: ids };
      })
    : t.grupos;
  return { ...t, parejas, grupos };
}

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
    const nuevo = await dialogos.pedirTexto({ titulo: individual ? 'Renombrar jugador' : 'Renombrar pareja', valorInicial: actual, placeholder: individual ? 'Nombre del jugador' : 'Nombre de la pareja', textoConfirmar: 'Guardar' });
    if (!nuevo) return;
    actualizar((t) => ({ ...t, parejas: t.parejas.map((p) => (p.id === id ? { ...p, nombre: nuevo } : p)) }));
  }

  function borrar(id: string) {
    // Foto de dónde estaba, para poder deshacer (el toque en "Sacar" es fácil de errar en el celular).
    const indice = torneo.parejas.findIndex((p) => p.id === id);
    const pareja = torneo.parejas[indice];
    const g = torneo.grupos.find((x) => x.parejaIds.includes(id));
    const grupo = g ? { id: g.id, indice: g.parejaIds.indexOf(id) } : null;
    // también se la saca de cualquier grupo por si Brian volvió atrás
    actualizar((t) => ({
      ...t,
      parejas: t.parejas.filter((p) => p.id !== id),
      grupos: t.grupos.map((g) => ({ ...g, parejaIds: g.parejaIds.filter((x) => x !== id) })),
    }));
    if (pareja) {
      toast(`Sacaste a ${pareja.nombre}`, {
        duration: 8000,
        action: { label: 'Deshacer', onClick: () => actualizar((t) => restaurarPareja(t, pareja, indice, grupo)) },
      });
    }
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

  const unidad = individual ? 'jugador' : 'pareja';
  const minimo = individual ? 2 : 3;
  const lineasPegadas = sueltos.split('\n').map((s) => s.trim()).filter(Boolean).length;

  return (
    <section className="space-y-4">
      <Tarjeta titulo={`${individual ? 'Jugadores' : 'Parejas'} (${torneo.parejas.length})`}>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); agregar(); }}>
          <Entrada
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder={individual ? 'Nombre del jugador' : 'Ej: "Juan y Pedro" o "Los Primos"'}
            aria-label={individual ? 'Nombre del jugador nuevo' : 'Nombre de la pareja nueva'}
            autoComplete="off"
            className="min-w-0 flex-1"
            autoFocus
          />
          <Boton type="submit" icono={<Plus size={18} />} disabled={!nombre.trim()}>Agregar</Boton>
        </form>
        {torneo.parejas.length === 0 ? (
          <p className="mt-4 text-center text-sm text-gray-500">
            {individual ? 'Escribí el primer jugador, o pegá la lista abajo.' : 'Escribí la primera pareja, o armalas desde una lista abajo.'}
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {torneo.parejas.map((p, i) => (
              <li key={p.id} className="flex min-h-[52px] items-center gap-2 py-1 pl-3 pr-1">
                <span className="w-6 shrink-0 text-right text-[13px] font-semibold tabular-nums text-gray-500">{i + 1}</span>
                <span className="min-w-0 flex-1 break-words text-[15px] font-semibold text-navy-700">{p.nombre}</span>
                <BotonIcono etiqueta={`Renombrar ${p.nombre}`} icono={<Pencil size={18} />} onClick={() => renombrar(p.id, p.nombre)} />
                <BotonIcono etiqueta={`Sacar ${p.nombre}`} icono={<UserMinus size={18} />} tono="peligro" onClick={() => borrar(p.id)} />
              </li>
            ))}
          </ol>
        )}
      </Tarjeta>

      <section className="rounded-xl border border-gray-200 bg-white">
        <button
          type="button"
          onClick={() => setModoSueltos((m) => !m)}
          aria-expanded={modoSueltos}
          className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left"
        >
          <ClipboardPaste size={18} className="shrink-0 text-navy-700" aria-hidden />
          <span className="min-w-0 flex-1 font-display text-sm font-bold text-navy-700">
            {individual ? 'Pegar lista de jugadores' : '¿Tenés jugadores sueltos? Armar parejas'}
          </span>
          <ChevronDown size={18} aria-hidden className={cn('shrink-0 text-gray-500 transition-transform', modoSueltos && 'rotate-180')} />
        </button>
        {modoSueltos && (
          <div className="space-y-3 border-t border-gray-100 px-4 py-4">
            <p className="text-sm text-gray-600">
              {individual
                ? 'Un jugador por línea. Se agregan todos a la lista.'
                : 'Un jugador por línea. "Emparejar en orden" arma 1º con 2º, 3º con 4º…; el sorteo los mezcla al azar.'}
            </p>
            <AreaTexto
              rows={8}
              value={sueltos}
              onChange={(e) => setSueltos(e.target.value)}
              placeholder={'Ana\nBeto\nCarla\nDiego'}
              aria-label="Lista de jugadores, uno por línea"
            />
            {lineasPegadas > 0 && <p className="text-[13px] text-gray-500">{lineasPegadas} {lineasPegadas === 1 ? 'jugador' : 'jugadores'} en la lista</p>}
            {individual ? (
              <Boton icono={<Plus size={18} />} onClick={agregarSueltos} disabled={lineasPegadas === 0}>Agregar jugadores</Boton>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Boton onClick={() => armarParejasDesdeLista(true)} disabled={lineasPegadas < 2}>Emparejar en orden</Boton>
                <Boton variante="secundario" icono={<Shuffle size={18} />} onClick={() => armarParejasDesdeLista(false)} disabled={lineasPegadas < 2}>
                  Sortear al azar
                </Boton>
              </div>
            )}
          </div>
        )}
      </section>

      <PiePaso
        derecha={individual ? (
          <Boton
            disabled={torneo.parejas.length < 2}
            onClick={() => actualizar((t) => ({ ...t, fase: 'llave' }))}
            icono={torneo.parejas.length < 2 ? undefined : <ArrowRight size={18} />}
            className="flex-row-reverse"
          >
            {torneo.parejas.length < 2 ? `Seguir (mínimo ${minimo} ${unidad}es)` : 'Seguir: Llave'}
          </Boton>
        ) : (
          <Boton
            disabled={torneo.parejas.length < 3}
            onClick={() => actualizar((t) => ({ ...t, fase: 'grupos' }))}
            icono={torneo.parejas.length < 3 ? undefined : <ArrowRight size={18} />}
            className="flex-row-reverse"
          >
            {torneo.parejas.length < 3 ? `Seguir (mínimo ${minimo} ${unidad}s)` : 'Seguir: Grupos'}
          </Boton>
        )}
      />
    </section>
  );
}
