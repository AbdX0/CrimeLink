import React, { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import CrimeGraphLogo from '../components/CrimeGraphLogo';
import { processPipelineFile } from '../api/client';

export default function CreateCasePage() {
  const [title, setTitle] = useState('');
  const [caseType, setCaseType] = useState('CYBER_CRIME');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setAttachedFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachedFiles(Array.from(e.target.files));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Please provide a Case Title.');
      return;
    }

    setSubmitting(true);
    try {
      let fileToUpload: File;
      if (attachedFiles.length > 0) {
        fileToUpload = attachedFiles[0];
      } else {
        // Create an initial case summary text file
        const content = `CASE TITLE: ${title}\nTYPE: ${caseType}\nPRIORITY: ${priority}\n\nDESCRIPTION:\n${description || 'Investigation envelope initialized.'}`;
        const blob = new Blob([content], { type: 'text/plain' });
        fileToUpload = new File([blob], `${title.replace(/\s+/g, '_')}_case_manifest.txt`, { type: 'text/plain' });
      }

      await processPipelineFile(fileToUpload, title);
      navigate('/cases');
    } catch (err: any) {
      setError(err?.message || 'Failed to initialize case envelope.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-12">
      <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
        <div>
          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block mb-1">
            NEW INVESTIGATION
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            Open Case Envelope
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Initialize an investigation envelope for evidence ingestion and graph analysis.
          </p>
        </div>
        <Link to="/cases" className="btn-secondary text-xs px-3.5 py-1.5">
          ← Back to Cases
        </Link>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-xs">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="card p-6 space-y-4">
          <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-2">
            Case Parameters
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-700 mb-1" htmlFor="case-title">
                Case Title <span className="text-red-500">*</span>
              </label>
              <input
                id="case-title"
                type="text"
                placeholder="e.g. Operation Blue Sky — Syndicate Hawala Network"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="form-input text-xs"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                Classification Type
              </label>
              <select
                value={caseType}
                onChange={(e) => setCaseType(e.target.value)}
                className="form-select text-xs"
              >
                <option value="CYBER_CRIME">Cyber Crime</option>
                <option value="FINANCIAL_FRAUD">Financial Fraud / Hawala</option>
                <option value="ONLINE_FRAUD">Online Fraud</option>
                <option value="IDENTITY_FRAUD">Identity Theft</option>
                <option value="OTHER">Other Syndicate Crime</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                Priority Level
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="form-select text-xs"
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-zinc-700 mb-1">
                Initial Investigation Notes / Synopsis
              </label>
              <textarea
                rows={3}
                placeholder="Describe key suspects, FIR reference numbers, or intelligence leads…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="form-input text-xs h-24 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Initial Evidence Attachment Dropzone */}
        <div className="card p-6 space-y-4">
          <h2 className="text-xs font-mono text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-2">
            Initial Evidence Dataset (Optional)
          </h2>

          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`upload-zone p-6 flex flex-col items-center justify-center text-center cursor-pointer ${
              dragActive ? 'drag-active' : ''
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.csv,.xlsx,.json,.txt"
              className="hidden"
            />
            <svg className="w-8 h-8 text-zinc-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-xs font-medium text-zinc-700">Attach initial FIR, CDR, or evidence dataset</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">PDF, CSV, XLSX, TXT up to 50 MB</p>

            {attachedFiles.length > 0 && (
              <div className="mt-3 p-2 bg-zinc-100 rounded text-xs font-mono text-black">
                {attachedFiles[0].name} ({(attachedFiles[0].size / 1024).toFixed(1)} KB)
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link to="/cases" className="btn-secondary text-xs px-4 py-2">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary text-xs px-5 py-2"
          >
            {submitting ? (
              <>
                <CrimeGraphLogo size={14} showText={false} className="animate-crimegraph-pulse" />
                <span>Initializing Case…</span>
              </>
            ) : (
              <span>Create Case Envelope</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
