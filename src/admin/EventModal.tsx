import { useId, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, Loader2, Save, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { Event } from '../types';
import { cn } from '../lib/cn';
import { AreaTexto, Boton, Campo, Dialogo, Entrada, Insignia, Interruptor, Segmentado } from './ui';
import { hayCambios } from './formulario';
import { CLASE_FORMULARIO, GrupoFormulario, Rotulo, confirmarDescarte } from './PiezasFormulario';

// ─── EventModal ──────────────────────────────────────────────────────────────
// Rediseño 24/09: Dialogo del kit (pantalla completa en el celular, pie fijo con Guardar
// a mano aunque el teclado esté abierto), campos agrupados, nada de 3 columnas a 390px,
// tipo y estado como selector segmentado, y el flyer con vista previa y botón de verdad.

const TIPOS: { valor: Event['category']; texto: string }[] = [
  { valor: 'tournament', texto: 'Torneo' },
  { valor: 'clinic', texto: 'Clínica' },
  { valor: 'social', texto: 'Social' },
];

const ESTADOS: { valor: Event['status']; texto: string }[] = [
  { valor: 'upcoming', texto: 'Próximo' },
  { valor: 'past', texto: 'Pasado' },
];

// iOS centra el texto de los inputs de fecha/hora: alineado a la izquierda como el resto.
const FECHA_IZQ = '[&::-webkit-date-and-time-value]:text-left';

export function EventModal({
  event, uploadImage, onClose, onSave
}: {
  event: Event | null;
  uploadImage: (f: File) => Promise<string | null>;
  onClose: () => void;
  onSave: (e: Event) => void;
}) {
  const [inicial] = useState<Event>(() =>
    event || {
      id: `evt-${Date.now()}`,
      name: '',
      date: '',
      time: '',
      location: '',
      city: '',
      description: '',
      imageUrl: '',
      mapsUrl: '',
      maxParticipants: undefined,
      status: 'upcoming',
      category: 'tournament',
      phone: '',
      inscripcionesAbiertas: false,
      categorias: '',
    }
  );
  const [form, setForm] = useState<Event>(inicial);
  const [subiendo, setSubiendo] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);
  const idForm = useId();
  const sucio = hayCambios(inicial, form);

  const cambiar = <K extends keyof Event>(campo: K, valor: Event[K]) => setForm((f) => ({ ...f, [campo]: valor }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Guardar a mitad de la subida dejaba el evento sin el flyer nuevo.
    if (subiendo) return;
    onSave(form);
  };

  const cancelar = () => { if (confirmarDescarte(sucio)) onClose(); };

  // Subir el flyer desde el celular: antes solo se podía pegar una URL, que en la
  // práctica significaba no poder poner la imagen.
  const handleArchivo = async (file: File | undefined) => {
    if (!file || subiendo) return;
    setSubiendo(true);
    try {
      const url = await uploadImage(file);
      if (!url) {
        toast.error('No se pudo subir la imagen. Verificá tu sesión de admin.');
        return;
      }
      setForm(f => ({ ...f, imageUrl: url }));
      toast.success('Imagen subida ✓');
    } catch (err) {
      console.error('Error subiendo imagen del evento:', err);
      toast.error('No se pudo subir la imagen. Probá de nuevo.');
    } finally {
      setSubiendo(false);
    }
  };

  // Mismo corte que el formulario público de inscripción (App.tsx).
  const categorias = (form.categorias || '').split(',').map(c => c.trim()).filter(Boolean);

  return (
    <Dialogo
      abierto
      titulo={event ? 'Editar evento' : 'Nuevo evento'}
      descripcion={event ? event.name : 'Se publica en Eventos y, si es el próximo torneo, en la home.'}
      alCerrar={onClose}
      ancho="lg"
      sucio={sucio}
      pie={(
        <>
          <Boton variante="secundario" onClick={cancelar}>Cancelar</Boton>
          <Boton type="submit" form={idForm} icono={<Save size={17} />} disabled={subiendo}>
            {subiendo ? 'Esperando la imagen…' : 'Guardar evento'}
          </Boton>
        </>
      )}
    >
      <form
        id={idForm}
        onSubmit={handleSubmit}
        className={CLASE_FORMULARIO}
      >
        <GrupoFormulario titulo="Evento">
          <Campo etiqueta="Nombre" requerido>
            <Entrada
              type="text"
              required
              autoComplete="off"
              placeholder="Ej. Copa VOLEA Primavera"
              value={form.name}
              onChange={e => cambiar('name', e.target.value)}
            />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <Rotulo>Tipo</Rotulo>
              <Segmentado etiqueta="Tipo de evento" opciones={TIPOS} valor={form.category} alCambiar={v => cambiar('category', v)} anchoCompleto />
            </div>
            <div className="min-w-0">
              <Rotulo>Estado</Rotulo>
              <Segmentado etiqueta="Estado del evento" opciones={ESTADOS} valor={form.status} alCambiar={v => cambiar('status', v)} anchoCompleto />
            </div>
          </div>
          <Campo etiqueta="Descripción">
            <AreaTexto
              rows={3}
              value={form.description}
              onChange={e => cambiar('description', e.target.value)}
              className="resize-y"
            />
          </Campo>
        </GrupoFormulario>

        <GrupoFormulario titulo="Cuándo y dónde">
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3">
            <Campo etiqueta="Fecha" requerido>
              <Entrada type="date" required value={form.date} onChange={e => cambiar('date', e.target.value)} className={FECHA_IZQ} />
            </Campo>
            <Campo etiqueta="Último día" ayuda="Solo si dura varios días.">
              <Entrada
                type="date"
                min={form.date || undefined}
                value={form.endDate || ''}
                onChange={e => cambiar('endDate', e.target.value)}
                className={FECHA_IZQ}
              />
            </Campo>
            <Campo etiqueta="Hora">
              <Entrada type="time" value={form.time} onChange={e => cambiar('time', e.target.value)} className={FECHA_IZQ} />
            </Campo>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Lugar" requerido>
              <Entrada type="text" required placeholder="Ej. Club Biguá" value={form.location} onChange={e => cambiar('location', e.target.value)} />
            </Campo>
            <Campo etiqueta="Ciudad" requerido>
              <Entrada type="text" required placeholder="Ej. Montevideo" value={form.city} onChange={e => cambiar('city', e.target.value)} />
            </Campo>
          </div>
          <Campo etiqueta="Link de Google Maps" ayuda="Sirve el link de “Compartir” de Google Maps. Arma el botón “Ver en mapa”.">
            <Entrada
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder="https://maps.app.goo.gl/…"
              value={form.mapsUrl}
              onChange={e => cambiar('mapsUrl', e.target.value)}
            />
          </Campo>
        </GrupoFormulario>

        <GrupoFormulario titulo="Flyer">
          <div className="flex gap-4">
            {/* Sin flyer: la caja misma es el botón de subir (blanco fácil con el dedo). */}
            <button
              type="button"
              onClick={() => archivo.current?.click()}
              disabled={subiendo}
              aria-label={form.imageUrl ? 'Cambiar el flyer' : 'Subir el flyer'}
              className={cn(
                'relative flex h-36 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border transition-colors sm:h-44 sm:w-36',
                form.imageUrl
                  ? 'border-gray-200 bg-navy-900'
                  : 'border-dashed border-gray-300 bg-gray-50 text-gray-400 hover:border-navy-700 hover:text-navy-700',
              )}
            >
              {form.imageUrl ? (
                <img src={form.imageUrl} alt="Vista previa del flyer" className="h-full w-full object-contain" />
              ) : (
                <ImagePlus size={28} aria-hidden />
              )}
              {subiendo && (
                <span className="absolute inset-0 flex items-center justify-center bg-navy-900/70" role="status" aria-label="Subiendo imagen">
                  <Loader2 size={24} className="animate-spin text-white" />
                </span>
              )}
            </button>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
              <div>
                <p className="text-sm font-semibold text-navy-700">
                  {subiendo ? 'Subiendo la imagen…' : form.imageUrl ? 'Flyer cargado' : 'Sin flyer'}
                </p>
                <p className="mt-0.5 text-[13px] text-gray-500">Se ve entero, sin recortes. Vertical o cuadrado queda mejor.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Boton
                  variante="secundario"
                  icono={<Upload size={17} />}
                  cargando={subiendo}
                  onClick={() => archivo.current?.click()}
                >
                  {form.imageUrl ? 'Cambiar' : 'Subir imagen'}
                </Boton>
                {form.imageUrl && !subiendo && (
                  <Boton variante="fantasma" icono={<Trash2 size={17} />} onClick={() => cambiar('imageUrl', '')}>
                    Quitar
                  </Boton>
                )}
              </div>
              <input
                ref={archivo}
                type="file"
                accept="image/*"
                className="hidden"
                tabIndex={-1}
                disabled={subiendo}
                onChange={e => { void handleArchivo(e.target.files?.[0]); e.target.value = ''; }}
              />
            </div>
          </div>
          <Campo etiqueta="…o pegá el link de una imagen">
            <Entrada
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder="https://…"
              value={form.imageUrl}
              onChange={e => cambiar('imageUrl', e.target.value)}
            />
          </Campo>
        </GrupoFormulario>

        <GrupoFormulario titulo="Inscripciones">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Teléfono de inscripciones" ayuda="Arma el botón de WhatsApp en la home.">
              <Entrada
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="092 103 276"
                value={form.phone || ''}
                onChange={e => cambiar('phone', e.target.value)}
              />
            </Campo>
            <Campo etiqueta="Máx. participantes" ayuda="Se muestra en la ficha. Vacío = sin tope.">
              <Entrada
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={form.maxParticipants ?? ''}
                onChange={e => {
                  const digitos = e.target.value.replace(/\D/g, '');
                  cambiar('maxParticipants', digitos ? Number(digitos) : undefined);
                }}
                className="tabular-nums"
              />
            </Campo>
          </div>
          <div className="rounded-xl border border-gray-200 px-4 py-2">
            <Interruptor
              etiqueta="Inscripción online abierta"
              descripcion="Muestra el formulario de inscripción en la web."
              activo={form.inscripcionesAbiertas === true}
              alCambiar={v => cambiar('inscripcionesAbiertas', v)}
            />
            {form.inscripcionesAbiertas && (
              <div className="space-y-3 border-t border-gray-100 pb-2 pt-4">
                <Campo
                  etiqueta="Categorías"
                  ayuda="Separadas por coma. Se muestran como botones en el formulario; vacío = campo de texto libre."
                >
                  <AreaTexto
                    rows={3}
                    placeholder="Singles A, Singles B, Doble Mixto A…"
                    value={form.categorias || ''}
                    onChange={e => cambiar('categorias', e.target.value)}
                    className="resize-y"
                  />
                </Campo>
                {categorias.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-400">
                      {categorias.length} {categorias.length === 1 ? 'categoría' : 'categorías'}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {categorias.map((c, i) => <Insignia key={`${c}-${i}`} tono="navy">{c}</Insignia>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </GrupoFormulario>
      </form>
    </Dialogo>
  );
}
