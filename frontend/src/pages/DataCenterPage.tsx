import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import CrimeGraphLogo from '../components/CrimeGraphLogo';
import CrimeGraphLoader from '../components/CrimeGraphLoader';
import {
  processPipelineFile,
  listSourceRecords,
  deleteSourceRecord,
} from '../api/client';
import type {
  SourceRecordListItem,
  PipelineProcessResponse,
} from '../api/types';
import { showToast } from '../utils/toast';
import { emitPushNotification } from '../components/NotificationBell';

export default function DataCenterPage() {
  const [dataClassification, setDataClassification] = useState('FIR_REPORTS');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [recordTitle, setRecordTitle] = useState('');

  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState<
    'IDLE' | 'SELECTED' | 'UPLOADING' | 'UPLOADED' | 'INGESTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  >('IDLE');
  const [dragActive, setDragActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedStage, setFailedStage] = useState<string | null>(null);

  // Successful Upload Telemetry State
  const [uploadSuccessPayload, setUploadSuccessPayload] = useState<{
    recordId: number;
    filename: string;
    entitiesExtracted: number;
    entitiesResolved: number;
    nodesCreated: number;
    relationshipsCreated: number;
  } | null>(null);

  // Persistent Recently Uploaded list from DB
  const [recentDocuments, setRecentDocuments] = useState<SourceRecordListItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteDocError, setDeleteDocError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchRecentDocuments = async () => {
    setLoadingRecent(true);
    try {
      const records = await listSourceRecords(20, 0);
      setRecentDocuments(records || []);
    } catch (err) {
      console.error('Failed to fetch recent documents:', err);
    } finally {
      setLoadingRecent(false);
    }
  };

  const handleDeleteRecent = async (id: number) => {
    const confirmed = window.confirm("Delete this case and all associated investigation data?");
    if (!confirmed) return;

    setDeletingId(id);
    setDeleteDocError(null);
    try {
      await deleteSourceRecord(id);
      setRecentDocuments((prev) => prev.filter((d) => d.id !== id));
      showToast.success('Record Removed', `Evidence document #${id} purged successfully.`);
    } catch (err: any) {
      const msg = err?.message || 'Failed to delete record.';
      setDeleteDocError(msg);
      showToast.error('Deletion Failed', msg);
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    fetchRecentDocuments();
  }, []);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const files = Array.from(e.dataTransfer.files);
      setSelectedFiles((prev) => [...prev, ...files]);
      if (!recordTitle && files[0]) {
        setRecordTitle(files[0].name.replace(/\.[^/.]+$/, ''));
      }
      setUploadStage('SELECTED');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      setSelectedFiles((prev) => [...prev, ...files]);
      if (!recordTitle && files[0]) {
        setRecordTitle(files[0].name.replace(/\.[^/.]+$/, ''));
      }
      setUploadStage('SELECTED');
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      if (updated.length === 0) {
        setUploadStage('IDLE');
        setRecordTitle('');
      }
      return updated;
    });
  };

  const handleStartIngestion = async () => {
    setErrorMessage(null);
    setFailedStage(null);
    setUploadSuccessPayload(null);

    if (selectedFiles.length === 0) {
      setErrorMessage('Please select at least one evidence dataset file to ingest.');
      setFailedStage('FILE_SELECTION');
      setUploadStage('FAILED');
      return;
    }

    setUploading(true);
    setUploadStage('UPLOADING');
    const toastId = showToast.loading(`Ingesting "${recordTitle.trim() || selectedFiles[0].name}"...`);

    try {
      const fileToUpload = selectedFiles[0];
      setUploadStage('UPLOADED');

      // Processing through real CrimeLink pipeline
      setUploadStage('INGESTED');
      setUploadStage('PROCESSING');

      const title = recordTitle.trim() || fileToUpload.name;
      const resp: PipelineProcessResponse = await processPipelineFile(fileToUpload, title);

      const entitiesCount = resp.entities?.length || 0;
      const nodesCount = resp.graph?.nodes_created || 0;

      setUploadSuccessPayload({
        recordId: resp.source_record_id,
        filename: fileToUpload.name,
        entitiesExtracted: entitiesCount,
        entitiesResolved: resp.resolution?.entities_resolved || 0,
        nodesCreated: nodesCount,
        relationshipsCreated: resp.graph?.relationships_created || 0,
      });

      setUploadStage('COMPLETED');
      setSelectedFiles([]);
      setRecordTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';

      showToast.dismiss(toastId);
      showToast.success('Pipeline Complete', `Extracted ${entitiesCount} entities, mapped ${nodesCount} graph nodes.`);

      emitPushNotification({
        title: 'Evidence Ingestion Complete',
        message: `Dataset "${title}" processed: ${entitiesCount} entities extracted, ${nodesCount} network nodes created.`,
        severity: 'SUCCESS',
        link: '/network',
      });

      fetchRecentDocuments();
    } catch (err: any) {
      showToast.dismiss(toastId);
      const errMsg = err?.message || 'Ingestion pipeline rejected the uploaded file.';
      setErrorMessage(errMsg);
      showToast.error('Pipeline Extraction Error', errMsg);
      setFailedStage('PIPELINE_EXTRACTION');
      setUploadStage('FAILED');
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytesStr: string | number) => {
    const num = typeof bytesStr === 'string' ? parseInt(bytesStr, 10) : bytesStr;
    if (isNaN(num) || num === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(num) / Math.log(k));
    return parseFloat((num / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Data Center</h1>
        <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
          Ingest raw cyber crime datasets — CDRs, bank transaction ledgers, incident reports — for AI extraction and automatic case linking.
        </p>
      </div>

      {/* MULTI-STAGE PIPELINE STEPPER VISUALIZATION */}
      {/* MULTI-STAGE PIPELINE STEPPER VISUALIZATION */}
      <div className="card p-4 bg-[#121215] border border-zinc-800">
        <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 touch-scroll">
          {[
            { step: '1', title: 'File Selected', stageKey: 'SELECTED' },
            { step: '2', title: 'Uploading', stageKey: 'UPLOADING' },
            { step: '3', title: 'Uploaded', stageKey: 'UPLOADED' },
            { step: '4', title: 'Ingested', stageKey: 'INGESTED' },
            { step: '5', title: 'Processing', stageKey: 'PROCESSING' },
            { step: '6', title: 'Completed / Failed', stageKey: uploadStage === 'FAILED' ? 'FAILED' : 'COMPLETED' },
          ].map((st, idx) => {
            const isCurrent = uploadStage === st.stageKey;
            const isCompleted =
              ['COMPLETED', 'INGESTED', 'PROCESSING'].includes(uploadStage) && st.stageKey !== 'FAILED';
            const isError = uploadStage === 'FAILED' && st.stageKey === 'FAILED';

            return (
              <div key={st.step} className="flex items-center gap-2 shrink-0">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold transition-colors ${
                    isError
                      ? 'bg-red-600 text-white'
                      : isCurrent
                      ? 'bg-emerald-500 text-zinc-950 shadow-xs animate-pulse font-extrabold'
                      : isCompleted
                      ? 'bg-emerald-600 text-white'
                      : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                  }`}
                >
                  {isError ? '✕' : isCompleted ? '✓' : st.step}
                </div>
                <span
                  className={`text-xs font-medium whitespace-nowrap ${
                    isError
                      ? 'text-red-400 font-semibold'
                      : isCurrent
                      ? 'text-emerald-400 font-semibold'
                      : 'text-zinc-400'
                  }`}
                >
                  {st.title}
                </span>
                {idx < 5 && <div className="h-px w-6 sm:w-12 bg-zinc-800 shrink-0 hidden xs:block ml-2" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* ERROR / FAILED TELEMETRY PANEL */}
      {uploadStage === 'FAILED' && errorMessage && (
        <div className="card p-5 border-red-900/50 bg-red-950/30 space-y-3 relative">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-red-900/40 border border-red-700/50 text-red-300 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-red-300">Pipeline Execution Failed</h3>
                <p className="text-xs text-red-400 mt-0.5 font-mono">
                  Failed Stage: <span className="font-bold">{failedStage || 'INGESTION'}</span>
                </p>
              </div>
            </div>
            <button onClick={() => setUploadStage('IDLE')} className="text-xs text-red-400 hover:text-white p-1 cursor-pointer">✕</button>
          </div>
          <p className="text-xs text-red-300 bg-zinc-900/80 border border-red-900/40 p-2.5 rounded font-mono leading-relaxed">
            {errorMessage}
          </p>
          <div className="pt-1 flex justify-end">
            <button
              onClick={handleStartIngestion}
              className="btn-primary bg-red-700 hover:bg-red-800 text-xs px-3.5 py-1.5 cursor-pointer"
            >
              🔄 Retry Extraction
            </button>
          </div>
        </div>
      )}

      {/* SUCCESS TELEMETRY PANEL */}
      {uploadSuccessPayload && (
        <div className="card p-6 border-emerald-500/30 bg-emerald-950/20 space-y-4 relative overflow-hidden">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-900/40 border border-emerald-500/40 text-emerald-300 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Dataset Upload & AI Ingestion Successful</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Record #{uploadSuccessPayload.recordId} persisted to PostgreSQL and populated in Neo4j knowledge graph.
                </p>
              </div>
            </div>
            <button
              onClick={() => setUploadSuccessPayload(null)}
              className="text-xs text-zinc-400 hover:text-white p-1 rounded cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Document Telemetry Records */}
          <div className="bg-[#101014] border border-zinc-800 rounded-md p-3 text-xs space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex items-center gap-2.5">
                <span className="badge bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono">ID #{uploadSuccessPayload.recordId}</span>
                <span className="font-semibold text-white truncate">{uploadSuccessPayload.filename}</span>
              </div>
              <span className="badge badge-success font-mono shrink-0">COMPLETED</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-zinc-800 text-[11px] font-mono">
              <div className="p-2 bg-zinc-900/60 rounded border border-zinc-800/50">
                <span className="text-zinc-500 block text-[9px]">EXTRACTED</span>
                <span className="font-bold text-emerald-400">{uploadSuccessPayload.entitiesExtracted} Entities</span>
              </div>
              <div className="p-2 bg-zinc-900/60 rounded border border-zinc-800/50">
                <span className="text-zinc-500 block text-[9px]">RESOLVED</span>
                <span className="font-bold text-emerald-400">{uploadSuccessPayload.entitiesResolved} Entities</span>
              </div>
              <div className="p-2 bg-zinc-900/60 rounded border border-zinc-800/50">
                <span className="text-zinc-500 block text-[9px]">NODES CREATED</span>
                <span className="font-bold text-emerald-400">{uploadSuccessPayload.nodesCreated} Nodes</span>
              </div>
              <div className="p-2 bg-zinc-900/60 rounded border border-zinc-800/50">
                <span className="text-zinc-500 block text-[9px]">EDGES CREATED</span>
                <span className="font-bold text-emerald-400">{uploadSuccessPayload.relationshipsCreated} Edges</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <Link to="/documents" className="btn-primary text-xs py-1.5 px-3.5">
              View Documents
            </Link>
            <Link to="/network" className="btn-secondary text-xs py-1.5 px-3.5">
              View Network Graph
            </Link>
            <Link to="/processing" className="btn-secondary text-xs py-1.5 px-3.5">
              View Processing Queue
            </Link>
            <button
              onClick={() => {
                setUploadSuccessPayload(null);
                setUploadStage('IDLE');
              }}
              className="btn-secondary text-xs py-1.5 px-3.5 ml-auto cursor-pointer"
            >
              Upload Another
            </button>
          </div>
        </div>
      )}

      {/* Main Upload & Settings Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Drag & Drop Zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`lg:col-span-2 upload-zone flex flex-col items-center justify-center min-h-[300px] p-8 text-center transition-all ${
            dragActive ? 'drag-active' : ''
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".pdf,.csv,.xlsx,.json,.txt"
            className="hidden"
          />

          <div className="w-12 h-12 bg-zinc-100 border border-zinc-200 rounded-lg text-black flex items-center justify-center mb-4">
            <svg className="w-6 h-6 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>

          <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Select or drag dataset files</p>
          <p className="text-xs text-[var(--text-secondary)] mb-4 max-w-xs leading-relaxed">
            Upload CDRs, bank logs, or incident reports. Max 50 MB per file.
          </p>

          <div className="flex items-center gap-1.5 mb-5 flex-wrap justify-center">
            {['PDF', 'CSV', 'XLSX', 'JSON', 'TXT'].map((ext) => (
              <span key={ext} className="badge bg-zinc-100 border-zinc-200 text-zinc-700 font-mono text-[10px]">
                {ext}
              </span>
            ))}
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="btn-secondary text-xs px-4 py-2 cursor-pointer"
          >
            Browse Files
          </button>

          {/* Selected files preview */}
          {selectedFiles.length > 0 && (
            <div className="w-full mt-6 text-left border-t border-zinc-100 pt-4 space-y-2">
              <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
                Selected Files ({selectedFiles.length})
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {selectedFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs p-2 bg-zinc-50 border border-zinc-200 rounded">
                    <div className="truncate pr-2">
                      <span className="font-semibold text-black">{file.name}</span>
                      <span className="text-[10px] text-zinc-400 font-mono ml-2">({formatFileSize(file.size)})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="text-zinc-400 hover:text-red-600 text-xs shrink-0 cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Configuration Panel */}
        <div className="card p-5 space-y-5">
          <div>
            <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest mb-1">Target Configuration</h2>
            <p className="text-xs text-zinc-500">Associate evidence dataset with intelligence pipeline.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1" htmlFor="record-title">
                Record Title / Label
              </label>
              <input
                id="record-title"
                type="text"
                placeholder="e.g. FIR-2026-Noida-Cyber"
                value={recordTitle}
                onChange={(e) => setRecordTitle(e.target.value)}
                className="form-input text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                Data Category
              </label>
              <select
                value={dataClassification}
                onChange={(e) => setDataClassification(e.target.value)}
                className="form-select text-xs"
              >
                <option value="FIR_REPORTS">FIR & Incident Reports</option>
                <option value="CDR">Call Detail Records (CDR)</option>
                <option value="BANK_STATEMENTS">Bank Account Transactions</option>
                <option value="FORENSIC_EXPORTS">Digital Forensics / Device Logs</option>
                <option value="OTHER">Other Intelligence Evidence</option>
              </select>
            </div>
          </div>

          <div className="pt-2">
            <button
              id="datacenter-start-btn"
              type="button"
              onClick={handleStartIngestion}
              disabled={uploading || selectedFiles.length === 0}
              className="btn-primary w-full justify-center py-2.5 disabled:opacity-50 text-xs cursor-pointer"
            >
              {uploading ? (
                <>
                  <CrimeGraphLogo size={14} showText={false} className="animate-crimegraph-pulse" />
                  <span>Ingesting Dataset…</span>
                </>
              ) : (
                <span>Start Ingestion</span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* PERSISTENT RECENTLY UPLOADED SECTION (Database-backed) */}
      <div className="card overflow-hidden">
        {deleteDocError && (
          <div className="p-3 bg-red-50 border-b border-red-200 text-red-700 text-xs">
            {deleteDocError}
          </div>
        )}
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-black">Recently Uploaded Datasets</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Persisted evidence files stored in CrimeLink PostgreSQL backend.</p>
          </div>
          <button
            onClick={fetchRecentDocuments}
            className="btn-secondary text-[11px] py-1 px-2.5 cursor-pointer"
          >
            Refresh List
          </button>
        </div>

        {loadingRecent ? (
          <div className="p-8 flex justify-center">
            <CrimeGraphLoader size={24} text="Loading recent dataset records from database…" />
          </div>
        ) : recentDocuments.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500">No dataset uploads recorded in database yet.</div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Record ID</th>
                  <th>Document Title</th>
                  <th>Source Type</th>
                  <th>Content Size</th>
                  <th>Extraction Engine</th>
                  <th>Upload Time</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentDocuments.map((doc) => (
                  <tr key={doc.id}>
                    <td className="font-mono text-zinc-500 text-xs">#{doc.id}</td>
                    <td className="font-semibold text-black max-w-[220px] truncate">{doc.title || `Record #${doc.id}`}</td>
                    <td>
                      <span className="badge bg-zinc-100 text-zinc-800 font-mono">{doc.source_type || 'TXT'}</span>
                    </td>
                    <td className="font-mono text-zinc-500 text-[11px]">{doc.content?.length || 0} chars</td>
                    <td>
                      <span className="badge bg-zinc-100 text-zinc-800 font-mono">
                        AI NLP
                      </span>
                    </td>
                    <td className="text-zinc-400 text-[11px]">
                      {new Date(doc.created_at).toLocaleString()}
                    </td>
                    <td>
                      <span className="badge badge-success">
                        COMPLETED
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Link to={`/cases/${doc.id}`} className="text-xs font-semibold text-black hover:underline">
                          View
                        </Link>
                        <span className="text-zinc-300">|</span>
                        <Link to="/network" className="text-xs text-zinc-500 hover:text-black hover:underline">
                          Graph
                        </Link>
                        <span className="text-zinc-300">|</span>
                        <button
                          onClick={() => handleDeleteRecent(doc.id)}
                          disabled={deletingId === doc.id}
                          className="text-xs text-red-600 hover:text-red-800 hover:underline cursor-pointer disabled:opacity-50"
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
    </div>
  );
}
