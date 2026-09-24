import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, MapPin, Save } from 'lucide-react';
import type { Club } from '../types';
import { AreaTexto, Boton, Campo, Dialogo, Entrada, Interruptor, Segmentado } from './ui';
import { hayCambios, usuarioInstagram } from './formulario';
import { CLASE_FORMULARIO, GrupoFormulario, Rotulo, confirmarDescarte } from './PiezasFormulario';
import {
  esPuntoPorDefecto, fueraDeSudamerica, leerCoordenadas, leerNumeroCoordenada, linkMapa, type Coordenadas,
} from './coordenadas';

// ─── ClubModal ───────────────────────────────────────────────────────────────
// Rediseño 24/09. Lo importante: la ubicación. Antes latitud/longitud arrancaban en
// -34,9 / -56,2 y un club nuevo quedaba solo en el centro de Montevideo. Ahora arrancan
// vacías (obligatorias de verdad) y se completan pegando el link o el pin de Google Maps.

const PAISES: { valor: Club['country']; texto: string }[] = [
  { valor: 'Uruguay', texto: 'Uruguay' },
  { valor: 'Argentina', texto: 'Argentina' },
  { valor: 'Chile', texto: 'Chile' },
  { valor: 'Brasil', texto: 'Brasil' },
];

type Aviso = { tipo: 'ok' | 'error'; texto: string } | null;

/** Latitud/longitud tipeadas → número, o el error a mostrar en el campo. */
function validarCoordenada(texto: string, tope: 90 | 180): { valor: number | null; error: string | null } {
  if (!texto.trim()) return { valor: null, error: 'Falta. Pegá el link de Google Maps arriba.' };
  const n = leerNumeroCoordenada(texto);
  if (n === null) return { valor: null, error: 'Tiene que ser un número, ej. -34.9011' };
  if (Math.abs(n) > tope) return { valor: null, error: `Va de -${tope} a ${tope}.` };
  return { valor: n, error: null };
}

export function ClubModal({
  club, onClose, onSave
}: {
  club: Club | null;
  onClose: () => void;
  onSave: (c: Club) => void;
}) {
  const [inicial] = useState<Club>(() =>
    club || {
      id: `club-${Date.now()}`,
      name: '',
      address: '',
      city: '',
      country: 'Uruguay',
      lat: -34.9,
      lng: -56.2,
      phone: '',
      instagram: '',
      hasPickleball: true,
      description: '',
    }
  );
  const [form, setForm] = useState<Club>(inicial);
  // Las coordenadas se editan como texto (acepta coma decimal y el "-" del teclado común).
  // Un club nuevo arranca SIN punto: el -34,9/-56,2 de arriba nunca llega a guardarse solo.
  const [latTexto, setLatTexto] = useState(club ? String(club.lat) : '');
  const [lngTexto, setLngTexto] = useState(club ? String(club.lng) : '');
  const [pegado, setPegado] = useState('');
  const [aviso, setAviso] = useState<Aviso>(null);
  const [intentoGuardar, setIntentoGuardar] = useState(false);
  const idForm = useId();

  const cambiar = <K extends keyof Club>(campo: K, valor: Club[K]) => setForm((f) => ({ ...f, [campo]: valor }));

  const sucio =
    hayCambios(inicial, form) || latTexto !== (club ? String(club.lat) : '') || lngTexto !== (club ? String(club.lng) : '');

  const lat = validarCoordenada(latTexto, 90);
  const lng = validarCoordenada(lngTexto, 180);
  const punto: Coordenadas | null = lat.valor !== null && lng.valor !== null ? { lat: lat.valor, lng: lng.valor } : null;

  const usarPegado = (texto: string, avisarError: boolean) => {
    const r = leerCoordenadas(texto);
    if (r.ok) {
      setLatTexto(String(r.lat));
      setLngTexto(String(r.lng));
      setAviso({ tipo: 'ok', texto: `Listo: ${r.lat}, ${r.lng}` });
    } else {
      setAviso(avisarError && texto.trim() ? { tipo: 'error', texto: r.error } : null);
    }
  };

  const alPegar = (e: ChangeEvent<HTMLInputElement>) => {
    const texto = e.target.value;
    // Si entró de golpe (pegado), el error se muestra ya; tipeando, recién al salir.
    const deGolpe = texto.length - pegado.length > 3;
    setPegado(texto);
    usarPegado(texto, deGolpe);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setIntentoGuardar(true);
    if (!punto) return;
    onSave({ ...form, lat: punto.lat, lng: punto.lng });
  };

  const cancelar = () => { if (confirmarDescarte(sucio)) onClose(); };

  return (
    <Dialogo
      abierto
      titulo={club ? 'Editar club' : 'Nuevo club'}
      descripcion={club ? club.name : 'Aparece en el mapa y en la lista de Clubes.'}
      alCerrar={onClose}
      ancho="lg"
      sucio={sucio}
      pie={(
        <>
          <Boton variante="secundario" onClick={cancelar}>Cancelar</Boton>
          <Boton type="submit" form={idForm} icono={<Save size={17} />}>Guardar club</Boton>
        </>
      )}
    >
      <form id={idForm} onSubmit={handleSubmit} className={CLASE_FORMULARIO}>
        <GrupoFormulario titulo="Club">
          <Campo etiqueta="Nombre" requerido>
            <Entrada type="text" required autoComplete="off" placeholder="Ej. Club Biguá" value={form.name} onChange={e => cambiar('name', e.target.value)} />
          </Campo>
          <Campo etiqueta="Descripción">
            <AreaTexto rows={3} value={form.description} onChange={e => cambiar('description', e.target.value)} className="resize-y" />
          </Campo>
          <div className="rounded-xl border border-gray-200 px-4 py-1">
            <Interruptor
              etiqueta="Tiene canchas de pickleball"
              descripcion="Muestra la etiqueta “Pickleball” en la ficha del club."
              activo={form.hasPickleball}
              alCambiar={v => cambiar('hasPickleball', v)}
            />
          </div>
        </GrupoFormulario>

        <GrupoFormulario titulo="Ubicación">
          <Campo etiqueta="Dirección" requerido>
            <Entrada type="text" required autoComplete="off" placeholder="Ej. Av. Rivera 3500" value={form.address} onChange={e => cambiar('address', e.target.value)} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Campo etiqueta="Ciudad" requerido>
              <Entrada type="text" required autoComplete="off" placeholder="Ej. Montevideo" value={form.city} onChange={e => cambiar('city', e.target.value)} />
            </Campo>
            <div className="min-w-0">
              <Rotulo>País</Rotulo>
              <Segmentado etiqueta="País" opciones={PAISES} valor={form.country} alCambiar={v => cambiar('country', v)} anchoCompleto />
            </div>
          </div>

          {/* Punto en el mapa: lo que se ve en /clubes. */}
          <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-700 text-white" aria-hidden>
                <MapPin size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-navy-700">Punto en el mapa</p>
                <p className="text-[13px] text-gray-500">
                  En Google Maps mantené apretado el lugar y copiá los números de arriba, o pegá el link largo del navegador.
                </p>
              </div>
            </div>

            <Campo etiqueta="Pegá el link de Google Maps o las coordenadas">
              <Entrada
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Ej. -34.9011, -56.1645 o el link"
                value={pegado}
                onChange={alPegar}
                onBlur={() => usarPegado(pegado, true)}
                className="bg-white"
              />
            </Campo>
            {aviso && (
              <p
                role={aviso.tipo === 'error' ? 'alert' : 'status'}
                className={
                  aviso.tipo === 'ok'
                    ? '-mt-2 flex items-start gap-1.5 text-[13px] font-medium text-emerald-700'
                    : '-mt-2 flex items-start gap-1.5 text-[13px] font-medium text-red-700'
                }
              >
                {aviso.tipo === 'ok'
                  ? <CheckCircle2 size={15} className="mt-px shrink-0" aria-hidden />
                  : <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden />}
                {aviso.texto}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Latitud" requerido error={intentoGuardar ? lat.error : null}>
                <Entrada
                  type="text"
                  required
                  autoComplete="off"
                  placeholder="Ej. -34.9011"
                  value={latTexto}
                  onChange={e => { setLatTexto(e.target.value); setAviso(null); }}
                  className="bg-white tabular-nums"
                />
              </Campo>
              <Campo etiqueta="Longitud" requerido error={intentoGuardar ? lng.error : null}>
                <Entrada
                  type="text"
                  required
                  autoComplete="off"
                  placeholder="Ej. -56.1645"
                  value={lngTexto}
                  onChange={e => { setLngTexto(e.target.value); setAviso(null); }}
                  className="bg-white tabular-nums"
                />
              </Campo>
            </div>

            {punto && esPuntoPorDefecto(punto) && (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden />
                Es el punto por defecto (centro de Montevideo): seguro no es donde queda el club.
              </p>
            )}
            {punto && !esPuntoPorDefecto(punto) && fueraDeSudamerica(punto) && (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[13px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                <AlertTriangle size={15} className="mt-px shrink-0" aria-hidden />
                Ese punto queda fuera de Sudamérica. ¿Están latitud y longitud al revés?
              </p>
            )}
            {punto && (
              <a
                href={linkMapa(punto)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-lg px-1 text-sm font-bold text-navy-700 underline-offset-4 hover:underline"
              >
                Ver el punto en Google Maps <ExternalLink size={15} aria-hidden />
              </a>
            )}
          </div>
        </GrupoFormulario>

        <GrupoFormulario titulo="Contacto">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Teléfono">
              <Entrada type="tel" inputMode="tel" autoComplete="off" placeholder="099 123 456" value={form.phone || ''} onChange={e => cambiar('phone', e.target.value)} />
            </Campo>
            <Campo etiqueta="Instagram" ayuda="El usuario o el link del perfil.">
              <Entrada
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="usuario, sin @"
                value={form.instagram || ''}
                onChange={e => cambiar('instagram', usuarioInstagram(e.target.value))}
              />
            </Campo>
          </div>
        </GrupoFormulario>
      </form>
    </Dialogo>
  );
}
