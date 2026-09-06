import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import CrimeGraphLoader from '../components/CrimeGraphLoader';
import { getDegreeCentrality } from '../api/client';
import { getGraphNetwork } from '../api/graph';

interface EntityDisplayItem {
  id: string;
  name: string;
  type: string;
  details: string;
  status: string;
  confidence: string;
  score?: number;
}

export default function EntitySearchPage() {
  const [entities, setEntities] = useState<EntityDisplayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL');

  useEffect(() => {
    async function loadEntities() {
      setLoading(true);
      try {
        const [centralityRes, graphRes] = await Promise.allSettled([
          getDegreeCentrality(undefined, 100),
          getGraphNetwork(),
        ]);

        const items: EntityDisplayItem[] = [];
        const seen = new Set<string>();

        if (centralityRes.status === 'fulfilled' && centralityRes.value.results) {
          for (const item of centralityRes.value.results) {
            seen.add(item.entity_id);
            items.push({
              id: item.entity_id,
              name: item.name || item.entity_id,
              type: item.labels?.[0] || 'ENTITY',
              details: `Degree Centrality Score: ${item.score ?? item.degree ?? 0}`,
              status: 'RESOLVED',
              confidence: '95%',
              score: item.score ?? item.degree,
            });
          }
        }

        if (graphRes.status === 'fulfilled' && graphRes.value.nodes) {
          for (const node of graphRes.value.nodes) {
            if (!seen.has(node.id)) {
              seen.add(node.id);
              items.push({
                id: node.id,
                name: node.name || node.id,
                type: node.labels?.[0] || 'ENTITY',
                details: `Source Record ID: ${node.source_record_id || 'Cluster Node'}`,
                status: 'RESOLVED',
                confidence: '90%',
              });
            }
          }
        }

        setEntities(items);
      } catch (err) {
        console.error('Failed to fetch entities:', err);
      } finally {
        setLoading(false);
      }
    }
    loadEntities();
  }, []);

  const filtered = entities.filter((ent) => {
    const matchesQuery =
      !search ||
      ent.name.toLowerCase().includes(search.toLowerCase()) ||
      ent.type.toLowerCase().includes(search.toLowerCase()) ||
      ent.details.toLowerCase().includes(search.toLowerCase());

    const matchesType = filterType === 'ALL' || ent.type.toUpperCase() === filterType.toUpperCase();

    return matchesQuery && matchesType;
  });

  const availableTypes = ['ALL', ...Array.from(new Set(entities.map((e) => e.type.toUpperCase())))];

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Entities Database</h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
            Search, resolve, and audit extracted intelligence entity profiles across knowledge graphs.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
          <input
            id="entities-search-input"
            type="text"
            placeholder="Search entity name, phone, account…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input text-xs w-full sm:w-64"
          />
        </div>
      </div>

      {/* Filter Badges */}
      {availableTypes.length > 2 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider mr-1">Filter Type:</span>
          {availableTypes.map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`badge text-[10px] cursor-pointer transition-colors ${
                filterType === t
                  ? 'bg-black text-white'
                  : 'bg-zinc-100 border-zinc-200 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Main Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center">
            <CrimeGraphLoader size={28} text="Querying resolved intelligence entities…" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <p className="text-xs font-semibold text-black">No entities found</p>
            <p className="text-xs text-zinc-500">
              {entities.length === 0
                ? 'Ingest datasets in Data Center to extract suspect identities and endpoints.'
                : 'No entities matching your query filter.'}
            </p>
            {entities.length === 0 && (
              <Link to="/datacenter" className="btn-primary text-xs inline-flex px-3.5 py-1.5 mt-2">
                Ingest Data
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="hidden sm:block table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Value / Primary Identifier</th>
                    <th>Context / Attributes</th>
                    <th>Resolution Status</th>
                    <th>Confidence</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((ent, i) => (
                    <tr key={i}>
                      <td>
                        <span className="badge bg-zinc-100 border-zinc-200 text-zinc-800 font-mono">
                          {(ent.type || '').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="font-semibold text-black">{ent.name}</td>
                      <td className="text-zinc-600 text-xs truncate max-w-xs">{ent.details}</td>
                      <td>
                        <span className={`badge ${ent.status === 'RESOLVED' ? 'badge-success' : 'badge-high'}`}>
                          {ent.status}
                        </span>
                      </td>
                      <td className="font-mono font-semibold text-black text-xs">{ent.confidence}</td>
                      <td>
                        <Link
                          to="/network"
                          id={`entity-audit-btn-${i}`}
                          className="text-xs font-medium text-black hover:underline cursor-pointer"
                        >
                          Audit Links →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile View */}
            <div className="sm:hidden divide-y divide-zinc-100">
              {filtered.map((ent, i) => (
                <div key={i} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="badge bg-zinc-100 border-zinc-200 text-zinc-800 font-mono mb-1">
                        {(ent.type || '').replace(/_/g, ' ')}
                      </span>
                      <p className="font-semibold text-xs text-black mt-1">{ent.name}</p>
                    </div>
                    <span className={`badge ${ent.status === 'RESOLVED' ? 'badge-success' : 'badge-high'}`}>
                      {ent.status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500">{ent.details}</p>
                  <div className="flex items-center justify-between pt-2 border-t border-zinc-100 text-xs">
                    <span className="text-zinc-400 font-mono text-[10px]">Confidence: {ent.confidence}</span>
                    <Link to="/network" className="text-xs font-medium text-black hover:underline">Audit Links →</Link>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
