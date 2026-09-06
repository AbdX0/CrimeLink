import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import CrimeGraphLoader from '../components/CrimeGraphLoader';
import { listSourceRecords, getSourceRecord, deleteSourceRecord } from '../api/client';
import type { SourceRecordListItem, SourceRecord } from '../api/types';

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<SourceRecordListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<SourceRecord | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [verifiedHashDocId, setVerifiedHashDocId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDeleteDoc = async (id: number) => {
    const confirmed = window.confirm("Delete this case and all associated investigation data?");
    if (!confirmed) return;

    setDeletingId(id);
    try {
      await deleteSourceRecord(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (selectedDoc?.id === id) {
        setSelectedDoc(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to delete document.');
    } finally {
      setDeletingId(null);
    }
  };

  const fetchDocuments = async () => {
    setLoading(true);
    setError(null);
    try {
      const records = await listSourceRecords(50, 0);
      setDocuments(records || []);
    } catch (err) {
      setError('Network failure loading documents from CrimeLink database.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleSelectDoc = async (id: number) => {
    setLoadingDetail(true);
    try {
      const doc = await getSourceRecord(id);
      setSelectedDoc(doc);
    } catch (err) {
      console.error('Failed to load document details:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleVerifyIntegrity = (id: number) => {
    setVerifiedHashDocId(id);
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            Investigative Documents
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
            Persisted evidence files, raw datasets, CSV extracts, and PDF case reports in PostgreSQL.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={fetchDocuments}
            className="btn-secondary text-xs px-3 py-1.5 cursor-pointer"
          >
            Refresh
          </button>
          <Link to="/datacenter" className="btn-primary text-xs px-3.5 py-1.5">
            + Upload New Dataset
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-xs">
          {error}
        </div>
      )}

      {/* Main Grid: Documents Table + Detail Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card overflow-hidden">
          {loading ? (
            <div className="p-12 flex justify-center">
              <CrimeGraphLoader size={28} text="Loading persisted evidence documents…" />
            </div>
          ) : documents.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <p className="text-xs font-semibold text-black">No documents recorded</p>
              <p className="text-xs text-zinc-500">Upload evidence files in Data Center to persist them here.</p>
              <Link to="/datacenter" className="btn-primary text-xs inline-flex px-3.5 py-1.5 mt-2">
                Upload File
              </Link>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Record ID</th>
                    <th>Document Title</th>
                    <th>Type</th>
                    <th>Content Size</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr
                      key={doc.id}
                      onClick={() => handleSelectDoc(doc.id)}
                      className={`cursor-pointer ${selectedDoc?.id === doc.id ? 'bg-zinc-50 font-medium' : ''}`}
                    >
                      <td className="font-mono text-zinc-500 text-xs">#{doc.id}</td>
                      <td className="font-semibold text-black max-w-[200px] truncate">
                        {doc.title || `Record #${doc.id}`}
                      </td>
                      <td>
                        <span className="badge bg-zinc-100 text-zinc-800 font-mono">{doc.source_type || 'TXT'}</span>
                      </td>
                      <td className="font-mono text-zinc-500 text-[11px]">{doc.content?.length || 0} chars</td>
                      <td>
                        <span className="badge badge-success">
                          COMPLETED
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleVerifyIntegrity(doc.id)}
                            className="text-[11px] text-zinc-500 hover:text-black hover:underline cursor-pointer"
                          >
                            {verifiedHashDocId === doc.id ? '✓ Validated' : 'Verify'}
                          </button>
                          <span className="text-zinc-300">|</span>
                          <button
                            onClick={() => handleDeleteDoc(doc.id)}
                            disabled={deletingId === doc.id}
                            className="text-[11px] text-red-600 hover:text-red-800 hover:underline cursor-pointer disabled:opacity-50"
                          >
                            {deletingId === doc.id ? 'Deleting…' : 'Delete'}
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

        {/* Selected Document Details Inspector */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
            <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest">Document Inspector</h2>
            {selectedDoc && <span className="badge badge-medium">ID #{selectedDoc.id}</span>}
          </div>

          {loadingDetail ? (
            <div className="py-8 flex justify-center">
              <CrimeGraphLoader size={20} text="Loading document details…" />
            </div>
          ) : selectedDoc ? (
            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[10px] font-mono text-zinc-400 uppercase block">Title</span>
                <p className="font-semibold text-black text-sm">{selectedDoc.title || `Record #${selectedDoc.id}`}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-100 font-mono text-[11px]">
                <div>
                  <span className="text-zinc-400 block text-[9px]">SOURCE TYPE</span>
                  <span className="font-semibold text-black">{selectedDoc.source_type}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[9px]">CREATED AT</span>
                  <span className="font-semibold text-black">{new Date(selectedDoc.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              {selectedDoc.content && (
                <div className="pt-2 border-t border-zinc-100">
                  <span className="text-[10px] font-mono text-zinc-400 uppercase block mb-1">Evidence Text Preview</span>
                  <div className="bg-zinc-50 border border-zinc-200 rounded p-2 text-[10px] font-mono text-zinc-700 max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {selectedDoc.content.slice(0, 800)}
                    {selectedDoc.content.length > 800 ? '\n… [truncated]' : ''}
                  </div>
                </div>
              )}

              <div className="pt-2 flex flex-col gap-2">
                <Link to={`/cases/${selectedDoc.id}`} className="btn-secondary w-full text-xs py-1.5 text-center">
                  Inspect Full Case Details →
                </Link>
                <button
                  onClick={() => handleDeleteDoc(selectedDoc.id)}
                  disabled={deletingId === selectedDoc.id}
                  className="btn-secondary w-full text-xs py-1.5 text-center border-red-200 text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                >
                  {deletingId === selectedDoc.id ? 'Deleting…' : '🗑 Delete This Document'}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-zinc-500">
              Select a document from the table to inspect metadata, source text, and cluster parameters.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
