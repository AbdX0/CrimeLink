import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import CrimeGraphLoader from '../components/CrimeGraphLoader';
import { listSourceRecords } from '../api/client';
import type { SourceRecordListItem } from '../api/types';

export default function ProcessingPage() {
  const [records, setRecords] = useState<SourceRecordListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    try {
      const data = await listSourceRecords(20, 0);
      setRecords(data || []);
    } catch (err) {
      console.error('Failed to load processing telemetry:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
            Processing Monitor
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
            Monitor background validation, registration, and AI parsing telemetry queues.
          </p>
        </div>
        <Link to="/datacenter" className="btn-primary text-xs px-3.5 py-1.5 shrink-0">
          + Ingest Dataset
        </Link>
      </div>

      {loading && records.length === 0 ? (
        <div className="p-12 flex justify-center">
          <CrimeGraphLoader size={32} text="Loading processing job queue telemetry…" />
        </div>
      ) : records.length === 0 ? (
        <div className="card p-12 text-center space-y-3">
          <div className="w-10 h-10 bg-zinc-100 border border-zinc-200 rounded-md text-zinc-500 flex items-center justify-center mx-auto">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
            </svg>
          </div>
          <p className="text-xs font-semibold text-black">No active processing jobs recorded</p>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            Upload synthetic datasets in Data Center to start processing tasks.
          </p>
          <Link to="/datacenter" className="btn-primary text-xs inline-flex px-4 py-2 mt-2">
            Upload Dataset
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {records.map((rec) => (
            <div key={rec.id} className="card p-5 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-zinc-100">
                <div>
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">Pipeline Job ID</span>
                  <p className="text-xs font-mono font-semibold text-black truncate mt-0.5">
                    JOB-SR-{rec.id.toString().padStart(4, '0')} • {rec.title || `Record #${rec.id}`}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="badge badge-success">COMPLETED</span>
                  <span className="text-xs font-mono text-zinc-500">
                    NLP Extraction & Resolution Active
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-zinc-600">Pipeline Execution: Ingest → NLP Entities → Graph Population</span>
                  <span className="font-mono text-black">100%</span>
                </div>
                <div className="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-black h-1.5 rounded-full w-full" />
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono pt-1">
                <span>Created: {new Date(rec.created_at).toLocaleString()}</span>
                <div className="flex gap-2">
                  <Link to="/documents" className="text-black font-semibold hover:underline">
                    View Record →
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
