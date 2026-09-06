import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import CrimeGraphLoader from '../components/CrimeGraphLoader';
import { getSourceRecord, extractEntities, resolveSourceRecord, deleteSourceRecord } from '../api/client';
import type { SourceRecord, EntityExtractionResponse, ResolutionResult } from '../api/types';

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const recordId = parseInt(id || '0', 10);
  const navigate = useNavigate();

  const [record, setRecord] = useState<SourceRecord | null>(null);
  const [entities, setEntities] = useState<EntityExtractionResponse | null>(null);
  const [resolutions, setResolutions] = useState<ResolutionResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'entities' | 'text'>('overview');

  const handleDelete = async () => {
    const confirmed = window.confirm("Delete this case and all associated investigation data?");
    if (!confirmed) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSourceRecord(recordId);
      navigate('/cases');
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete case.');
      setDeleting(false);
    }
  };

  useEffect(() => {
    async function loadCase() {
      if (!recordId) return;
      setLoading(true);
      try {
        const [recRes, entRes, resRes] = await Promise.allSettled([
          getSourceRecord(recordId),
          extractEntities(recordId),
          resolveSourceRecord(recordId),
        ]);

        if (recRes.status === 'fulfilled') setRecord(recRes.value);
        if (entRes.status === 'fulfilled') setEntities(entRes.value);
        if (resRes.status === 'fulfilled') setResolutions(resRes.value);
      } catch (err) {
        console.error('Failed to load case detail:', err);
      } finally {
        setLoading(false);
      }
    }
    loadCase();
  }, [recordId]);

  if (loading) {
    return (
      <div className="p-16 flex justify-center">
        <CrimeGraphLoader size={32} text="Loading case envelope parameters…" />
      </div>
    );
  }

  if (!record) {
    return (
      <div className="card p-12 text-center space-y-3">
        <p className="text-sm font-semibold text-black">Case record not found</p>
        <Link to="/cases" className="btn-secondary text-xs inline-flex px-3.5 py-1.5">
          ← Back to Cases
        </Link>
      </div>
    );
  }

  const caseNumber = `CASE-2026-${record.id.toString().padStart(4, '0')}`;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {deleteError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-xs">
          {deleteError}
        </div>
      )}

      {/* Header */}
      <div className="border-b border-zinc-200 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="badge bg-zinc-900 text-white font-mono">{caseNumber}</span>
            <span className="badge badge-success">ACTIVE</span>
            <span className="badge bg-zinc-100 text-zinc-700 font-mono">{record.source_type || 'TXT'}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-black mt-2">
            {record.title || `Investigation Envelope #${record.id}`}
          </h1>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            Record ID: #{record.id} • Ingested: {new Date(record.created_at).toLocaleString()}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="btn-secondary border-red-300 text-red-600 hover:bg-red-50 text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : '🗑 Delete Case'}
          </button>
          <Link to="/network" className="btn-primary text-xs px-3.5 py-1.5">
            🕸 Analyze Link Graph
          </Link>
          <Link to="/cases" className="btn-secondary text-xs px-3.5 py-1.5">
            ← Cases Directory
          </Link>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-200 pb-px">
        {[
          { key: 'overview', label: 'Overview & Resolution' },
          { key: 'entities', label: `Extracted Entities (${entities?.entities?.length ?? 0})` },
          { key: 'text', label: 'Source Evidence Text' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-3 py-2 text-xs font-medium border-b-2 cursor-pointer transition-colors ${
              activeTab === tab.key
                ? 'border-black text-black'
                : 'border-transparent text-zinc-500 hover:text-black'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="card p-5 space-y-3">
              <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-2">
                Resolved Entities & Cluster Mapping
              </h2>
              {resolutions.length === 0 ? (
                <p className="text-xs text-zinc-500 py-4 text-center">No entity resolution clusters generated yet.</p>
              ) : (
                <div className="divide-y divide-zinc-100">
                  {resolutions.map((res, i) => (
                    <div key={i} className="py-2.5 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-semibold text-black">{res.entity_text}</span>
                        <span className="badge bg-zinc-100 text-zinc-700 font-mono text-[9px] ml-2">
                          {res.entity_type}
                        </span>
                        <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                          Normalized: {res.normalized_value} • Matches: {res.resolved_with?.length ?? 0}
                        </p>
                      </div>
                      <span className="badge badge-success font-mono">
                        {res.resolution_status || 'RESOLVED'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-2">
              Envelope Summary
            </h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-500">Record ID:</span>
                <span className="font-mono font-semibold text-black">#{record.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Source Type:</span>
                <span className="font-mono text-black">{record.source_type}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">NLP Entities:</span>
                <span className="font-mono text-black">{entities?.entities?.length ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Resolved Clusters:</span>
                <span className="font-mono text-black">{resolutions.length}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'entities' && (
        <div className="card overflow-hidden">
          {(!entities?.entities || entities.entities.length === 0) ? (
            <div className="p-8 text-center text-xs text-zinc-500">No NLP entities extracted.</div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Extracted Text</th>
                    <th>Confidence</th>
                    <th>Character Offset</th>
                  </tr>
                </thead>
                <tbody>
                  {entities.entities.map((e, idx) => (
                    <tr key={idx}>
                      <td>
                        <span className="badge bg-zinc-100 text-zinc-800 font-mono">{e.entity_type}</span>
                      </td>
                      <td className="font-semibold text-black">{e.entity_text}</td>
                      <td className="font-mono text-xs">{e.confidence ? `${(e.confidence * 100).toFixed(0)}%` : '100%'}</td>
                      <td className="font-mono text-zinc-400 text-xs">
                        [{e.start}:{e.end}]
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'text' && (
        <div className="card p-5 space-y-2">
          <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-2">
            Raw Document Ingestion Text
          </h2>
          <pre className="p-4 bg-zinc-50 border border-zinc-200 rounded text-xs font-mono text-zinc-800 whitespace-pre-wrap max-h-[500px] overflow-y-auto leading-relaxed">
            {record.content || 'No raw text content captured.'}
          </pre>
        </div>
      )}
    </div>
  );
}
