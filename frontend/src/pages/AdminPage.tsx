import { useState, useEffect } from 'react';
import { getHealth, getStoredUser } from '../api/client';
import type { HealthStatus } from '../api/types';

export default function AdminPage() {
  const currentUser = getStoredUser();
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    async function loadAdminData() {
      try {
        const h = await getHealth();
        setHealth(h);
      } catch (err) {
        console.error('Failed to load system health:', err);
      }
    }
    loadAdminData();
  }, []);

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
          The administration control panel is restricted to users with the ADMIN role.
        </p>
      </div>
    );
  }

  const systemUsers = [
    { username: 'admin123', role: 'ADMIN', status: 'ACTIVE', email: 'admin@crimelink.internal' },
    { username: 'investigator123', role: 'INVESTIGATOR', status: 'ACTIVE', email: 'investigator@crimelink.internal' },
    { username: 'analyst123', role: 'ANALYST', status: 'ACTIVE', email: 'analyst@crimelink.internal' },
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
          Admin Control Center
        </h1>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
          Cluster telemetry, cryptographic security status, and system role management.
        </p>
      </div>

      {/* System Health Telemetry Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5 space-y-1">
          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">API GATEWAY</span>
          <p className="text-lg font-semibold font-mono text-black">
            {health?.status === 'ok' ? 'FASTAPI ONLINE' : 'CHECKING'}
          </p>
          <span className="badge badge-success font-mono">PORT 8000</span>
        </div>

        <div className="card p-5 space-y-1">
          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">RELATIONAL DB</span>
          <p className="text-lg font-semibold font-mono text-black">
            {health?.status === 'ok' ? 'POSTGRESQL CONNECTED' : 'OFFLINE'}
          </p>
          <span className="badge badge-success font-mono">PORT 5432</span>
        </div>

        <div className="card p-5 space-y-1">
          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">GRAPH CLUSTER</span>
          <p className="text-lg font-semibold font-mono text-black">
            {health?.status === 'ok' ? 'NEO4J BOLT CONNECTED' : 'OFFLINE'}
          </p>
          <span className="badge badge-success font-mono">BOLT 7687</span>
        </div>
      </div>

      {/* User Directory Management */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-black">Configured Officer & Analyst Accounts</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Role-based access control accounts in CrimeLink database.</p>
          </div>
        </div>

        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>System Role</th>
                <th>Access Level</th>
                <th>Internal Email</th>
                <th>Account Status</th>
              </tr>
            </thead>
            <tbody>
              {systemUsers.map((u) => (
                <tr key={u.username}>
                  <td className="font-semibold text-black">{u.username}</td>
                  <td>
                    <span className="badge bg-zinc-100 text-zinc-800 font-mono">
                      {u.role === 'INVESTIGATOR' ? 'OFFICER' : u.role}
                    </span>
                  </td>
                  <td className="text-xs text-zinc-500 font-mono">
                    {u.role === 'ADMIN' ? 'Full Control' : u.role === 'INVESTIGATOR' ? 'Ingest + Graph + Analytics' : 'Read-Only Analytics'}
                  </td>
                  <td className="text-xs text-zinc-600 font-mono">{u.email}</td>
                  <td>
                    <span className="badge badge-success font-mono">{u.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
