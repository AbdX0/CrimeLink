import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import CrimeGraphLoader from '../components/CrimeGraphLoader';
import FocusedPersonGraph from '../components/FocusedPersonGraph';
import EntityDetailDrawer from '../components/EntityDetailDrawer';
import {
  getGraphNetwork,
  getPersonsList,
  getEntityProfile,
  type GraphNode,
  type GraphEdge,
  type PersonItem,
  type EntityProfileResponse,
  type EvidenceRecordItem,
} from '../api/graph';

export default function GraphPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const personQuery = searchParams.get('person');

  // Persons directory for dropdown / search
  const [persons, setPersons] = useState<PersonItem[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [loadingPersons, setLoadingPersons] = useState(true);

  // Profile data for the selected person
  const [profile, setProfile] = useState<EntityProfileResponse | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Main Graph Network State
  const [fullNetwork, setFullNetwork] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [loadingFullNetwork, setLoadingFullNetwork] = useState(false);
  const [graphScope, setGraphScope] = useState<'focused' | '2hop' | 'full'>('focused');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [relFilter, setRelFilter] = useState<string>('ALL');
  const [graphSearch, setGraphSearch] = useState('');

  // Node Inspector Drawer
  const [drawerNode, setDrawerNode] = useState<GraphNode | null>(null);

  // Evidence Modal
  const [activeEvidence, setActiveEvidence] = useState<EvidenceRecordItem | null>(null);

  // Transaction tab filter
  const [transactionTab, setTransactionTab] = useState<'ALL' | 'INCOMING' | 'OUTGOING'>('ALL');

  // 1. Initial load: fetch all PERSON nodes
  useEffect(() => {
    async function loadPersons() {
      setLoadingPersons(true);
      try {
        const list = await getPersonsList(100);
        setPersons(list || []);
        if (list && list.length > 0) {
          if (personQuery && list.some((p) => p.id === personQuery)) {
            setSelectedPersonId(personQuery);
          } else {
            setSelectedPersonId(list[0].id);
          }
        }
      } catch (err) {
        console.error('Failed to load persons list:', err);
      } finally {
        setLoadingPersons(false);
      }
    }
    loadPersons();
  }, [personQuery]);

  // 2. Fetch Entity Profile whenever selectedPersonId changes
  useEffect(() => {
    if (!selectedPersonId) {
      setProfile(null);
      return;
    }
    async function loadProfile() {
      setLoadingProfile(true);
      setProfileError(null);
      try {
        const data = await getEntityProfile(selectedPersonId);
        setProfile(data);
      } catch (err: any) {
        console.error('Failed to load entity profile:', err);
        setProfileError(err?.message || 'Failed to load investigation profile for this person.');
      } finally {
        setLoadingProfile(false);
      }
    }
    loadProfile();
  }, [selectedPersonId]);

  // 3. Optionally fetch full network when "full" scope is requested
  useEffect(() => {
    if (graphScope === 'full' && fullNetwork.nodes.length === 0) {
      setLoadingFullNetwork(true);
      getGraphNetwork(undefined, 300)
        .then((res) => {
          setFullNetwork({ nodes: res.nodes || [], edges: res.edges || [] });
        })
        .catch((err) => console.error('Failed to load full network:', err))
        .finally(() => setLoadingFullNetwork(false));
    }
  }, [graphScope, fullNetwork.nodes.length]);

  const handleSelectPerson = (personId: string) => {
    setSelectedPersonId(personId);
    setSearchParams({ person: personId });
    setDrawerNode(null);
  };

  const handleOpenEvidenceById = (eid: number | string) => {
    const numericId = typeof eid === 'string' ? parseInt(eid, 10) : eid;
    if (profile && profile.evidence_records) {
      const match = profile.evidence_records.find((r) => r.id === numericId);
      if (match) {
        setActiveEvidence(match);
        return;
      }
    }
    setActiveEvidence({
      id: numericId,
      title: `Evidence Document #${numericId}`,
      source_type: 'RECORD',
      created_at: null,
      content_snippet: 'Referenced in intelligence knowledge graph.',
    });
  };

  // Node coloring function
  const getNodeColor = (labels?: string[]) => {
    const primary = labels?.[0]?.toUpperCase() || 'ENTITY';
    switch (primary) {
      case 'PERSON':
        return '#09090b';
      case 'PHONE':
        return '#059669';
      case 'BANK_ACCOUNT':
      case 'ACCOUNT':
        return '#d97706';
      case 'VEHICLE':
        return '#dc2626';
      case 'LOCATION':
        return '#7c3aed';
      case 'ORGANIZATION':
        return '#2563eb';
      case 'CASE':
        return '#4f46e5';
      case 'EVENT':
        return '#ea580c';
      default:
        return '#71717a';
    }
  };

  // Compute graph data based on scope, search, and type filters
  const displayedGraph = useMemo(() => {
    let rawNodes: GraphNode[] = [];
    let rawEdges: GraphEdge[] = [];

    if (graphScope === 'full' && fullNetwork.nodes.length > 0) {
      rawNodes = fullNetwork.nodes;
      rawEdges = fullNetwork.edges;
    } else if (profile?.subgraph) {
      rawNodes = profile.subgraph.nodes || [];
      rawEdges = profile.subgraph.edges || [];

      // If scope is "focused", show 1-hop only
      if (graphScope === 'focused' && profile.target_entity) {
        const targetId = profile.target_entity.id;
        const oneHopEdgeList = rawEdges.filter((e) => e.source === targetId || e.target === targetId);
        const oneHopNodeIds = new Set<string>([targetId]);
        oneHopEdgeList.forEach((e) => {
          oneHopNodeIds.add(e.source);
          oneHopNodeIds.add(e.target);
        });
        rawNodes = rawNodes.filter((n) => oneHopNodeIds.has(n.id));
        rawEdges = oneHopEdgeList;
      }
    }

    // Apply entity type filter
    let filteredNodes = rawNodes;
    if (typeFilter !== 'ALL') {
      filteredNodes = filteredNodes.filter(
        (n) => n.id === selectedPersonId || (n.labels?.[0]?.toUpperCase() === typeFilter.toUpperCase())
      );
    }

    // Apply search filter
    if (graphSearch.trim()) {
      const q = graphSearch.toLowerCase();
      filteredNodes = filteredNodes.filter(
        (n) => (n.name || n.id).toLowerCase().includes(q) || n.id === selectedPersonId
      );
    }

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    let filteredEdges = rawEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

    if (relFilter !== 'ALL') {
      filteredEdges = filteredEdges.filter((e) => e.type.toUpperCase() === relFilter.toUpperCase());
    }

    return { nodes: filteredNodes, edges: filteredEdges };
  }, [profile, graphScope, fullNetwork, typeFilter, relFilter, graphSearch, selectedPersonId]);

  // Main Graph Layout Positioning: Centers on Selected Person with Radial Distribution
  const nodePositions = useMemo(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    const centerId = selectedPersonId;
    const width = 800;
    const height = 440;
    const cx = width / 2;
    const cy = height / 2;

    const otherNodes = displayedGraph.nodes.filter((n) => n.id !== centerId);
    pos[centerId] = { x: cx, y: cy };

    if (otherNodes.length === 0) return pos;

    // Distribute remaining nodes in concentric circles
    const innerRingCount = Math.min(otherNodes.length, 10);
    const outerRingCount = otherNodes.length - innerRingCount;

    for (let i = 0; i < innerRingCount; i++) {
      const angle = (i / innerRingCount) * 2 * Math.PI - Math.PI / 2;
      const radius = 130;
      pos[otherNodes[i].id] = {
        x: Math.round(cx + radius * Math.cos(angle)),
        y: Math.round(cy + radius * Math.sin(angle)),
      };
    }

    for (let i = 0; i < outerRingCount; i++) {
      const angle = (i / outerRingCount) * 2 * Math.PI - Math.PI / 3;
      const radius = 210;
      const nodeIdx = innerRingCount + i;
      pos[otherNodes[nodeIdx].id] = {
        x: Math.round(cx + radius * Math.cos(angle)),
        y: Math.round(cy + radius * Math.sin(angle)),
      };
    }

    return pos;
  }, [displayedGraph.nodes, selectedPersonId]);

  const target = profile?.target_entity;
  const overview = profile?.overview;

  // Filtered transactions
  const filteredTransactions = useMemo(() => {
    if (!profile?.transactions) return [];
    if (transactionTab === 'ALL') return profile.transactions;
    return profile.transactions.filter((t) => t.direction === transactionTab);
  }, [profile?.transactions, transactionTab]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* TOP HEADER: PERSON SEARCH / SELECTION & OVERVIEW BAR */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-200 pb-4">
        <div>
          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">
            CRIMELINK • TARGET PROFILE INTELLIGENCE
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 mt-0.5">
            Suspect & Entity Network Profile
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            Isolate and examine an accused individual's direct associates, financial movements, vehicles, and communications.
          </p>
        </div>

        {/* Accused Selection Dropdown & Quick Search */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <label className="text-xs font-mono text-zinc-500 uppercase whitespace-nowrap">
            Selected Suspect:
          </label>
          {loadingPersons ? (
            <div className="text-xs font-mono text-zinc-400">Loading persons…</div>
          ) : persons.length === 0 ? (
            <span className="badge bg-zinc-100 text-zinc-600 font-mono text-xs">
              0 Persons Detected in DB
            </span>
          ) : (
            <select
              value={selectedPersonId}
              onChange={(e) => handleSelectPerson(e.target.value)}
              className="form-select text-xs font-semibold font-mono bg-white border-zinc-300 rounded px-3 py-1.5 min-w-[220px]"
            >
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (Degree: {p.degree})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {profileError && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-xs rounded-md">
          {profileError}
        </div>
      )}

      {loadingProfile ? (
        <div className="p-20 flex justify-center">
          <CrimeGraphLoader size={32} text="Loading suspect intelligence profile from PostgreSQL & Neo4j…" />
        </div>
      ) : !profile || !target ? (
        <div className="card p-12 text-center space-y-3">
          <p className="text-sm font-semibold text-zinc-900">No accused person selected</p>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            {persons.length === 0
              ? 'No investigation entities found in database. Ingest evidence datasets in Data Center to begin.'
              : 'Please select a suspect from the dropdown above to view their investigation profile.'}
          </p>
          {persons.length === 0 && (
            <Link to="/datacenter" className="btn-primary text-xs inline-flex px-4 py-2 mt-2">
              Ingest Evidence Dataset →
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* ────────────────────────────────────────────────────────────────────────── */}
          {/* SECTION 9: CASE OVERVIEW / HIGH-LEVEL INTELLIGENCE METRICS                 */}
          {/* ────────────────────────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
            {[
              { label: 'Person', value: target.name, sub: target.type, highlight: true },
              { label: 'Primary Case', value: overview?.primary_case || 'Not available in source', sub: 'Envelope' },
              { label: 'Connected Suspects', value: overview?.connected_persons ?? 0, sub: 'Persons' },
              { label: 'Phone Devices', value: overview?.phones ?? 0, sub: 'Endpoints' },
              { label: 'Vehicles', value: overview?.vehicles ?? 0, sub: 'Registered' },
              { label: 'Bank Accounts', value: overview?.accounts ?? 0, sub: 'Ledgers' },
              { label: 'Locations', value: overview?.locations ?? 0, sub: 'Sites' },
              { label: 'Risk Alerts', value: overview?.alerts ?? 0, sub: overview?.alerts ? 'Review' : 'Clear', isAlert: (overview?.alerts || 0) > 0 },
            ].map((stat, idx) => (
              <div
                key={idx}
                className={`card p-3 text-center transition-all ${
                  stat.isAlert
                    ? 'border-red-300 bg-red-50/50'
                    : stat.highlight
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'bg-white'
                }`}
              >
                <span
                  className={`text-[9px] font-mono uppercase tracking-wider block truncate ${
                    stat.highlight ? 'text-zinc-400' : stat.isAlert ? 'text-red-700 font-bold' : 'text-zinc-500'
                  }`}
                >
                  {stat.label}
                </span>
                <p
                  className={`text-sm font-bold font-mono mt-1 truncate ${
                    stat.highlight ? 'text-white' : stat.isAlert ? 'text-red-800 font-black' : 'text-zinc-900'
                  }`}
                  title={String(stat.value)}
                >
                  {stat.value}
                </p>
                <span
                  className={`text-[9px] font-mono block mt-0.5 truncate ${
                    stat.highlight ? 'text-zinc-400' : 'text-zinc-400'
                  }`}
                >
                  {stat.sub}
                </span>
              </div>
            ))}
          </div>

          {/* ────────────────────────────────────────────────────────────────────────── */}
          {/* PROFILE SUMMARY + ANOMALY ALERTS BANNER                                    */}
          {/* ────────────────────────────────────────────────────────────────────────── */}
          <div className="card p-5 bg-white border border-zinc-200">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center font-mono font-bold text-sm">
                  {target.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-black">{target.name}</h2>
                    <span className="badge bg-zinc-100 text-zinc-800 font-mono text-[10px]">
                      PRIMARY SUSPECT
                    </span>
                    {target.source_record_id && (
                      <button
                        onClick={() => handleOpenEvidenceById(target.source_record_id!)}
                        className="badge bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-mono text-[10px] cursor-pointer"
                      >
                        Evidence Record #{target.source_record_id} ↗
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 font-mono mt-0.5">
                    Node ID: {target.id} • Resolution Confidence:{' '}
                    {target.confidence != null ? `${Math.round(target.confidence * 100)}%` : 'Not available in source'}
                  </p>
                </div>
              </div>

              {/* Alerts Badge */}
              <div className="flex items-center gap-2">
                {profile.alerts && profile.alerts.length > 0 ? (
                  <div className="p-2 px-3 bg-red-50 border border-red-200 rounded text-xs text-red-800 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-600 animate-ping"></span>
                    <span className="font-semibold">{profile.alerts.length} Suspicious Graph Anomalies Detected</span>
                  </div>
                ) : (
                  <div className="p-2 px-3 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800">
                    ✓ No Anomalous Risk Alerts Flagged
                  </div>
                )}
              </div>
            </div>

            {/* If alerts exist, display summary explanations */}
            {profile.alerts && profile.alerts.length > 0 && (
              <div className="mt-4 pt-3 border-t border-zinc-100 space-y-2">
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">
                  Detected Pattern Details:
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {profile.alerts.map((al, idx) => (
                    <div key={idx} className="p-2.5 bg-red-50/70 border border-red-200 rounded text-xs text-red-900">
                      <div className="flex justify-between items-center font-mono text-[10px] mb-1">
                        <span className="font-bold uppercase tracking-wider">{al.pattern_type}</span>
                        <span className="badge badge-high">Risk: {al.risk_score}/100</span>
                      </div>
                      <p className="text-xs text-red-800">{al.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ────────────────────────────────────────────────────────────────────────── */}
          {/* 2-COLUMN GRID: 1. PERSON CONNECTIONS  |  5. COMMUNICATIONS                 */}
          {/* ────────────────────────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 1. PERSON / CONNECTIONS CARD */}
            <div className="card p-5 space-y-4 flex flex-col">
              <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
                <div>
                  <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-widest">
                    1. Person Connections & Associates
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Direct relevant connections to {target.name}.
                  </p>
                </div>
                <span className="badge badge-medium font-mono">
                  {profile.person_connections.length} Associated
                </span>
              </div>

              {/* Focused Mini-Graph for Person-to-Person */}
              <FocusedPersonGraph
                centerPersonName={target.name}
                connections={profile.person_connections}
                onSelectPerson={handleSelectPerson}
              />

              {/* Table of Person Connections */}
              {profile.person_connections.length === 0 ? (
                <div className="p-6 text-center text-xs text-zinc-400 italic">
                  No records found for this entity.
                </div>
              ) : (
                <div className="table-container max-h-56 overflow-y-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Associate Name</th>
                        <th>Relationship</th>
                        <th>Confidence</th>
                        <th>Evidence Source</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.person_connections.map((p, idx) => (
                        <tr key={idx}>
                          <td className="font-bold text-black text-xs">{p.name}</td>
                          <td>
                            <span className="badge bg-zinc-100 text-zinc-800 font-mono text-[10px]">
                              {p.relationship_type}
                            </span>
                          </td>
                          <td className="font-mono text-xs text-zinc-600">
                            {p.confidence != null ? `${Math.round(p.confidence * 100)}%` : 'Not available in source'}
                          </td>
                          <td>
                            {p.evidence_source_id ? (
                              <button
                                onClick={() => handleOpenEvidenceById(p.evidence_source_id!)}
                                className="text-[11px] font-mono text-zinc-600 hover:text-black hover:underline cursor-pointer"
                              >
                                Record #{p.evidence_source_id}
                              </button>
                            ) : (
                              <span className="text-[10px] text-zinc-400">Not available in source</span>
                            )}
                          </td>
                          <td>
                            <button
                              onClick={() => handleSelectPerson(p.person_id)}
                              className="text-xs text-black font-semibold hover:underline cursor-pointer"
                            >
                              Switch Profile →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 5. COMMUNICATION HISTORY CARD */}
            <div className="card p-5 space-y-4 flex flex-col">
              <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
                <div>
                  <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-widest">
                    5. Communication History
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Chronological voice calls & intercepts involving {target.name}.
                  </p>
                </div>
                <span className="badge badge-medium font-mono">
                  {profile.communications.length} Records
                </span>
              </div>

              {profile.communications.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-400 italic">
                  No records found for this entity.
                </div>
              ) : (
                <div className="table-container max-h-[360px] overflow-y-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date / Time</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Channel / Device</th>
                        <th>Event</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.communications.map((comm) => (
                        <tr key={comm.id}>
                          <td className="text-zinc-600 font-mono text-[11px] whitespace-nowrap">
                            {comm.timestamp || 'Not available in source'}
                          </td>
                          <td className="font-semibold text-black text-xs">{comm.from_party}</td>
                          <td className="font-semibold text-black text-xs">{comm.to_party}</td>
                          <td className="font-mono text-[10px] text-zinc-500">{comm.channel}</td>
                          <td>
                            <span className="badge bg-emerald-50 text-emerald-800 font-mono text-[10px]">
                              {comm.event_type}
                            </span>
                          </td>
                          <td>
                            {comm.evidence_source_id ? (
                              <button
                                onClick={() => handleOpenEvidenceById(comm.evidence_source_id!)}
                                className="text-[11px] font-mono text-zinc-600 hover:text-black hover:underline cursor-pointer"
                              >
                                #{comm.evidence_source_id}
                              </button>
                            ) : (
                              <span className="text-[10px] text-zinc-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ────────────────────────────────────────────────────────────────────────── */}
          {/* 2-COLUMN GRID: 2. LOCATION HISTORY  |  4. VEHICLE INFORMATION             */}
          {/* ────────────────────────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 2. LOCATION HISTORY */}
            <div className="card p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
                <div>
                  <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-widest">
                    2. Location History & Sightings
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Sites and meeting points linked to {target.name}.
                  </p>
                </div>
                <span className="badge badge-medium font-mono">
                  {profile.locations.length} Sites
                </span>
              </div>

              {profile.locations.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-400 italic">
                  No records found for this entity.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* If any location has real coordinates, render an OpenStreetMap preview without paid APIs */}
                  {profile.locations.some((l) => l.latitude != null && l.longitude != null) ? (
                    <div className="border border-zinc-200 rounded-lg overflow-hidden bg-zinc-100 h-48 relative">
                      {/* Leaflet/OSM embed for real coordinates */}
                      {(() => {
                        const locWithCoords = profile.locations.find(
                          (l) => l.latitude != null && l.longitude != null
                        )!;
                        const lat = locWithCoords.latitude!;
                        const lon = locWithCoords.longitude!;
                        return (
                          <iframe
                            title="OpenStreetMap Location"
                            className="w-full h-full border-0"
                            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.02}%2C${lat - 0.02}%2C${lon + 0.02}%2C${lat + 0.02}&layer=mapnik&marker=${lat}%2C${lon}`}
                          />
                        );
                      })()}
                    </div>
                  ) : null}

                  {/* Chronological Table */}
                  <div className="table-container max-h-56 overflow-y-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date / Time</th>
                          <th>Location Name</th>
                          <th>Relationship / Event</th>
                          <th>Confidence</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.locations.map((loc, idx) => (
                          <tr key={idx}>
                            <td className="font-mono text-zinc-500 text-[11px] whitespace-nowrap">
                              {loc.timestamp || 'Not available in source'}
                            </td>
                            <td className="font-semibold text-black text-xs">{loc.location_name}</td>
                            <td>
                              <span className="badge bg-purple-50 text-purple-800 font-mono text-[10px]">
                                {loc.relationship_type}
                              </span>
                            </td>
                            <td className="font-mono text-[11px] text-zinc-600">
                              {loc.confidence != null ? `${Math.round(loc.confidence * 100)}%` : 'Not available in source'}
                            </td>
                            <td>
                              {loc.evidence_source_id ? (
                                <button
                                  onClick={() => handleOpenEvidenceById(loc.evidence_source_id!)}
                                  className="text-[11px] font-mono text-zinc-600 hover:text-black hover:underline cursor-pointer"
                                >
                                  #{loc.evidence_source_id}
                                </button>
                              ) : (
                                <span className="text-[10px] text-zinc-400">Not available in source</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* 4. VEHICLE INFORMATION CARD */}
            <div className="card p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
                <div>
                  <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-widest">
                    4. Vehicle Intelligence
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Vehicles operated, owned, or sighted with {target.name}.
                  </p>
                </div>
                <span className="badge badge-medium font-mono">
                  {profile.vehicles.length} Vehicles
                </span>
              </div>

              {profile.vehicles.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-400 italic">
                  No records found for this entity.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {profile.vehicles.map((v, idx) => (
                    <div key={idx} className="p-3.5 bg-zinc-50 border border-zinc-200 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-black text-sm">{v.vehicle_number}</span>
                        <span className="badge bg-red-100 text-red-800 font-mono text-[10px]">
                          {v.relationship_type}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs text-zinc-600">
                        <p>
                          <span className="text-zinc-400">Owner / Operator:</span>{' '}
                          <strong className="text-zinc-900">{v.owner || target.name}</strong>
                        </p>
                        <p>
                          <span className="text-zinc-400">Details:</span>{' '}
                          {v.details || 'Not available in source'}
                        </p>
                        <p>
                          <span className="text-zinc-400">Timestamp:</span>{' '}
                          {v.timestamp || 'Not available in source'}
                        </p>
                      </div>
                      <div className="pt-2 border-t border-zinc-200 flex justify-between items-center text-[10px] font-mono">
                        <span className="text-zinc-400">
                          Confidence: {v.confidence != null ? `${Math.round(v.confidence * 100)}%` : '—'}
                        </span>
                        {v.evidence_source_id && (
                          <button
                            onClick={() => handleOpenEvidenceById(v.evidence_source_id!)}
                            className="text-zinc-700 hover:text-black hover:underline cursor-pointer font-bold"
                          >
                            Source #{v.evidence_source_id} ↗
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ────────────────────────────────────────────────────────────────────────── */}
          {/* 3. TRANSACTION HISTORY CARD                                                */}
          {/* ────────────────────────────────────────────────────────────────────────── */}
          <div className="card p-5 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-zinc-100 pb-3">
              <div>
                <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-widest">
                  3. Financial Transaction History
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Ledger flows between accounts associated with {target.name}.
                </p>
              </div>

              {/* Tabs for Incoming / Outgoing */}
              <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-md text-xs font-mono">
                {(['ALL', 'INCOMING', 'OUTGOING'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setTransactionTab(tab)}
                    className={`px-3 py-1 rounded cursor-pointer transition-colors ${
                      transactionTab === tab ? 'bg-white font-bold text-black shadow-xs' : 'text-zinc-500 hover:text-black'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {filteredTransactions.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-400 italic">
                No records found for this entity.
              </div>
            ) : (
              <div className="table-container max-h-64 overflow-y-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Direction</th>
                      <th>Date / Time</th>
                      <th>Source Account</th>
                      <th>Destination Account</th>
                      <th>Amount</th>
                      <th>Transaction Type</th>
                      <th>Associated Entity</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <span
                            className={`badge font-mono text-[10px] ${
                              t.direction === 'INCOMING' ? 'badge-success' : 'badge-high'
                            }`}
                          >
                            {t.direction}
                          </span>
                        </td>
                        <td className="font-mono text-zinc-500 text-[11px] whitespace-nowrap">
                          {t.timestamp || 'Not available in source'}
                        </td>
                        <td className="font-mono font-semibold text-black text-xs">{t.source_account}</td>
                        <td className="font-mono font-semibold text-black text-xs">{t.destination_account}</td>
                        <td className="font-mono font-semibold text-xs">
                          {t.amount != null ? `₹${t.amount}` : <span className="text-zinc-400 italic">Amount not available in source</span>}
                        </td>
                        <td>
                          <span className="badge bg-amber-50 text-amber-800 font-mono text-[10px]">
                            {t.transaction_type}
                          </span>
                        </td>
                        <td className="text-zinc-800 font-semibold text-xs">
                          {t.associated_person || 'Not available in source'}
                        </td>
                        <td>
                          {t.evidence_source_id ? (
                            <button
                              onClick={() => handleOpenEvidenceById(t.evidence_source_id!)}
                              className="text-[11px] font-mono text-zinc-600 hover:text-black hover:underline cursor-pointer"
                            >
                              Record #{t.evidence_source_id}
                            </button>
                          ) : (
                            <span className="text-[10px] text-zinc-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ────────────────────────────────────────────────────────────────────────── */}
          {/* 6. EVIDENCE / SOURCE REFERENCES CARD                                       */}
          {/* ────────────────────────────────────────────────────────────────────────── */}
          <div className="card p-5 space-y-4">
            <div className="flex justify-between items-center border-b border-zinc-100 pb-3">
              <div>
                <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-widest">
                  6. Corroborating Evidence & Source References
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Underlying documents in PostgreSQL establishing intelligence facts for {target.name}.
                </p>
              </div>
              <span className="badge badge-medium font-mono">
                {profile.evidence_records.length} Documents
              </span>
            </div>

            {profile.evidence_records.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-400 italic">
                No records found for this entity.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {profile.evidence_records.map((rec) => (
                  <div
                    key={rec.id}
                    onClick={() => setActiveEvidence(rec)}
                    className="p-3.5 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 rounded-lg space-y-2 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="badge bg-zinc-200 text-zinc-800 font-mono text-[10px]">
                        {rec.source_type}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400">ID #{rec.id}</span>
                    </div>
                    <h4 className="font-bold text-black text-xs truncate">{rec.title}</h4>
                    {rec.content_snippet && (
                      <p className="text-[11px] text-zinc-600 line-clamp-2 leading-relaxed">
                        {rec.content_snippet}
                      </p>
                    )}
                    <div className="pt-2 border-t border-zinc-200 flex justify-between items-center text-[10px] font-mono text-zinc-500">
                      <span>{rec.created_at ? new Date(rec.created_at).toLocaleDateString() : '—'}</span>
                      <span className="text-black font-semibold">Inspect Evidence →</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ────────────────────────────────────────────────────────────────────────── */}
          {/* 7. MAIN NETWORK GRAPH: FOCUSED INTERACTIVE VISUALIZER                      */}
          {/* ────────────────────────────────────────────────────────────────────────── */}
          <div className="card p-5 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-zinc-100 pb-3">
              <div>
                <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-widest">
                  7. Interactive Neighborhood Network Graph
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Topological link visualization centered on {target.name}. Click any node to inspect details.
                </p>
              </div>

              {/* Controls: Scope Selector (1-Hop / 2-Hop / Full) & Zoom */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center bg-zinc-100 p-1 rounded-md text-xs font-mono">
                  {(['focused', '2hop', 'full'] as const).map((sc) => (
                    <button
                      key={sc}
                      onClick={() => setGraphScope(sc)}
                      className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                        graphScope === sc ? 'bg-white font-bold text-black shadow-xs' : 'text-zinc-500 hover:text-black'
                      }`}
                    >
                      {sc === 'focused' ? '1-Hop Immediate' : sc === '2hop' ? '2-Hop Network' : 'Full Graph'}
                    </button>
                  ))}
                </div>

                <div className="flex items-center bg-zinc-100 p-1 rounded-md gap-1">
                  <button
                    onClick={() => setZoomLevel((z) => Math.min(z + 0.2, 2.4))}
                    className="px-2 py-0.5 text-xs font-bold text-zinc-700 hover:text-black cursor-pointer"
                    title="Zoom In"
                  >
                    +
                  </button>
                  <button
                    onClick={() => setZoomLevel((z) => Math.max(z - 0.2, 0.4))}
                    className="px-2 py-0.5 text-xs font-bold text-zinc-700 hover:text-black cursor-pointer"
                    title="Zoom Out"
                  >
                    −
                  </button>
                  <button
                    onClick={() => setZoomLevel(1)}
                    className="px-2 py-0.5 text-[10px] font-mono text-zinc-500 cursor-pointer"
                  >
                    {Math.round(zoomLevel * 100)}%
                  </button>
                </div>
              </div>
            </div>

            {/* Filter Bar: Entity Type & Relationship Type */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1">
                  Filter Entity Type
                </label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="form-select text-xs font-mono"
                >
                  <option value="ALL">All Entity Types</option>
                  <option value="PERSON">PERSON</option>
                  <option value="PHONE">PHONE</option>
                  <option value="ACCOUNT">ACCOUNT</option>
                  <option value="VEHICLE">VEHICLE</option>
                  <option value="LOCATION">LOCATION</option>
                  <option value="CASE">CASE</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1">
                  Filter Relationship Type
                </label>
                <select
                  value={relFilter}
                  onChange={(e) => setRelFilter(e.target.value)}
                  className="form-select text-xs font-mono"
                >
                  <option value="ALL">All Relationship Types</option>
                  <option value="CALLS">CALLS</option>
                  <option value="USES">USES</option>
                  <option value="OWNS">OWNS</option>
                  <option value="TRANSFERS">TRANSFERS</option>
                  <option value="VISITS">VISITS</option>
                  <option value="ASSOCIATED_WITH">ASSOCIATED_WITH</option>
                  <option value="INVOLVED_IN">INVOLVED_IN</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1">
                  Search in Graph
                </label>
                <input
                  type="text"
                  placeholder="Filter node label / name…"
                  value={graphSearch}
                  onChange={(e) => setGraphSearch(e.target.value)}
                  className="form-input text-xs"
                />
              </div>
            </div>

            {/* Graph Canvas */}
            <div className="relative border border-zinc-200 rounded-lg overflow-hidden bg-white min-h-[440px] flex items-center justify-center">
              <div className="absolute inset-0 bg-[radial-gradient(#e4e4e7_1px,transparent_1px)] [background-size:16px_16px] opacity-60 pointer-events-none"></div>

              {loadingFullNetwork ? (
                <CrimeGraphLoader size={28} text="Loading full network graph…" />
              ) : displayedGraph.nodes.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-400 italic">
                  No nodes matching current graph filters.
                </div>
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center transition-transform duration-150"
                  style={{ transform: `scale(${zoomLevel})` }}
                >
                  <svg
                    className="w-full h-full max-w-4xl max-h-[440px] p-4 relative z-10"
                    viewBox="0 0 800 440"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {/* Edges */}
                    {displayedGraph.edges.map((edge) => {
                      const sPos = nodePositions[edge.source];
                      const tPos = nodePositions[edge.target];
                      if (!sPos || !tPos) return null;

                      const midX = (sPos.x + tPos.x) / 2;
                      const midY = (sPos.y + tPos.y) / 2;

                      return (
                        <g key={edge.id}>
                          <line
                            x1={sPos.x}
                            y1={sPos.y}
                            x2={tPos.x}
                            y2={tPos.y}
                            stroke="#71717a"
                            strokeWidth="1.5"
                            strokeOpacity="0.65"
                          />
                          {edge.type && (
                            <text
                              x={midX}
                              y={midY - 4}
                              fill="#71717a"
                              fontSize="8"
                              fontFamily="monospace"
                              textAnchor="middle"
                              className="font-bold select-none"
                            >
                              {edge.type}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {/* Nodes */}
                    {displayedGraph.nodes.map((node) => {
                      const pos = nodePositions[node.id];
                      if (!pos) return null;
                      const isSelected = selectedPersonId === node.id;
                      const isDrawerSelected = drawerNode?.id === node.id;
                      const nodeColor = getNodeColor(node.labels);
                      const name = node.name || node.id;

                      return (
                        <g
                          key={node.id}
                          className="cursor-pointer transition-transform hover:scale-110"
                          onClick={() => setDrawerNode(node)}
                        >
                          <circle
                            cx={pos.x}
                            cy={pos.y}
                            r={isSelected ? 26 : isDrawerSelected ? 22 : 18}
                            fill={nodeColor}
                            stroke={isSelected ? '#000000' : '#ffffff'}
                            strokeWidth={isSelected ? 4 : 2}
                            className="shadow-md"
                          />
                          <text
                            x={pos.x}
                            y={pos.y + 32}
                            textAnchor="middle"
                            fontSize="9"
                            fontFamily="monospace"
                            fontWeight={isSelected ? 'bold' : 'normal'}
                            fill="#09090b"
                            className="select-none"
                          >
                            {name.length > 14 ? `${name.slice(0, 12)}…` : name}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}

              {/* Node Color Legend */}
              <div className="absolute bottom-3 left-3 z-20 bg-white/95 backdrop-blur-xs border border-zinc-200 rounded-md p-2 flex items-center gap-3 text-[10px] font-mono text-zinc-700 shadow-xs flex-wrap">
                <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-zinc-900"></span>PERSON</div>
                <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>PHONE</div>
                <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-600"></span>ACCOUNT</div>
                <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-600"></span>VEHICLE</div>
                <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-purple-600"></span>LOCATION</div>
                <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>CASE</div>
              </div>

              {/* Node / Edge Count Badge */}
              <div className="absolute top-3 left-3 z-20 bg-white/90 border border-zinc-200 rounded px-2 py-1 text-[10px] font-mono text-zinc-600">
                {displayedGraph.nodes.length} Nodes • {displayedGraph.edges.length} Edges
              </div>
            </div>
          </div>
        </>
      )}

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* 8. ENTITY DETAIL DRAWER (SECTION 8)                                        */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      {drawerNode && (
        <EntityDetailDrawer
          node={drawerNode}
          allNodes={displayedGraph.nodes}
          allEdges={displayedGraph.edges}
          onClose={() => setDrawerNode(null)}
          onSelectEntity={(nodeId) => {
            if (nodeId.startsWith('PERSON:')) {
              handleSelectPerson(nodeId);
            }
          }}
          onOpenEvidence={handleOpenEvidenceById}
        />
      )}

      {/* ────────────────────────────────────────────────────────────────────────── */}
      {/* EVIDENCE PREVIEW MODAL                                                     */}
      {/* ────────────────────────────────────────────────────────────────────────── */}
      {activeEvidence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="card w-full max-w-lg p-6 space-y-4 shadow-2xl relative bg-white">
            <div className="flex justify-between items-start border-b border-zinc-100 pb-3">
              <div>
                <span className="badge bg-zinc-900 text-white font-mono text-[10px]">
                  {activeEvidence.source_type} EVIDENCE RECORD
                </span>
                <h3 className="text-base font-bold text-black mt-1">{activeEvidence.title}</h3>
                <p className="text-xs text-zinc-400 font-mono">
                  Record ID #{activeEvidence.id} • {activeEvidence.created_at ? new Date(activeEvidence.created_at).toLocaleString() : 'Not available in source'}
                </p>
              </div>
              <button
                onClick={() => setActiveEvidence(null)}
                className="text-zinc-400 hover:text-black p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 block">
                Evidence Content Snippet
              </span>
              <pre className="p-3 bg-zinc-50 border border-zinc-200 rounded text-xs font-mono text-zinc-800 whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed">
                {activeEvidence.content_snippet || 'No document text content available in source.'}
              </pre>
            </div>

            <div className="pt-2 flex justify-between items-center">
              <Link
                to={`/cases/${activeEvidence.id}`}
                className="btn-primary text-xs px-3.5 py-1.5"
              >
                Inspect Full Case Envelope →
              </Link>
              <button
                onClick={() => setActiveEvidence(null)}
                className="btn-secondary text-xs px-3.5 py-1.5 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
