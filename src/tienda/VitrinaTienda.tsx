import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from './store';
import { usePromo } from './promo';
import { elegirVitrina } from './vitrina';
import { formatPrice } from '../lib/formato';
import { errorFoto } from '../lib/fotos';
import { precioConPromo } from '../utils/promo';
import { srcsetImagen, urlImagen } from '../utils/imagenes';

// Vitrina de la tienda para las páginas de torneos, ranking y programación: son las más
// visitadas en días de torneo y no tenían ni un link a la tienda (auditoría 23/09). Usa
// los productos que ya cargó el StoreProvider (cero pedidos extra) y el mismo precio con
// promo que la tienda. Si todavía no llegaron o no hay nada comprable, no ocupa lugar.

type Props = { titulo?: string; bajada?: string };

export default function VitrinaTienda({
  titulo = 'Vestí VOLEA en la cancha',
  bajada = 'Remeras, polos y shorts técnicos de pickleball, diseñados en Uruguay.',
}: Props) {
  const { products, datosListos } = useStore();
  const { activa: promo } = usePromo();
  const elegidos = useMemo(() => elegirVitrina(products, 4), [products]);
  if (!datosListos || elegidos.length === 0) return null;

  return (
    <section aria-labelledby="vitrina-tienda" className="mt-10 rounded-2xl bg-navy-600 p-4 ring-1 ring-white/10 sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="vitrina-tienda" className="font-display text-xl text-white">{titulo}</h2>
          <p className="mt-1 text-sm text-white/70">{bajada}</p>
        </div>
        <Link
          to="/tienda"
          className="rounded-full bg-lime-400 px-4 py-2 font-display text-sm font-bold text-navy-700 hover:bg-lime-300"
        >
          Ver la tienda
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {elegidos.map((p) => {
          const foto = p.images[0];
          return (
            <li key={p.id} className="h-full">
              <Link
                to={`/producto/${p.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 transition hover:ring-lime-400"
              >
                <div className="aspect-square overflow-hidden bg-white">
                  <img
                    src={urlImagen(foto, 320)}
                    srcSet={srcsetImagen(foto, 640)}
                    sizes="(min-width: 640px) 220px, 45vw"
                    alt={p.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    onError={errorFoto(foto)}
                  />
                </div>
                <div className="flex flex-1 flex-col justify-between p-3">
                  <p className="line-clamp-2 text-sm font-semibold text-white">{p.name}</p>
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                    <span className="font-display font-bold text-lime-400">
                      {formatPrice(promo ? precioConPromo(p.price, promo.percent) : p.price)}
                    </span>
                    {promo && <span className="text-xs text-white/50 line-through">{formatPrice(p.price)}</span>}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
