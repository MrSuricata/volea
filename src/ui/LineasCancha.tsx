// Líneas de una cancha de pickleball vista desde arriba (44 × 20 pies, acostada), como
// textura de fondo de las secciones oscuras: es el motivo gráfico propio de VOLEA en vez
// de un patrón genérico de puntitos. Proporciones reales: red al medio, "cocina" a 7 pies
// de cada lado y la línea central solo entre la cocina y el fondo.
export function LineasCancha({ className = '' }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 440 200"
      preserveAspectRatio="xMidYMid slice"
      className={`pointer-events-none ${className}`}
      fill="none"
      stroke="currentColor"
    >
      <g strokeWidth="1.5" vectorEffect="non-scaling-stroke">
        <rect x="1" y="1" width="438" height="198" vectorEffect="non-scaling-stroke" />
        <line x1="150" y1="1" x2="150" y2="199" vectorEffect="non-scaling-stroke" />
        <line x1="290" y1="1" x2="290" y2="199" vectorEffect="non-scaling-stroke" />
        <line x1="1" y1="100" x2="150" y2="100" vectorEffect="non-scaling-stroke" />
        <line x1="290" y1="100" x2="439" y2="100" vectorEffect="non-scaling-stroke" />
      </g>
      {/* La red, un poco más marcada */}
      <line x1="220" y1="-10" x2="220" y2="210" strokeWidth="3" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
