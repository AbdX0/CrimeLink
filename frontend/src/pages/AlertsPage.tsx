import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import CrimeGraphLoader from '../components/CrimeGraphLoader';
import { getSuspiciousPatterns } from '../api/client';
import type { SuspiciousAlert } from '../api/types';
import { showToast } from '../utils/toast';

export default function AlertsPage() {
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<SuspiciousAlert[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAlerts() {
      setLoading(true);
      try {
        const resp = await getSuspiciousPatterns();
        setAlerts(resp.alerts || []);
      } catch (err: any) {
        console.error('Failed to load suspicious alerts:', err);
        showToast.error('Alerts Error', err?.message || 'Failed to query suspicious network patterns.');
      } finally {
        setLoading(false);
      }
    }
    fetchAlerts();
  }, []);

  const getSeverity = (score: number): 'CRITICAL' | 'HIGH' | 'MEDIUM' => {
    if (score >= 0.8) return 'CRITICAL';
    if (score >= 0.5) return 'HIGH';
    return 'MEDIUM';
  };

  const criticalCount = alerts.filter((a) => getSeverity(a.risk_score) === 'CRITICAL').length;
  const highCount = alerts.filter((a) => getSeverity(a.risk_score) === 'HIGH').length;
  const mediumCount = alerts.filter((a) => getSeverity(a.risk_score) === 'MEDIUM').length;

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
          Alerts Queue
        </h1>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
          Review system alerts triggered by link analysis rules and AI extraction pipelines in CrimeLink.
        </p>
      </div>

      {/* Summary Grid */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Critical', count: criticalCount, badgeClass: 'badge-critical' },
          { label: 'High', count: highCount, badgeClass: 'badge-high' },
          { label: 'Medium', count: mediumCount, badgeClass: 'badge-medium' },
        ].map((s) => (
          <div key={s.label} className="card p-4 text-center">
            <p className="text-xl font-semibold font-mono text-black">{s.count}</p>
            <p className="text-[9px] font-mono text-zinc-400 uppercase tracking-widest mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Alerts list */}
      {loading ? (
        <div className="p-12 flex justify-center">
          <CrimeGraphLoader size={28} text="Analyzing suspicious network patterns…" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="card p-12 text-center space-y-2">
          <p className="text-xs font-semibold text-black">No active risk alerts</p>
          <p className="text-xs text-zinc-500">
            No anomalous patterns or suspicious topology detected across current evidence graph.
          </p>
          <Link to="/datacenter" className="btn-primary text-xs inline-flex px-3.5 py-1.5 mt-2">
            Ingest More Evidence
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((al, i) => {
            const severity = getSeverity(al.risk_score);
            return (
              <div key={i} className="card p-5 space-y-3">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`badge ${
                          severity === 'CRITICAL'
                            ? 'badge-critical'
                            : severity === 'HIGH'
                            ? 'badge-high'
                            : 'badge-medium'
                        }`}
                      >
                        {severity}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                        {al.pattern_type}
                      </span>
                      <span className="badge bg-zinc-100 text-zinc-700 font-mono text-[9px]">
                        Risk: {(al.risk_score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <h3 className="text-xs font-semibold text-black">
                      {al.entity_name || al.entity_id}
                    </h3>
                    <p className="text-xs text-zinc-500">{al.explanation}</p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                    <button
                      id={`alert-investigate-btn-${i}`}
                      onClick={() => setExpandedId(expandedId === al.entity_id ? null : al.entity_id)}
                      className="btn-secondary text-xs px-3.5 py-1.5 cursor-pointer"
                    >
                      {expandedId === al.entity_id ? 'Hide Details' : 'Inspect Trace'}
                    </button>
                    <Link to="/network" className="btn-primary text-xs px-3.5 py-1.5">
                      Investigate →
                    </Link>
                  </div>
                </div>

                {/* Expandable Trace Details */}
                {expandedId === al.entity_id && (
                  <div className="pt-3 border-t border-zinc-100 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div>
                        <span className="text-zinc-400 text-[10px] block">ENTITY LABELS</span>
                        <span className="text-black">{al.entity_labels?.join(', ') || 'ENTITY'}</span>
                      </div>
                      <div>
                        <span className="text-zinc-400 text-[10px] block">EVIDENCE SOURCE IDS</span>
                        <span className="text-black">
                          {al.evidence_source_ids?.length > 0 ? al.evidence_source_ids.join(', ') : 'Direct Graph Vector'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
