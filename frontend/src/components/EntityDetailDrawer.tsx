import type { GraphNode, GraphEdge } from '../api/graph';

interface EntityDetailDrawerProps {
  node: GraphNode | null;
  allNodes: GraphNode[];
  allEdges: GraphEdge[];
  onClose: () => void;
  onSelectEntity: (nodeId: string) => void;
  onOpenEvidence?: (evidenceId: number | string) => void;
}

export default function EntityDetailDrawer({
  node,
  allNodes,
  allEdges,
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
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-white shadow-2xl border-l border-zinc-200 flex flex-col transform transition-transform duration-300 ease-in-out">
      {/* Drawer Header */}
      <div className="p-4 border-b border-zinc-200 flex items-center justify-between bg-zinc-50">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 block">
            Entity Intelligence Inspector
          </span>
          <h2 className="text-sm font-semibold text-black truncate max-w-xs mt-0.5">
            {node.name || node.id}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-zinc-200 text-zinc-500 hover:text-black cursor-pointer"
          title="Close Drawer"
        >
          ✕
        </button>
      </div>

      {/* Drawer Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* Entity Card */}
        <div className="p-3.5 bg-zinc-50 border border-zinc-200 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="badge bg-zinc-900 text-white font-mono text-[10px]">
              {primaryLabel}
            </span>
            <span className="text-[11px] font-mono text-zinc-500">
              Confidence:{' '}
              <strong className="text-black">
                {node.confidence != null ? `${Math.round(node.confidence * 100)}%` : 'Not available in source'}
              </strong>
            </span>
          </div>
          <div>
            <span className="text-[10px] font-mono text-zinc-400 uppercase block">Deterministic Node ID</span>
            <p className="font-mono text-xs text-zinc-800 break-all select-all">{node.id}</p>
          </div>
          {primaryLabel === 'PERSON' && (
            <div className="pt-2 border-t border-zinc-200">
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
                  className="p-2 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 rounded flex items-center justify-between cursor-pointer"
                >
                  <div className="truncate mr-2">
                    <p className="font-semibold text-black truncate">{p.name || p.id}</p>
                    <p className="text-[10px] font-mono text-zinc-400">{edge.type}</p>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500 shrink-0">
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
                <div key={i} className="p-2 bg-zinc-50 border border-zinc-200 rounded flex items-center justify-between">
                  <div>
                    <p className="font-mono font-semibold text-black">{ph.name || ph.id}</p>
                    <span className="text-[9px] font-mono text-zinc-400">{edge.type}</span>
                  </div>
                  {edge.evidence_source_id && (
                    <span className="badge bg-zinc-200 text-zinc-700 font-mono text-[9px]">
                      SRC #{edge.evidence_source_id}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Associated Vehicles */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">
            Vehicles ({connectedVehicles.length})
          </span>
          {connectedVehicles.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No vehicles associated</p>
          ) : (
            <div className="space-y-1">
              {connectedVehicles.map(({ node: v, edge }, i) => (
                <div key={i} className="p-2 bg-zinc-50 border border-zinc-200 rounded flex items-center justify-between">
                  <div>
                    <p className="font-mono font-bold text-black">{v.name || v.id}</p>
                    <span className="text-[9px] text-zinc-500 font-mono">{edge.type}</span>
                  </div>
                  {edge.evidence_source_id && (
                    <span className="badge bg-zinc-200 text-zinc-700 font-mono text-[9px]">
                      SRC #{edge.evidence_source_id}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Associated Accounts */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">
            Financial Accounts ({connectedAccounts.length})
          </span>
          {connectedAccounts.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No accounts associated</p>
          ) : (
            <div className="space-y-1">
              {connectedAccounts.map(({ node: acc, edge }, i) => (
                <div key={i} className="p-2 bg-zinc-50 border border-zinc-200 rounded flex items-center justify-between">
                  <div>
                    <p className="font-mono font-semibold text-black">{acc.name || acc.id}</p>
                    <span className="text-[9px] font-mono text-zinc-400">{edge.type}</span>
                  </div>
                  {edge.evidence_source_id && (
                    <span className="badge bg-zinc-200 text-zinc-700 font-mono text-[9px]">
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
          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">
            Locations ({connectedLocations.length})
          </span>
          {connectedLocations.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No locations associated</p>
          ) : (
            <div className="space-y-1">
              {connectedLocations.map(({ node: loc, edge }, i) => (
                <div key={i} className="p-2 bg-zinc-50 border border-zinc-200 rounded flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-black">{loc.name || loc.id}</p>
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
            <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">
              Associated Cases ({connectedCases.length})
            </span>
            <div className="space-y-1">
              {connectedCases.map(({ node: c }, i) => (
                <div key={i} className="p-2 bg-zinc-50 border border-zinc-200 rounded">
                  <p className="font-mono font-bold text-black text-xs">{c.name || c.id}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Evidence / Source Records References */}
        <div className="pt-2 border-t border-zinc-200 space-y-1.5">
          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block">
            Referenced Evidence Sources ({evidenceIds.size})
          </span>
          {evidenceIds.size === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No evidence records referenced</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(evidenceIds).map((eid) => (
                <button
                  key={eid}
                  onClick={() => onOpenEvidence?.(eid)}
                  className="badge bg-white border border-zinc-300 text-zinc-800 font-mono text-[10px] hover:bg-zinc-100 cursor-pointer"
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
