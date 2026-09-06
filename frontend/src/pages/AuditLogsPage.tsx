import { useState, useEffect } from 'react';
import CrimeGraphLoader from '../components/CrimeGraphLoader';
import { getAuditLogs, getStoredUser } from '../api/client';
import type { AuditLogItem } from '../api/types';

export default function AuditLogsPage() {
  const currentUser = getStoredUser();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usernameFilter, setUsernameFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAuditLogs({
        username: usernameFilter || undefined,
        action: actionFilter || undefined,
        limit: 100,
      });
      setLogs(data || []);
    } catch (err: any) {
      if (err?.status === 403) {
        setError('Access Denied: Only ADMIN role is authorized to inspect system audit trails.');
      } else {
        setError(err?.message || 'Failed to fetch audit logs from database.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [usernameFilter, actionFilter]);

  if (currentUser?.role !== 'ADMIN') {
    return (
      <div className="card p-8 text-center max-w-md mx-auto mt-12 space-y-3">
        <div className="w-10 h-10 rounded-full bg-amber-100 border border-amber-300 text-amber-700 flex items-center justify-center mx-auto">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 002-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-sm font-semibold text-black">Administrator Access Required</h2>
        <p className="text-xs text-zinc-500">
          Audit logs contain security-sensitive request logs and require the ADMIN role to access.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            System Audit Logs
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
            Immutable append-only audit trail of authenticated and denied API requests in PostgreSQL.
          </p>
        </div>
        <button
          onClick={fetchLogs}
          className="btn-secondary text-xs px-3.5 py-1.5 shrink-0 cursor-pointer"
        >
          Refresh Logs
        </button>
      </div>

      {/* Filters Pane */}
      <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div>
          <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1">
            Filter by Username
          </label>
          <input
            type="text"
            placeholder="e.g. investigator123"
            value={usernameFilter}
            onChange={(e) => setUsernameFilter(e.target.value)}
            className="form-input text-xs"
          />
        </div>
        <div>
          <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1">
            Filter by Action / Path
          </label>
          <input
            type="text"
            placeholder="e.g. /pipeline/process"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="form-input text-xs"
          />
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center">
            <CrimeGraphLoader size={28} text="Loading audit log records from database…" />
          </div>
        ) : error ? (
          <div className="p-6 text-center text-xs text-red-700 bg-red-50">{error}</div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-xs text-zinc-500">No audit log entries recorded yet.</div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Log ID</th>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action / Endpoint</th>
                  <th>Resource</th>
                  <th>Status</th>
                  <th>Client IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="font-mono text-zinc-500 text-xs">#{log.id}</td>
                    <td className="font-mono text-zinc-400 text-[11px]">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="font-semibold text-black text-xs">{log.username || 'ANONYMOUS'}</td>
                    <td className="font-mono text-zinc-700 text-xs truncate max-w-xs">{log.action || `${log.method} ${log.path}`}</td>
                    <td className="font-mono text-zinc-500 text-xs truncate max-w-xs">
                      {log.resource_type ? `${log.resource_type} ${log.resource_id || ''}` : '—'}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          log.status_code >= 200 && log.status_code < 300
                            ? 'badge-success'
                            : log.status_code >= 400
                            ? 'badge-critical'
                            : 'badge-medium'
                        }`}
                      >
                        {log.status_code}
                      </span>
                    </td>
                    <td className="font-mono text-zinc-400 text-[11px]">{log.client_ip || '127.0.0.1'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
