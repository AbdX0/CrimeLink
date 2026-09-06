import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import CrimeGraphLoader from '../components/CrimeGraphLoader';
import {
  getStoredUser,
  getHealth,
  listSourceRecords,
  getDegreeCentrality,
  getSuspiciousPatterns,
} from '../api/client';
import { getGraphNetwork } from '../api/graph';
import type {
  AuthUser,
  HealthStatus,
  SourceRecordListItem,
  AnalyticsEntityScore,
  SuspiciousResponse,
} from '../api/types';

export default function DashboardPage() {
  const [currentUser] = useState<AuthUser | null>(getStoredUser());
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [records, setRecords] = useState<SourceRecordListItem[]>([]);
  const [centrality, setCentrality] = useState<AnalyticsEntityScore[]>([]);
  const [totalEdges, setTotalEdges] = useState<number>(0);
  const [suspicious, setSuspicious] = useState<SuspiciousResponse | null>(null);

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      try {
        const [healthRes, recordsRes, centralityRes, graphRes, suspiciousRes] =
          await Promise.allSettled([
            getHealth(),
            listSourceRecords(10, 0),
            getDegreeCentrality(undefined, 8),
            getGraphNetwork(),
            getSuspiciousPatterns(),
          ]);

        if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
        if (recordsRes.status === 'fulfilled') setRecords(recordsRes.value);
        if (centralityRes.status === 'fulfilled') setCentrality(centralityRes.value.results || []);
        if (graphRes.status === 'fulfilled') {
          setTotalEdges(graphRes.value.edges?.length || 0);
        }
        if (suspiciousRes.status === 'fulfilled') setSuspicious(suspiciousRes.value);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

  const isOfficer = currentUser?.role === 'INVESTIGATOR';
  const totalAlerts = suspicious?.count ?? suspicious?.alerts?.length ?? 0;

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Top Header */}
      <div className="pb-4 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-mono text-zinc-400 tracking-widest uppercase block mb-1">
            CRIMELINK INTELLIGENCE
          </span>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            {isOfficer ? 'Officer Dashboard' : 'Supervising Overview'}
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-xl">
            Ingest investigation evidence, build suspect entity profiles, and analyze relationship pathways across assigned cases.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link to="/cases/create" className="btn-primary text-xs px-3.5 py-1.5">
            + New Case
          </Link>
          <Link to="/datacenter" className="btn-secondary text-xs px-3.5 py-1.5">
            Upload Dataset
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {[
          {
            name: isOfficer ? 'My Evidence Records' : 'Active Records',
            value: records.length.toString(),
            change: records.length > 0 ? `${records.length} in PostgreSQL` : '0 records recorded',
            href: '/datacenter',
          },
          {
            name: 'Entities Extracted',
            value: centrality.length.toString(),
            change: centrality.length > 0 ? `${centrality.length} nodes analyzed` : 'Awaiting NLP extraction',
            href: '/entities',
          },
          {
            name: 'Relationships',
            value: totalEdges.toString(),
            change: totalEdges > 0 ? `${totalEdges} graph edges mapped` : 'Awaiting graph link sync',
            href: '/network',
          },
          {
            name: 'Alerts Queue',
            value: totalAlerts.toString(),
            change: totalAlerts > 0 ? `${totalAlerts} require review` : 'No anomalies detected',
            href: '/alerts',
          },
          {
            name: 'System Health',
            value: health?.status === 'ok' ? 'ONLINE' : 'CHECKING',
            change: health?.status === 'ok' ? 'FastAPI + Neo4j Active' : 'Cluster initializing',
            href: '/admin',
          },
        ].map((stat, idx) => (
          <Link
            key={stat.name}
            to={stat.href}
            className={`card p-4 hover:border-zinc-400 transition-all ${
              idx === 4 ? 'col-span-2 sm:col-span-1' : ''
            }`}
          >
            <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider truncate">{stat.name}</p>
            <p className="text-2xl font-semibold text-black font-mono mt-2">{stat.value}</p>
            <p className="text-[10px] text-zinc-500 mt-1 truncate">{stat.change}</p>
          </Link>
        ))}
      </div>

      {/* Assigned Evidence Records List & Active Pipeline Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Recent Evidence Records */}
        <div className="lg:col-span-2 card p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
            <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest">
              {isOfficer ? 'Recent Investigation Evidence' : 'Active Ingested Datasets'}
            </h2>
            <Link to="/datacenter" className="text-xs font-medium text-black hover:underline">
              View Data Center →
            </Link>
          </div>

          {loading ? (
            <div className="py-8 flex justify-center">
              <CrimeGraphLoader size={24} text="Loading database records…" />
            </div>
          ) : records.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-xs font-semibold text-black">No evidence records ingested</p>
              <p className="text-xs text-zinc-500">Upload CDRs, bank records, or FIRs in the Data Center to start intelligence extraction.</p>
              <Link to="/datacenter" className="btn-primary text-xs inline-flex px-3 py-1.5 mt-1">
                Upload Dataset
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {records.slice(0, 6).map((rec) => (
                <div key={rec.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="badge bg-zinc-100 border-zinc-200 text-zinc-800 font-mono text-[10px]">
                        {rec.source_type || 'FILE'}
                      </span>
                      <p className="text-xs font-semibold text-black truncate">
                        {rec.title || `Record #${rec.id}`}
                      </p>
                    </div>
                    <p className="text-[10px] text-zinc-400 font-mono mt-1 truncate">
                      ID #{rec.id} • {new Date(rec.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      to={`/cases/${rec.id}`}
                      className="btn-secondary text-[11px] py-1 px-2.5"
                    >
                      Inspect
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Top Entities & Quick Actions */}
        <div className="space-y-6">
          {/* Top Entities */}
          <div className="card p-5 space-y-3">
            <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
              <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest">
                High-Degree Entities
              </h2>
              <Link to="/entities" className="text-xs font-medium text-black hover:underline">
                All →
              </Link>
            </div>

            {loading ? (
              <div className="py-6 flex justify-center">
                <CrimeGraphLoader size={20} text="Calculating centrality…" />
              </div>
            ) : centrality.length === 0 ? (
              <p className="text-xs text-zinc-500 py-4 text-center">No resolved entities in knowledge graph.</p>
            ) : (
              <div className="space-y-2.5">
                {centrality.slice(0, 5).map((ent, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs p-2 bg-zinc-50 border border-zinc-200 rounded">
                    <div className="min-w-0 pr-2">
                      <p className="font-semibold text-black truncate">{ent.name || ent.entity_id}</p>
                      <span className="badge bg-zinc-200 text-zinc-700 font-mono text-[9px] mt-0.5">
                        {ent.labels?.[0] || 'ENTITY'}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-mono text-zinc-400 block">Degree</span>
                      <span className="font-mono font-semibold text-black text-xs">{ent.score ?? ent.degree ?? 0}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Actions Card */}
          <div className="card p-5 space-y-3 bg-zinc-50/50">
            <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest border-b border-zinc-200 pb-2">
              Intelligence Quick Actions
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <Link to="/network" className="btn-secondary text-xs py-2 text-center">
                🕸 Link Graph
              </Link>
              <Link to="/alerts" className="btn-secondary text-xs py-2 text-center">
                ⚠ Risk Alerts
              </Link>
              <Link to="/datacenter" className="btn-secondary text-xs py-2 text-center">
                📥 Ingest Data
              </Link>
              <Link to="/entities" className="btn-secondary text-xs py-2 text-center">
                🔍 Entity Audit
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
