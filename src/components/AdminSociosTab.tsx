import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, FileDown, HandCoins } from 'lucide-react';
import { toast } from 'sonner';
import type { LedgerEntry, SocioMove, SocioMoveInput, SocioLiquidacionMove } from '../types';
import { AdminSociosSection } from './AdminSociosSection';
import { AdminLiquidarCajaModal } from './AdminLiquidarCajaModal';
import { exportCajaExcel } from '../utils/cajaExcel';

/** Pestaña Socios: cuentas entre socios + números del negocio (separada de la Caja del bot). */
export function AdminSociosTab({ loadLedgerFull, loadSocioMoves, addSocioMoves, deleteSocioMove, deleteSocioMovesGrupo, liquidarCaja }: {
  loadLedgerFull: () => Promise<LedgerEntry[] | null>;
  loadSocioMoves: () => Promise<SocioMove[] | null>;
  addSocioMoves: (inputs: SocioMoveInput[]) => Promise<boolean>;
  deleteSocioMove: (id: string) => Promise<boolean>;
  deleteSocioMovesGrupo: (grupo: string) => Promise<boolean>;
  liquidarCaja: (ids: string[], moves: SocioLiquidacionMove[]) => Promise<{ ok: boolean; error?: string }>;
}) {
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
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="hidden lg:block font-display text-2xl font-bold text-navy-700">Socios</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowLiquidar(true)}
            disabled={loading}
            className="bg-lime-400 hover:bg-lime-500 disabled:opacity-50 text-navy-700 font-display font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2 text-sm"
          >
            <HandCoins size={16} /> Liquidar caja
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            className="bg-white hover:bg-gray-50 disabled:opacity-50 text-navy-700 border border-gray-200 font-display font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2 text-sm"
          >
            <FileDown size={16} /> {exporting ? 'Generando…' : 'Descargar Excel'}
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="bg-navy-700 hover:bg-navy-800 disabled:bg-gray-400 text-white font-display font-semibold py-2.5 px-5 rounded-lg transition-colors flex items-center gap-2 text-sm"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

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
          onDone={() => { setShowLiquidar(false); refresh(); }}
        />
      )}
    </div>
  );
}
