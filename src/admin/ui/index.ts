// Kit de interfaz del panel admin (rediseño 24/09). Lo importan SOLO los chunks lazy del
// admin (src/admin, src/components/Admin*): nunca desde App.tsx, para no meter el panel
// en el JS de la tienda.
//
// Reglas del lenguaje visual (respetarlas en pantallas nuevas):
// - Primario = azul marino (Boton). Lima solo sobre fondo oscuro (variante "acento").
// - Todo lo tocable mide 44px (Boton, BotonIcono, Entrada, Chip de 36 como mínimo).
// - Bordes de 1px (border-gray-200) en vez de sombras; radio xl en tarjetas, lg en controles.
// - Estados con Insignia (tonos fijos), plata con Plata/EntradaPlata (nunca type="number").
// - Modales con Dialogo / Confirmar (portal, Escape, pie fijo en celular).
export { Boton, BotonIcono, type VarianteBoton } from './Boton';
export { Campo, Entrada, Selector, AreaTexto, EntradaPlata, Interruptor, claseEntrada } from './Campo';
export { Dialogo, Confirmar } from './Dialogo';
export {
  EncabezadoPagina, Tarjeta, Estadistica, Plata, Insignia, Segmentado, BarraFiltros, Chip,
  Vacio, CargandoFilas, ErrorEstado, type TonoInsignia,
} from './Piezas';
export { formatoPlata, leerPlata } from './plata';
