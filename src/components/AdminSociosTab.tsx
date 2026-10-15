import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, FileDown, HandCoins } from 'lucide-react';
import { toast } from 'sonner';
import type { LedgerEntry, SocioMove, SocioMoveInput, SocioLiquidacionMove, SocioName } from '../types';
import { AdminSociosSection } from './AdminSociosSection';
import { AdminLiquidarCajaModal } from './AdminLiquidarCajaModal';
import { CajaVoleaPanel } from './CajaVoleaPanel';
import { exportCajaExcel } from '../utils/cajaExcel';
import { Boton, BotonIcono, EncabezadoPagina } from '../admin/ui';

/** Pestaña Socios: cuentas entre socios + números del negocio (separada de la Caja del bot). */
export function AdminSociosTab({ loadLedgerFull, loadSocioMoves, addSocioMoves, deleteSocioMove, deleteSocioMovesGrupo, liquidarCaja, reportedBy, socioSugerido }: {
  loadLedgerFull: () => Promise<LedgerEntry[] | null>;
  loadSocioMoves: () => Promise<SocioMove[] | null>;
  addSocioMoves: (inputs: SocioMoveInput[]) => Promise<boolean>;
  deleteSocioMove: (id: string) => Promise<boolean>;
  deleteSocioMovesGrupo: (grupo: string) => Promise<boolean>;
  liquidarCaja: (ids: string[], moves: SocioLiquidacionMove[]) => Promise<{ ok: boolean; error?: string }>;
  reportedBy: string;
  socioSugerido: SocioName | null;
}) {
  // Se sube al liquidar para que el panel de la caja vuelva a leer el saldo.
  const [vueltaCaja, setVueltaCaja] = useState(0);
  const [moves, setMoves] = useState<SocioMove[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showLiquidar, setShowLiquidar] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await loadSocioMoves();
    setMoves(data);
    setLoading(false);
  }, [loadSocioMoves]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Mismo reporte completo que el de la Caja: movimientos del bot + cuentas socios.
      const [full, socios] = await Promise.all([loadLedgerFull(), loadSocioMoves()]);
      if (full === null) {
        toast.error('No se pudo leer la caja. Verificá tu sesión de admin.');
        return;
      }
      await exportCajaExcel(full, socios);
      toast.success('Excel descargado');
    } catch (err) {
      console.error('Error exportando:', err);
      toast.error('No se pudo generar el Excel');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fade-in">
      <EncabezadoPagina
        rotulo="Plata"
        titulo="Socios"
        descripcion="Cuentas entre socios y números del negocio. Reparto estándar Brian 50% · Paula 25% · Gastón 25%."
        acciones={(
          <>
            <BotonIcono
              etiqueta={exporting ? 'Generando el Excel…' : 'Descargar Excel'}
              icono={exporting ? <RefreshCw size={18} className="animate-spin" /> : <FileDown size={18} />}
              onClick={handleExport}
              disabled={exporting || loading}
              className="border border-gray-300 bg-white"
            />
            <BotonIcono
              etiqueta="Actualizar"
              icono={<RefreshCw size={18} className={loading ? 'animate-spin' : ''} />}
              onClick={refresh}
              disabled={loading}
              className="border border-gray-300 bg-white"
            />
            <Boton icono={<HandCoins size={18} />} onClick={() => setShowLiquidar(true)} disabled={loading} className="grow sm:grow-0">
              Liquidar caja
            </Boton>
          </>
        )}
      />

      <CajaVoleaPanel key={vueltaCaja} reportedBy={reportedBy} socioSugerido={socioSugerido} onCuentasCambiaron={refresh} />

      <AdminSociosSection
        moves={moves}
        loading={loading}
        onRefresh={refresh}
        onAddMany={addSocioMoves}
        onDelete={deleteSocioMove}
        onDeleteGrupo={deleteSocioMovesGrupo}
      />

      {showLiquidar && (
        <AdminLiquidarCajaModal
          socioMoves={moves}
          loadLedgerFull={loadLedgerFull}
          liquidar={liquidarCaja}
          onClose={() => setShowLiquidar(false)}
          onDone={() => { setShowLiquidar(false); refresh(); setVueltaCaja((v) => v + 1); }}
        />
      )}
    </div>
  );
}
