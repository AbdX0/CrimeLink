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
import { getGraphNetwork, getKeyInfluencers, type KeyInfluencerItem } from '../api/graph';
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
  const [influencers, setInfluencers] = useState<KeyInfluencerItem[]>([]);

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      try {
        const [healthRes, recordsRes, centralityRes, graphRes, suspiciousRes, influencersRes] =
          await Promise.allSettled([
            getHealth(),
            listSourceRecords(10, 0),
            getDegreeCentrality(undefined, 8),
            getGraphNetwork(),
            getSuspiciousPatterns(),
            getKeyInfluencers(6),
          ]);

        if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
        if (recordsRes.status === 'fulfilled') setRecords(recordsRes.value);
        if (centralityRes.status === 'fulfilled') setCentrality(centralityRes.value.results || []);
        if (graphRes.status === 'fulfilled') {
          setTotalEdges(graphRes.value.edges?.length || 0);
        }
        if (suspiciousRes.status === 'fulfilled') setSuspicious(suspiciousRes.value);
        if (influencersRes.status === 'fulfilled' && influencersRes.value?.results) {
          setInfluencers(influencersRes.value.results);
        }
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
            className={`card p-4 hover:border-emerald-500/50 hover:bg-[#16161a] transition-all group ${
              idx === 4 ? 'col-span-2 sm:col-span-1' : ''
            }`}
          >
            <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider truncate">{stat.name}</p>
            <p className="text-2xl font-bold text-white font-mono mt-2 group-hover:text-emerald-400 transition-colors">{stat.value}</p>
            <p className="text-[10px] text-zinc-400 mt-1 truncate font-mono">{stat.change}</p>
          </Link>
        ))}
      </div>

      {/* Assigned Evidence Records List & Active Pipeline Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Recent Evidence Records */}
        <div className="lg:col-span-2 card p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
            <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>{isOfficer ? 'Recent Investigation Evidence' : 'Active Ingested Datasets'}</span>
            </h2>
            <Link to="/datacenter" className="text-xs font-medium text-emerald-400 hover:text-emerald-300 hover:underline">
              View Data Center →
            </Link>
          </div>

          {loading ? (
            <div className="py-8 flex justify-center">
              <CrimeGraphLoader size={24} text="Loading database records…" />
            </div>
          ) : records.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-xs font-semibold text-white">No evidence records ingested</p>
              <p className="text-xs text-zinc-400">Upload CDRs, bank records, or FIRs in the Data Center to start intelligence extraction.</p>
              <Link to="/datacenter" className="btn-primary text-xs inline-flex px-3 py-1.5 mt-1">
                Upload Dataset
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/80">
              {records.slice(0, 6).map((rec) => (
                <div key={rec.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="badge bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-[10px]">
                        {rec.source_type || 'FILE'}
                      </span>
                      <p className="text-xs font-semibold text-zinc-100 truncate">
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

        {/* Right Column: Key Network Influencers & Quick Actions */}
        <div className="space-y-6">
          {/* Key Network Influencers (Graph Centrality: PageRank, Betweenness, Degree) */}
          <div className="card p-5 space-y-3.5 bg-[#121215] border border-zinc-800">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <div>
                <h2 className="text-xs font-mono text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span>Key Influencers</span>
                </h2>
                <span className="text-[9px] font-mono text-zinc-400 block mt-0.5">
                  Topological Centrality (PageRank + Bridges)
                </span>
              </div>
              <Link to="/network" className="text-xs font-mono text-emerald-400 hover:text-emerald-300 hover:underline">
                Explore Graph →
              </Link>
            </div>

            {loading ? (
              <div className="py-6 flex justify-center">
                <CrimeGraphLoader size={20} text="Analyzing graph centrality…" />
              </div>
            ) : influencers.length === 0 ? (
              <p className="text-xs text-zinc-400 py-4 text-center font-mono">No resolved entities in knowledge graph.</p>
            ) : (
              <div className="space-y-2">
                {influencers.slice(0, 5).map((inf, idx) => (
                  <Link
                    key={idx}
                    to={inf.primary_label === 'PERSON' ? `/network?person=${encodeURIComponent(inf.entity_id)}` : '/network'}
                    className="block p-2.5 bg-[#16161a] hover:bg-[#1c1c22] border border-zinc-800/90 hover:border-zinc-700 rounded-lg transition-all group"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base shrink-0">{inf.badge_icon}</span>
                        <p className="font-semibold text-zinc-100 text-xs truncate group-hover:text-emerald-400 transition-colors">
                          {inf.name}
                        </p>
                      </div>
                      <span
                        className="font-mono font-bold text-[9px] px-1.5 py-0.5 rounded border shrink-0 tracking-wider uppercase"
                        style={{
                          backgroundColor: `${inf.badge_color}20`,
                          borderColor: `${inf.badge_color}60`,
                          color: inf.badge_color,
                        }}
                      >
                        {inf.role}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 pt-1.5 border-t border-zinc-800/80">
                      <span>PR: <strong className="text-zinc-200">{inf.pagerank.toFixed(2)}</strong> • Deg: <strong className="text-zinc-200">{inf.degree}</strong></span>
                      <span className="font-semibold" style={{ color: inf.badge_color }}>Score: {inf.influence_score}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Quick Actions Card */}
          <div className="card p-5 space-y-3 bg-[#121215] border border-zinc-800">
            <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-2">
              Intelligence Quick Actions
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <Link to="/network" className="btn-secondary text-xs py-2 text-center hover:border-emerald-500/40">
                🕸 Link Graph
              </Link>
              <Link to="/alerts" className="btn-secondary text-xs py-2 text-center hover:border-amber-500/40">
                ⚠ Risk Alerts
              </Link>
              <Link to="/datacenter" className="btn-secondary text-xs py-2 text-center hover:border-blue-500/40">
                📥 Ingest Data
              </Link>
              <Link to="/entities" className="btn-secondary text-xs py-2 text-center hover:border-purple-500/40">
                🔍 Entity Audit
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
