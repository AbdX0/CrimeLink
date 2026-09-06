import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import CrimeGraphLoader from '../components/CrimeGraphLoader';
import { listSourceRecords, deleteSourceRecord } from '../api/client';
import type { SourceRecordListItem } from '../api/types';

export default function CasesPage() {
  const [records, setRecords] = useState<SourceRecordListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchCases = async () => {
    setLoading(true);
    try {
      const data = await listSourceRecords(50, 0);
      setRecords(data || []);
    } catch (err) {
      console.error('Failed to load cases:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, []);

  const handleDelete = async (id: number) => {
    const confirmed = window.confirm("Delete this case and all associated investigation data?");
    if (!confirmed) return;

    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteSourceRecord(id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete case.');
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = records.filter((r) => {
    const title = r.title || `Case #${r.id}`;
    const matchesSearch = !search || title.toLowerCase().includes(search.toLowerCase());
    const matchesType = !typeFilter || r.source_type?.toUpperCase() === typeFilter.toUpperCase();
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            Investigation Cases
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
            Search, allocate, and correlate intelligence networks across investigative envelopes.
          </p>
        </div>
        <Link
          to="/cases/create"
          id="create-case-btn"
          className="btn-primary text-xs px-4 py-2 shrink-0"
        >
          + New Case
        </Link>
      </div>

      {deleteError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-xs">
          {deleteError}
        </div>
      )}

      {/* Filters Pane */}
      <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <div>
          <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1">Search</label>
          <input
            type="text"
            placeholder="Title, case identifier…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input text-xs"
          />
        </div>

        <div>
          <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1">Classification</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="form-select text-xs"
          >
            <option value="">All Document Envelopes</option>
            <option value="PDF">PDF Reports</option>
            <option value="TXT">TXT / Case Files</option>
            <option value="CSV">CSV CDR / Financial</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1">Status</label>
          <select className="form-select text-xs">
            <option value="">All Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>
      </div>

      {/* Main Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center">
            <CrimeGraphLoader size={28} text="Loading investigation cases…" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <p className="text-xs font-semibold text-black">No investigation envelopes found</p>
            <p className="text-xs text-zinc-500">Create a case envelope or ingest evidence datasets to begin.</p>
            <Link to="/cases/create" className="btn-primary text-xs inline-flex px-4 py-2 mt-2">
              Create Case
            </Link>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Case Identifier</th>
                  <th>Title</th>
                  <th>Envelope Type</th>
                  <th>Status</th>
                  <th>Created At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono text-black font-semibold text-xs">CASE-2026-{c.id.toString().padStart(4, '0')}</td>
                    <td className="font-semibold text-black max-w-xs truncate">
                      {c.title || `Investigation Envelope #${c.id}`}
                    </td>
                    <td>
                      <span className="badge bg-zinc-100 text-zinc-800 font-mono">
                        {c.source_type || 'CASE_FILE'}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-success">ACTIVE</span>
                    </td>
                    <td className="text-zinc-400 text-[11px] font-mono">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <Link to={`/cases/${c.id}`} className="text-xs font-medium text-black hover:underline">
                          View Details →
                        </Link>
                        <button
                          onClick={() => handleDelete(c.id)}
                          disabled={deletingId === c.id}
                          className="text-xs font-medium text-red-600 hover:text-red-800 hover:underline cursor-pointer disabled:opacity-50"
                        >
                          {deletingId === c.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </td>
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
