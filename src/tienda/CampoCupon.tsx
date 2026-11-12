// Campo "¿Tenés un código?" del checkout y de la inscripción. Solo CONSULTA el código (no lo
// gasta): se gasta al mandar el pedido / la inscripción.
import { useState } from 'react';
import { Check, Ticket, X } from 'lucide-react';
import { SupabaseService } from '../services/supabaseService';
import { normalizarCodigo, type CuponTipo, type CuponValido } from '../utils/cupones';

export function CampoCupon({ tipo, cupon, onCambio, id }: {
  tipo: CuponTipo;
  cupon: CuponValido | null;
  onCambio: (c: CuponValido | null) => void;
  id: string;
}) {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState('');

  if (cupon) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-lime-400 bg-lime-50 px-4 py-3 text-sm">
        <Check size={18} className="flex-shrink-0 text-lime-700" />
        <span className="flex-1 text-navy-700">
          <strong className="font-display">{cupon.codigo}</strong> · {cupon.etiqueta}
        </span>
        <button
          type="button"
          onClick={() => { onCambio(null); setTexto(''); }}
          aria-label="Quitar el código"
          className="-m-2 p-2 text-gray-500 hover:text-red-600"
        >
          <X size={18} />
        </button>
      </div>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-2 text-sm font-semibold text-navy-700 underline-offset-2 hover:underline"
      >
        <Ticket size={16} /> ¿Tenés un código de descuento?
      </button>
    );
  }

  const aplicar = async () => {
    const codigo = normalizarCodigo(texto);
    if (!codigo) return;
    setVerificando(true);
    setError('');
    const r = await SupabaseService.consultarCupon(codigo, tipo);
    setVerificando(false);
    if (r.ok) onCambio(r.cupon);
    else setError(r.error);
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-navy-700">Código de descuento</label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          maxLength={20}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="Ej. V20-XXXXXX"
          value={texto}
          onChange={e => { setTexto(e.target.value); setError(''); }}
          // Enter acá aplica el código; no manda el formulario entero.
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void aplicar(); } }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-4 py-3 uppercase outline-none transition-colors focus:border-navy-700 focus:ring-2 focus:ring-navy-700/25"
        />
        <button
          type="button"
          onClick={() => void aplicar()}
          disabled={verificando || texto.trim() === ''}
          className="rounded-lg bg-navy-700 px-4 py-3 font-display text-sm font-bold text-white transition-colors hover:bg-navy-600 disabled:opacity-50"
        >
          {verificando ? 'Verificando…' : 'Aplicar'}
        </button>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
