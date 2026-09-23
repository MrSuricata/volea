// Features de animación de framer-motion (animate, variants, whileInView, hover/tap).
//
// POR QUÉ un módulo aparte: con `motion.div` framer-motion mete TODAS sus features en el
// JS de entrada. Con LazyMotion + `m.div` (App.tsx) el componente base queda chico y esto
// se pide con import() dinámico al arrancar: baja en paralelo con el resto y no traba el
// primer render. domAnimation alcanza: no usamos drag ni animaciones de layout (domMax).
import { domAnimation } from 'framer-motion';

export default domAnimation;
