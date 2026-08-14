/**
 * Normaliza un teléfono uruguayo a formato wa.me (598 + 8 dígitos) o null si
 * no da: el campo es texto libre y un link roto es peor que ningún link.
 * Vivía en App.tsx; ahora lo comparte la pestaña Inscripciones.
 */
export const waUruguay = (tel: string | undefined): string | null => {
  const soloDigitos = (tel || '').replace(/\D/g, '').replace(/^00/, '');
  if (!soloDigitos) return null;
  const conPais = soloDigitos.startsWith('598') ? soloDigitos : `598${soloDigitos.replace(/^0+/, '')}`;
  // Largo EXACTO (598 + 8 dígitos): el campo es texto libre, y con ">= 11" un
  // "092 103 276 / 099 123 456" armaba un número pegoteado que no existe.
  return conPais.length === 11 ? conPais : null;
};
