import { useId, useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import type { Announcement } from '../types';
import { cn } from '../lib/cn';
import { AreaTexto, Boton, Campo, Dialogo, Entrada, Interruptor, type TonoInsignia } from './ui';
import { hayCambios } from './formulario';
import { CLASE_FORMULARIO, GrupoFormulario, Rotulo, confirmarDescarte } from './PiezasFormulario';

// ─── AnnouncementModal ───────────────────────────────────────────────────────
// Rediseño 24/09: Dialogo del kit, tipo como opciones legibles (antes un select; en la
// lista el "Promoción" era lima-700 sobre lima-100, casi invisible) y una vista previa
// de la franja de anuncios de la home tal como se ve (fondo azul marino).

type Tipo = Announcement['type'];

export const TIPOS_ANUNCIO: { valor: Tipo; texto: string }[] = [
  { valor: 'info', texto: 'Información' },
  { valor: 'promo', texto: 'Promoción' },
  { valor: 'event', texto: 'Evento' },
  { valor: 'important', texto: 'Importante' },
];

/** Tono de Insignia para listar anuncios en el panel (legible sobre blanco). */
export const TONO_TIPO_ANUNCIO: Record<Tipo, TonoInsignia> = {
  info: 'info',
  promo: 'bien',
  event: 'navy',
  important: 'alerta',
};

// Copia literal de los colores del ticker público (App.tsx, announcementColors): si
// cambian allá, cambiarlos acá para que la vista previa no mienta.
const COLOR_TICKER: Record<Tipo, string> = {
  info: 'bg-navy-500',
  promo: 'bg-lime-600',
  event: 'bg-navy-700 border border-lime-400/40',
  important: 'bg-red-500',
};

export function AnnouncementModal({
  announcement, onClose, onSave
}: {
  announcement: Announcement | null;
  onClose: () => void;
  onSave: (a: Announcement) => void;
}) {
  const [inicial] = useState<Announcement>(() =>
    announcement || {
      id: `ann-${Date.now()}`,
      title: '',
      content: '',
      type: 'info',
      active: true,
      createdAt: new Date().toISOString().split('T')[0],
    }
  );
  const [form, setForm] = useState<Announcement>(inicial);
  const idForm = useId();
  const idTipo = useId();
  const sucio = hayCambios(inicial, form);

  const cambiar = <K extends keyof Announcement>(campo: K, valor: Announcement[K]) => setForm((f) => ({ ...f, [campo]: valor }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  const cancelar = () => { if (confirmarDescarte(sucio)) onClose(); };
  const etiquetaTipo = TIPOS_ANUNCIO.find(t => t.valor === form.type)?.texto ?? 'Información';

  return (
    <Dialogo
      abierto
      titulo={announcement ? 'Editar anuncio' : 'Nuevo anuncio'}
      descripcion="Se muestra en la franja de anuncios de la home."
      alCerrar={onClose}
      ancho="md"
      sucio={sucio}
      pie={(
        <>
          <Boton variante="secundario" onClick={cancelar}>Cancelar</Boton>
          <Boton type="submit" form={idForm} icono={<Save size={17} />}>Guardar anuncio</Boton>
        </>
      )}
    >
      <form id={idForm} onSubmit={handleSubmit} className={CLASE_FORMULARIO}>
        <GrupoFormulario titulo="Anuncio">
          <Campo etiqueta="Título" requerido>
            <Entrada
              type="text"
              required
              autoComplete="off"
              placeholder="Ej. 20% off en remeras hasta el domingo"
              value={form.title}
              onChange={e => cambiar('title', e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Texto" requerido ayuda="En el celular la franja muestra solo el tipo y el título.">
            <AreaTexto
              rows={3}
              required
              value={form.content}
              onChange={e => cambiar('content', e.target.value)}
              className="resize-y"
            />
          </Campo>
          <div>
            <Rotulo id={idTipo}>Tipo</Rotulo>
            <div role="radiogroup" aria-labelledby={idTipo} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TIPOS_ANUNCIO.map(t => {
                const elegido = form.type === t.valor;
                return (
                  <button
                    key={t.valor}
                    type="button"
                    role="radio"
                    aria-checked={elegido}
                    onClick={() => cambiar('type', t.valor)}
                    className={cn(
                      'flex h-11 items-center gap-2 rounded-lg border px-3 text-left text-[13px] font-semibold transition-colors',
                      elegido
                        ? 'border-navy-700 bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-navy-700 hover:text-navy-700',
                    )}
                  >
                    <span aria-hidden className={cn('h-3 w-3 shrink-0 rounded-full', COLOR_TICKER[t.valor])} />
                    {t.texto}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 px-4 py-1">
            <Interruptor
              etiqueta="Visible en la web"
              descripcion={form.active ? 'Está en la franja de la home.' : 'Oculto: no aparece hasta que lo actives.'}
              activo={form.active}
              alCambiar={v => cambiar('active', v)}
            />
          </div>
        </GrupoFormulario>

        <GrupoFormulario titulo="Vista previa">
          {/* Misma pieza que el ticker de la home (App.tsx, "Ticker de anuncios"), quieta. */}
          <div
            aria-hidden
            className={cn('overflow-hidden rounded-xl border border-navy-600 bg-navy-800 py-4 transition-opacity', !form.active && 'opacity-50')}
          >
            <div className="flex min-w-0 items-center gap-3 whitespace-nowrap px-4">
              <span className={cn(COLOR_TICKER[form.type], 'shrink-0 rounded-full px-2 py-1 text-xs font-bold text-white')}>
                {etiquetaTipo}
              </span>
              {/* El título manda: se achica recién cuando el texto ya no entra. */}
              <span className={cn('min-w-0 shrink-[0.2] truncate font-display text-sm font-bold', form.title ? 'text-white' : 'text-white/40')}>
                {form.title || 'Título del anuncio'}
              </span>
              {/* Como en la home: el texto solo aparece en pantallas anchas. */}
              {form.content && (
                <>
                  <span className="hidden shrink-0 text-sm text-gray-400 sm:inline">—</span>
                  <span className="hidden min-w-0 truncate text-sm text-gray-300 sm:inline">{form.content}</span>
                </>
              )}
              <span className="shrink-0 text-lg text-lime-400">•</span>
            </div>
          </div>
          <p className="text-[13px] text-gray-500">
            {form.active ? 'Así pasa por la franja, en movimiento y junto a los otros anuncios activos.' : 'Oculto: así se vería si lo activás.'}
          </p>
        </GrupoFormulario>
      </form>
    </Dialogo>
  );
}
