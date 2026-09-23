import type { VercelRequest, VercelResponse } from '@vercel/node';

// Recibe los avisos de la Content-Security-Policy (vercel.json la manda en modo
// Report-Only: el navegador NO bloquea nada, solo avisa acá qué habría
// bloqueado). Cada aviso queda en los logs de la función en Vercel con el
// prefijo [csp]. Cuando pasen unos días sin avisos legítimos (tienda, admin,
// /copa, pago), la política se pasa a Content-Security-Policy y empieza a
// bloquear de verdad.

type Aviso = Record<string, unknown>;

// Extensiones del navegador y traductores inyectan cosas en cualquier sitio:
// no dicen nada de la web y solo meten ruido en los logs.
const RUIDO = /^(chrome|moz|safari(-web)?|ms-browser)-extension:/;

function normalizar(cuerpo: unknown): Aviso[] {
  // Formato viejo (report-uri): { "csp-report": {...} }
  if (cuerpo && typeof cuerpo === 'object' && 'csp-report' in cuerpo) {
    return [(cuerpo as { 'csp-report': Aviso })['csp-report']];
  }
  // Formato nuevo (Reporting API): [{ type, body: {...} }]
  if (Array.isArray(cuerpo)) {
    return cuerpo.map((r) => (r && typeof r === 'object' && 'body' in r ? (r as { body: Aviso }).body : r)).filter(Boolean);
  }
  return [];
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  // application/csp-report no es JSON para el parser de Vercel: puede llegar
  // como texto o como Buffer.
  let cuerpo: unknown = req.body;
  if (Buffer.isBuffer(cuerpo)) cuerpo = cuerpo.toString('utf8');
  if (typeof cuerpo === 'string') {
    try {
      cuerpo = JSON.parse(cuerpo.slice(0, 20_000));
    } catch {
      return res.status(204).end();
    }
  }
  for (const a of normalizar(cuerpo).slice(0, 5)) {
    const bloqueado = String(a['blocked-uri'] ?? a.blockedURL ?? '');
    const fuente = String(a['source-file'] ?? a.sourceFile ?? '');
    if (RUIDO.test(bloqueado) || RUIDO.test(fuente)) continue;
    console.warn('[csp]', JSON.stringify({
      directiva: a['violated-directive'] ?? a['effective-directive'] ?? a.effectiveDirective,
      bloqueado: bloqueado.slice(0, 300),
      pagina: String(a['document-uri'] ?? a.documentURL ?? '').slice(0, 300),
      fuente: fuente.slice(0, 300),
      linea: a['line-number'] ?? a.lineNumber,
      muestra: String(a['script-sample'] ?? a.sample ?? '').slice(0, 120),
    }));
  }
  return res.status(204).end();
}
