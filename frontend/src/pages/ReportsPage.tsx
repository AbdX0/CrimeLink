import { useState, useEffect } from 'react';
import { listSourceRecords } from '../api/client';
import type { SourceRecordListItem } from '../api/types';

export default function ReportsPage() {
  const [records, setRecords] = useState<SourceRecordListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadReports() {
      try {
        const data = await listSourceRecords(20, 0);
        setRecords(data || []);
      } catch (err) {
        console.error('Failed to load reports:', err);
      } finally {
        setLoading(false);
      }
    }
    loadReports();
  }, []);

  const handleExport = () => {
    window.print();
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            Intelligence Reports
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
            Export comprehensive case summaries and network link diagrams.
          </p>
        </div>
        <button
          onClick={handleExport}
          className="btn-primary text-xs px-4 py-2 shrink-0 cursor-pointer"
        >
          Compile Dossier
        </button>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-zinc-500">Loading intelligence reports…</div>
        ) : records.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500">
            No case evidence available to compile reports.
          </div>
        ) : (
          <>
            <div className="hidden sm:block table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Report Title</th>
                    <th>Generated At</th>
                    <th>Source Type</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec) => (
                    <tr key={rec.id}>
                      <td className="font-semibold text-black">
                        Intelligence Digest — {rec.title || `Case #${rec.id}`}
                      </td>
                      <td className="text-zinc-400 text-[11px] font-mono">
                        {new Date(rec.created_at).toLocaleString()}
                      </td>
                      <td className="text-zinc-500 text-xs font-mono">
                        {rec.source_type || 'TXT'}
                      </td>
                      <td>
                        <span className="badge badge-success">READY</span>
                      </td>
                      <td>
                        <button
                          onClick={handleExport}
                          className="text-xs font-medium text-black hover:underline cursor-pointer"
                        >
                          Export PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile View */}
            <div className="sm:hidden p-4 space-y-3">
              {records.map((rec) => (
                <div key={rec.id} className="space-y-2 p-3 bg-zinc-50 rounded border border-zinc-200">
                  <div className="flex justify-between items-start">
                    <h3 className="font-semibold text-xs text-black">
                      Intelligence Digest — {rec.title || `Case #${rec.id}`}
                    </h3>
                    <span className="badge badge-success shrink-0">READY</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 font-mono">
                    {new Date(rec.created_at).toLocaleDateString()}
                  </p>
                  <button
                    onClick={handleExport}
                    className="btn-secondary w-full text-xs py-1.5 mt-2 cursor-pointer"
                  >
                    Export PDF
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
