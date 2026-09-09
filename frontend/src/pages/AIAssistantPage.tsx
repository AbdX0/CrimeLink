import { useState, useEffect, useRef } from 'react';
import CrimeGraphLogo from '../components/CrimeGraphLogo';
import { listSourceRecords } from '../api/client';
import type { SourceRecordListItem } from '../api/types';

interface Message {
  id: string;
  sender: 'USER' | 'AI';
  text: string;
  time: string;
}

export default function AIAssistantPage() {
  const [records, setRecords] = useState<SourceRecordListItem[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  const [inputQuery, setInputQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'AI',
      text: 'Welcome to CrimeLink Assistant. Select an active investigation envelope above to query evidence-grounded intelligence.',
      time: 'Just now',
    },
    {
      id: 'notice',
      sender: 'AI',
      text: 'Note: External LLM Chat generation endpoint is not configured on the CrimeLink FastAPI backend. All deterministic NLP entity extraction, resolution, and graph network queries are available directly across the platform.',
      time: 'System',
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadCases() {
      try {
        const data = await listSourceRecords(20, 0);
        setRecords(data || []);
        if (data && data.length > 0) {
          setSelectedCaseId(data[0].id.toString());
        }
      } catch (err) {
        console.error('Failed to load cases:', err);
      }
    }
    loadCases();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    const queryText = customQuery || inputQuery;
    if (!queryText.trim()) return;

    const userMsg: Message = {
      id: `usr-${Date.now()}`,
      sender: 'USER',
      text: queryText.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const aiReply: Message = {
      id: `ai-${Date.now()}`,
      sender: 'AI',
      text: `[FastAPI Backend Notice] LLM natural-language chat generation is not configured on this CrimeLink backend instance. To inspect entities and relationships for "${queryText.trim()}", please use the Entities Database or Network Analysis graph.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg, aiReply]);
    setInputQuery('');
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto flex flex-col h-[calc(100vh-140px)] pb-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 pb-4 border-b border-zinc-200">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-black">AI Assistant</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Query evidence-grounded intelligence and syndicate link hypotheses.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-zinc-600">Active Envelope:</label>
          <select
            value={selectedCaseId}
            onChange={(e) => setSelectedCaseId(e.target.value)}
            className="form-select text-xs font-mono py-1 px-2.5 w-48"
          >
            {records.map((r) => (
              <option key={r.id} value={r.id.toString()}>
                CASE #{r.id} — {r.title || `Record #${r.id}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Chat Messages Log */}
      <div className="flex-1 card p-5 overflow-y-auto space-y-4 bg-zinc-50/50">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex items-start gap-3 ${m.sender === 'USER' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-mono ${
                m.sender === 'USER'
                  ? 'bg-emerald-500 text-zinc-950 font-bold'
                  : 'bg-[#141418] border border-zinc-800 text-white'
              }`}
            >
              {m.sender === 'USER' ? 'U' : <CrimeGraphLogo size={14} showText={false} />}
            </div>

            <div
              className={`max-w-xl p-3.5 rounded-lg text-xs leading-relaxed space-y-1 ${
                m.sender === 'USER'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-[#141418] border border-zinc-800 text-zinc-100 shadow-md'
              }`}
            >
              <p>{m.text}</p>
              <p className={`text-[9px] font-mono ${m.sender === 'USER' ? 'text-emerald-200' : 'text-zinc-500'}`}>
                {m.time}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={(e) => handleSend(e)} className="flex items-center gap-2 shrink-0">
        <input
          type="text"
          placeholder="Ask a question about connected suspects, shared phone numbers, or fund transfers…"
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          className="form-input text-xs flex-1"
        />
        <button type="submit" className="btn-primary text-xs px-5 py-2 shrink-0 cursor-pointer">
          Send Query
        </button>
      </form>
    </div>
  );
}
