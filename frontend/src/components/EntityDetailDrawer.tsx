import type { GraphNode, GraphEdge, KeyInfluencerItem } from '../api/graph';

interface EntityDetailDrawerProps {
  node: GraphNode | null;
  allNodes: GraphNode[];
  allEdges: GraphEdge[];
  influencer?: KeyInfluencerItem | null;
  onClose: () => void;
  onSelectEntity: (nodeId: string) => void;
  onOpenEvidence?: (evidenceId: number | string) => void;
}

export default function EntityDetailDrawer({
  node,
  allNodes,
  allEdges,
  influencer,
  onClose,
  onSelectEntity,
  onOpenEvidence,
}: EntityDetailDrawerProps) {
  if (!node) return null;


  const nodeMap = new Map<string, GraphNode>(allNodes.map((n) => [n.id, n]));

  // Find all edges connected to this node
  const connectedEdges = allEdges.filter(
    (e) => e.source === node.id || e.target === node.id
  );

  // Group connected entities by type
  const connectedPersons: Array<{ node: GraphNode; edge: GraphEdge }> = [];
  const connectedPhones: Array<{ node: GraphNode; edge: GraphEdge }> = [];
  const connectedVehicles: Array<{ node: GraphNode; edge: GraphEdge }> = [];
  const connectedAccounts: Array<{ node: GraphNode; edge: GraphEdge }> = [];
  const connectedLocations: Array<{ node: GraphNode; edge: GraphEdge }> = [];
  const connectedCases: Array<{ node: GraphNode; edge: GraphEdge }> = [];
  const connectedOthers: Array<{ node: GraphNode; edge: GraphEdge }> = [];

  const evidenceIds = new Set<string | number>();
  if (node.source_record_id) evidenceIds.add(node.source_record_id);

  for (const edge of connectedEdges) {
    if (edge.evidence_source_id) evidenceIds.add(edge.evidence_source_id);
    const neighborId = edge.source === node.id ? edge.target : edge.source;
    const neighbor = nodeMap.get(neighborId) || {
      id: neighborId,
      labels: [neighborId.split(':')[0] || 'ENTITY'],
      name: neighborId.split(':')[1] || neighborId,
      confidence: edge.confidence,
      source_record_id: null,
    };

    const type = neighbor.labels?.[0]?.toUpperCase() || 'ENTITY';
    const pair = { node: neighbor, edge };

    if (type === 'PERSON') connectedPersons.push(pair);
    else if (type === 'PHONE') connectedPhones.push(pair);
    else if (type === 'VEHICLE') connectedVehicles.push(pair);
    else if (type === 'ACCOUNT' || type === 'BANK_ACCOUNT') connectedAccounts.push(pair);
    else if (type === 'LOCATION') connectedLocations.push(pair);
    else if (type === 'CASE') connectedCases.push(pair);
    else connectedOthers.push(pair);
  }

  const primaryLabel = node.labels?.[0] || 'ENTITY';

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-[#101014] text-white shadow-2xl border-l border-zinc-800 flex flex-col transform transition-transform duration-300 ease-in-out">
      {/* Drawer Header */}
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-[#141418]">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">
            Entity Intelligence Inspector
          </span>
          <h2 className="text-sm font-semibold text-white truncate max-w-xs mt-0.5">
            {node.name || node.id}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
          title="Close Drawer"
        >
          ✕
        </button>
      </div>

      {/* Drawer Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs touch-scroll">
        {/* Entity Card */}
        <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="badge bg-zinc-900 border border-zinc-700 text-emerald-400 font-mono text-[10px]">
              {primaryLabel}
            </span>
            <span className="text-[11px] font-mono text-zinc-400">
              Confidence:{' '}
              <strong className="text-white">
                {node.confidence != null ? `${Math.round(node.confidence * 100)}%` : 'Not available in source'}
              </strong>
            </span>
          </div>

          {/* Explicit Graph Centrality Influencer Role Badge */}
          {influencer && (
            <div
              className="p-2.5 rounded-md border mt-2 space-y-1.5"
              style={{
                backgroundColor: `${influencer.badge_color}15`,
                borderColor: `${influencer.badge_color}60`,
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{influencer.badge_icon}</span>
                  <span
                    className="font-mono font-bold text-xs uppercase tracking-wider"
                    style={{ color: influencer.badge_color }}
                  >
                    {influencer.role_title}
                  </span>
                </div>
                <span
                  className="font-mono font-bold text-[11px] px-2 py-0.5 rounded border"
                  style={{
                    backgroundColor: `${influencer.badge_color}25`,
                    borderColor: `${influencer.badge_color}70`,
                    color: influencer.badge_color,
                  }}
                >
                  Score: {influencer.influence_score}
                </span>
              </div>
              <p className="text-[11px] text-zinc-300 leading-relaxed">{influencer.explanation}</p>
              
              {/* Centrality Metrics Grid */}
              <div className="grid grid-cols-3 gap-1 pt-1.5 border-t border-zinc-800/80 text-center font-mono">
                <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800">
                  <span className="text-[9px] text-zinc-500 uppercase block">PageRank</span>
                  <span className="text-xs font-semibold text-emerald-400">{influencer.pagerank.toFixed(2)}</span>
                </div>
                <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800">
                  <span className="text-[9px] text-zinc-500 uppercase block">Betweenness</span>
                  <span className="text-xs font-semibold text-cyan-400">{influencer.betweenness.toFixed(2)}</span>
                </div>
                <div className="bg-zinc-950/60 p-1.5 rounded border border-zinc-800">
                  <span className="text-[9px] text-zinc-500 uppercase block">Degree</span>
                  <span className="text-xs font-semibold text-amber-400">{influencer.degree}</span>
                </div>
              </div>
            </div>
          )}

          <div>
            <span className="text-[10px] font-mono text-zinc-500 uppercase block">Deterministic Node ID</span>
            <p className="font-mono text-xs text-zinc-300 break-all select-all">{node.id}</p>
          </div>
          {primaryLabel === 'PERSON' && (
            <div className="pt-2 border-t border-zinc-800">
              <button
                onClick={() => onSelectEntity(node.id)}
                className="btn-primary w-full text-xs py-1.5 justify-center cursor-pointer"
              >
                Inspect Person Profile →
              </button>
            </div>
          )}

        </div>

        {/* Associated Persons */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">
              Connected Persons ({connectedPersons.length})
            </span>
          </div>
          {connectedPersons.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No direct person connections</p>
          ) : (
            <div className="space-y-1">
              {connectedPersons.map(({ node: p, edge }, i) => (
                <div
                  key={i}
                  onClick={() => onSelectEntity(p.id)}
                  className="p-2 bg-zinc-900/60 hover:bg-zinc-800/80 border border-zinc-800 rounded flex items-center justify-between cursor-pointer transition-colors"
                >
                  <div className="truncate mr-2">
                    <p className="font-semibold text-zinc-100 truncate">{p.name || p.id}</p>
                    <p className="text-[10px] font-mono text-zinc-400">{edge.type}</p>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                    {edge.confidence ? `${Math.round(edge.confidence * 100)}%` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Associated Phones */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">
            Associated Devices / Phones ({connectedPhones.length})
          </span>
          {connectedPhones.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No phones associated</p>
          ) : (
            <div className="space-y-1">
              {connectedPhones.map(({ node: ph, edge }, i) => (
                <div key={i} className="p-2 bg-zinc-900/60 border border-zinc-800 rounded flex items-center justify-between">
                  <div>
                    <p className="font-mono font-semibold text-zinc-100">{ph.name || ph.id}</p>
                    <span className="text-[9px] font-mono text-zinc-400">{edge.type}</span>
                  </div>
                  {edge.evidence_source_id && (
                    <span className="badge bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-[9px]">
                      SRC #{edge.evidence_source_id}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Associated Vehicles */}
        {connectedVehicles.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
              Registered Vehicles ({connectedVehicles.length})
            </span>
            <div className="space-y-1">
              {connectedVehicles.map(({ node: v, edge }, i) => (
                <div key={i} className="p-2 bg-zinc-900/60 border border-zinc-800 rounded flex items-center justify-between">
                  <div>
                    <p className="font-mono font-semibold text-white">{v.name || v.id}</p>
                    <span className="text-[9px] font-mono text-zinc-400">{edge.type}</span>
                  </div>
                  <span className="badge bg-zinc-800 border border-zinc-700 text-amber-400 font-mono text-[9px]">
                    VEHICLE
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Associated Accounts */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
            Financial Accounts ({connectedAccounts.length})
          </span>
          {connectedAccounts.length === 0 ? (
            <p className="text-[11px] text-zinc-500 italic">No accounts associated</p>
          ) : (
            <div className="space-y-1">
              {connectedAccounts.map(({ node: acc, edge }, i) => (
                <div key={i} className="p-2 bg-zinc-900/60 border border-zinc-800 rounded flex items-center justify-between">
                  <div>
                    <p className="font-mono font-semibold text-white">{acc.name || acc.id}</p>
                    <span className="text-[9px] font-mono text-zinc-400">{edge.type}</span>
                  </div>
                  {edge.evidence_source_id && (
                    <span className="badge bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono text-[9px]">
                      SRC #{edge.evidence_source_id}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Locations */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
            Locations ({connectedLocations.length})
          </span>
          {connectedLocations.length === 0 ? (
            <p className="text-[11px] text-zinc-500 italic">No locations associated</p>
          ) : (
            <div className="space-y-1">
              {connectedLocations.map(({ node: loc, edge }, i) => (
                <div key={i} className="p-2 bg-zinc-900/60 border border-zinc-800 rounded flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-white">{loc.name || loc.id}</p>
                    <span className="text-[9px] font-mono text-zinc-400">{edge.type}</span>
                  </div>
                  {edge.timestamp && (
                    <span className="text-[10px] font-mono text-zinc-400">{edge.timestamp}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cases */}
        {connectedCases.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
              Associated Cases ({connectedCases.length})
            </span>
            <div className="space-y-1">
              {connectedCases.map(({ node: c }, i) => (
                <div key={i} className="p-2 bg-zinc-900/60 border border-zinc-800 rounded">
                  <p className="font-mono font-bold text-white text-xs">{c.name || c.id}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Evidence / Source Records References */}
        <div className="pt-2 border-t border-zinc-800 space-y-1.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block">
            Referenced Evidence Sources ({evidenceIds.size})
          </span>
          {evidenceIds.size === 0 ? (
            <p className="text-[11px] text-zinc-500 italic">No evidence records referenced</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(evidenceIds).map((eid) => (
                <button
                  key={eid}
                  onClick={() => onOpenEvidence?.(eid)}
                  className="badge bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-[10px] hover:bg-zinc-800 cursor-pointer"
                >
                  Record #{eid} ↗
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
