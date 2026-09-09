import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import CrimeGraphLoader from '../components/CrimeGraphLoader';
import FocusedPersonGraph from '../components/FocusedPersonGraph';
import EntityDetailDrawer from '../components/EntityDetailDrawer';
import {
  getGraphNetwork,
  getPersonsList,
  getEntityProfile,
  getKeyInfluencers,
  type GraphNode,
  type GraphEdge,
  type PersonItem,
  type EntityProfileResponse,
  type EvidenceRecordItem,
  type KeyInfluencerItem,
} from '../api/graph';
import { showToast } from '../utils/toast';

// ─── SVG Pan / Zoom Hook ─────────────────────────────────────────────────────
function useSvgPanZoom(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // Window-level mousemove and mouseup listeners when dragging canvas
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setTransform((t) => ({ ...t, x: Math.round(dragRef.current!.ox + dx), y: Math.round(dragRef.current!.oy + dy) }));
    };

    const handleMouseUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setIsPanning(false);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Wheel listener attached directly to the persistent container with passive: false
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      // 1. Pinch-to-zoom on Trackpad OR Ctrl+MouseWheel
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.012);
        setTransform((t) => {
          const newK = Math.min(Math.max(t.k * factor, 0.15), 5);
          return {
            k: newK,
            x: Math.round(cx - (cx - t.x) * (newK / t.k)),
            y: Math.round(cy - (cy - t.y) * (newK / t.k)),
          };
        });
        return;
      }

      // 2. Trackpad two-finger pan (continuous smooth deltaX / deltaY)
      if (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) < 45) {
        setTransform((t) => ({
          ...t,
          x: Math.round(t.x - e.deltaX * 1.2),
          y: Math.round(t.y - e.deltaY * 1.2),
        }));
        return;
      }

      // 3. Physical mouse wheel click/scroll (large discrete step deltaY) -> zoom centered at cursor
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      setTransform((t) => {
        const newK = Math.min(Math.max(t.k * factor, 0.15), 5);
        return {
          k: newK,
          x: Math.round(cx - (cx - t.x) * (newK / t.k)),
          y: Math.round(cy - (cy - t.y) * (newK / t.k)),
        };
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: transformRef.current.x, oy: transformRef.current.y };
    setIsPanning(true);
  }, []);

  const resetZoom = useCallback(() => setTransform({ x: 0, y: 0, k: 1 }), []);

  const panBy = useCallback((dx: number, dy: number) => {
    setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  }, []);

  const zoomIn = useCallback(() => {
    const el = containerRef.current;
    const rect = el?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 550;
    const cy = rect ? rect.height / 2 : 320;
    setTransform((t) => {
      const newK = Math.min(t.k * 1.25, 5);
      return {
        k: newK,
        x: Math.round(cx - (cx - t.x) * (newK / t.k)),
        y: Math.round(cy - (cy - t.y) * (newK / t.k)),
      };
    });
  }, [containerRef]);

  const zoomOut = useCallback(() => {
    const el = containerRef.current;
    const rect = el?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 550;
    const cy = rect ? rect.height / 2 : 320;
    setTransform((t) => {
      const newK = Math.max(t.k * 0.8, 0.15);
      return {
        k: newK,
        x: Math.round(cx - (cx - t.x) * (newK / t.k)),
        y: Math.round(cy - (cy - t.y) * (newK / t.k)),
      };
    });
  }, [containerRef]);

  // Automatically fit all nodes into the view with comfortable padding
  const fitToView = useCallback((points: { x: number; y: number }[], padding = 80) => {
    const el = containerRef.current;
    if (!el || points.length === 0) {
      setTransform({ x: 0, y: 0, k: 1 });
      return;
    }
    const rect = el.getBoundingClientRect();
    const cw = rect.width > 100 ? rect.width : 1100;
    const ch = rect.height > 100 ? rect.height : 640;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const spanW = Math.max(maxX - minX + padding * 2, 80);
    const spanH = Math.max(maxY - minY + padding * 2, 80);

    const scale = Math.min(
      Math.max(Math.min((cw - padding) / spanW, (ch - padding) / spanH), 0.25),
      1.25
    );

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const x = Math.round(cw / 2 - centerX * scale);
    const y = Math.round(ch / 2 - centerY * scale);

    setTransform({ x, y, k: Math.round(scale * 100) / 100 });
  }, [containerRef]);

  // Focus directly onto a specific node
  const focusNode = useCallback((nodeX: number, nodeY: number, targetK = 1.35) => {
    const el = containerRef.current;
    const rect = el?.getBoundingClientRect();
    const cw = rect ? rect.width : 1100;
    const ch = rect ? rect.height : 640;
    setTransform({
      k: targetK,
      x: Math.round(cw / 2 - nodeX * targetK),
      y: Math.round(ch / 2 - nodeY * targetK),
    });
  }, [containerRef]);

  return { transform, isPanning, onMouseDown, resetZoom, panBy, zoomIn, zoomOut, fitToView, focusNode };
}

// ─── Layout: Hierarchical Tree & Concentric Radial Tree ────────────────────────
export type GraphLayoutMode = 'tree' | 'radial_tree';

function computeTreeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerId: string,
  width: number,
  height: number,
  layoutMode: GraphLayoutMode = 'tree'
): Record<string, { x: number; y: number; depth: number }> {
  const pos: Record<string, { x: number; y: number; depth: number }> = {};
  if (nodes.length === 0) return pos;

  const nodeMap = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));

  // 1. Identify Root Suspect / Entity
  let rootId = centerId;
  if (!rootId || !nodeMap.has(rootId)) {
    const degrees: Record<string, number> = {};
    edges.forEach((e) => {
      degrees[e.source] = (degrees[e.source] || 0) + 1;
      degrees[e.target] = (degrees[e.target] || 0) + 1;
    });
    const personNodes = nodes.filter((n) => n.labels?.includes('PERSON'));
    if (personNodes.length > 0) {
      personNodes.sort((a, b) => (degrees[b.id] || 0) - (degrees[a.id] || 0));
      rootId = personNodes[0].id;
    } else {
      const sorted = [...nodes].sort((a, b) => (degrees[b.id] || 0) - (degrees[a.id] || 0));
      rootId = sorted[0]?.id || '';
    }
  }

  const cx = width / 2;
  const cy = height / 2;

  // 2. Classify nodes into semantic tiers:
  // Tier 0: Root Suspect / Kingpin
  // Tier 1: Associates & Organizations (Human Network)
  // Tier 2: Accounts & Phones (Financial & Communications Trail)
  // Tier 3: Vehicles, Locations & Cases (Logistics & Physical Evidence)
  const getTier = (n: GraphNode): number => {
    if (n.id === rootId) return 0;
    const label = n.labels?.[0]?.toUpperCase() || '';
    if (label === 'PERSON' || label === 'ORGANIZATION') return 1;
    if (label === 'ACCOUNT' || label === 'BANK_ACCOUNT' || label === 'PHONE') return 2;
    if (label === 'VEHICLE' || label === 'LOCATION' || label === 'CASE' || label === 'EVENT') return 3;
    return 2;
  };

  if (layoutMode === 'radial_tree') {
    // ── Concentric Radial Rings (Suspect at center, tiers radiating outward) ──
    pos[rootId] = { x: cx, y: cy, depth: 0 };
    const ringRadii = [0, 160, 275, 385];

    [1, 2, 3].forEach((tier) => {
      const tierNodes = nodes.filter((n) => getTier(n) === tier);
      const count = tierNodes.length;
      if (count === 0) return;
      const r = ringRadii[tier] || 250;
      const angleStep = (2 * Math.PI) / count;
      tierNodes.forEach((n, idx) => {
        const angle = idx * angleStep - Math.PI / 2;
        pos[n.id] = {
          x: Math.round(cx + r * Math.cos(angle)),
          y: Math.round(cy + r * Math.sin(angle)),
          depth: tier,
        };
      });
    });

    return pos;
  }

  // ── Hierarchical Org-Chart Tree (Suspect -> Associates -> Accounts -> Assets) ──
  const tierY = [85, 240, 410, 580];
  const tiers: string[][] = [[], [], [], []];

  nodes.forEach((n) => {
    const t = getTier(n);
    tiers[t].push(n.id);
  });

  // Position Tier 0 (Root)
  pos[rootId] = { x: cx, y: tierY[0], depth: 0 };

  // Position Tiers 1, 2, 3 with generous spacing
  [1, 2, 3].forEach((t) => {
    const ids = tiers[t];
    const count = ids.length;
    if (count === 0) return;

    // Distribute horizontally with 160px to 220px spacing
    const spacing = Math.max(160, Math.min(230, (width * 0.94) / Math.max(1, count)));
    const totalSpan = (count - 1) * spacing;
    const startX = cx - totalSpan / 2;
    const baseColY = tierY[t];

    ids.forEach((id, idx) => {
      const x = Math.round(startX + idx * spacing);
      // Stagger vertical position slightly if more than 5 nodes to avoid name collisions
      const yOffset = count > 5 ? (idx % 2 === 1 ? 32 : 0) : 0;
      pos[id] = { x, y: baseColY + yOffset, depth: t };
    });
  });

  return pos;
}

// ─── Color palette ──────────────────────────────────────────────────────────
const NODE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  PERSON:       { fill: '#18181b', stroke: '#ffffff', text: '#ffffff' },
  PHONE:        { fill: '#059669', stroke: '#d1fae5', text: '#ffffff' },
  BANK_ACCOUNT: { fill: '#d97706', stroke: '#fde68a', text: '#ffffff' },
  ACCOUNT:      { fill: '#d97706', stroke: '#fde68a', text: '#ffffff' },
  VEHICLE:      { fill: '#dc2626', stroke: '#fecaca', text: '#ffffff' },
  LOCATION:     { fill: '#7c3aed', stroke: '#ddd6fe', text: '#ffffff' },
  ORGANIZATION: { fill: '#2563eb', stroke: '#bfdbfe', text: '#ffffff' },
  CASE:         { fill: '#4f46e5', stroke: '#c7d2fe', text: '#ffffff' },
  EVENT:        { fill: '#ea580c', stroke: '#fed7aa', text: '#ffffff' },
};

const EDGE_COLORS: Record<string, string> = {
  CALLS: '#059669', USES: '#2563eb', OWNS: '#d97706',
  TRANSFERS: '#dc2626', VISITS: '#7c3aed',
  ASSOCIATED_WITH: '#71717a', INVOLVED_IN: '#ea580c',
};

function getNodeStyle(labels?: string[]) {
  const k = labels?.[0]?.toUpperCase() || 'ENTITY';
  return NODE_COLORS[k] ?? { fill: '#71717a', stroke: '#e4e4e7', text: '#ffffff' };
}

function getEdgeColor(type: string): string {
  return EDGE_COLORS[type?.toUpperCase()] ?? '#a1a1aa';
}

export default function GraphPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const personQuery = searchParams.get('person');

  const [persons, setPersons] = useState<PersonItem[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [loadingPersons, setLoadingPersons] = useState(true);

  const [profile, setProfile] = useState<EntityProfileResponse | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [fullNetwork, setFullNetwork] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [loadingFullNetwork, setLoadingFullNetwork] = useState(false);
  const [graphScope, setGraphScope] = useState<'focused' | '2hop' | 'full'>('focused');
  const [layoutMode, setLayoutMode] = useState<GraphLayoutMode>('tree');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [relFilter, setRelFilter] = useState<string>('ALL');
  const [graphSearch, setGraphSearch] = useState('');

  const [drawerNode, setDrawerNode] = useState<GraphNode | null>(null);
  const [activeEvidence, setActiveEvidence] = useState<EvidenceRecordItem | null>(null);
  const [transactionTab, setTransactionTab] = useState<'ALL' | 'INCOMING' | 'OUTGOING'>('ALL');

  const containerRef = useRef<HTMLDivElement>(null);
  const {
    transform,
    isPanning,
    onMouseDown,
    resetZoom,
    panBy,
    zoomIn,
    zoomOut,
    fitToView,
    focusNode,
  } = useSvgPanZoom(containerRef);

  const [draggedPositions, setDraggedPositions] = useState<Record<string, { x: number; y: number; depth: number }>>({});
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [edgeLabelMode, setEdgeLabelMode] = useState<'hover' | 'always' | 'none'>('hover');

  // Key Influencers (Kingpins, Brokers, Mules) computed via graph centrality algorithms
  const [influencers, setInfluencers] = useState<KeyInfluencerItem[]>([]);
  const influencerMap = useMemo(() => {
    const m = new Map<string, KeyInfluencerItem>();
    influencers.forEach((inf) => m.set(inf.entity_id, inf));
    return m;
  }, [influencers]);

  // Load Key Influencers on component mount
  useEffect(() => {
    getKeyInfluencers(50)
      .then((res) => {
        if (res?.results) {
          setInfluencers(res.results);
        }
      })
      .catch((err) => console.error('Failed to load key influencers:', err));
  }, []);

  // Clear manual node drag offsets when target or layout mode changes
  useEffect(() => {
    setDraggedPositions({});
  }, [selectedPersonId, layoutMode, graphScope]);


  // 1. Load persons
  useEffect(() => {
    let cancelled = false;
    async function loadPersons() {
      setLoadingPersons(true);
      try {
        const list = await getPersonsList(100);
        if (cancelled) return;
        setPersons(list || []);
        if (list && list.length > 0) {
          const match = personQuery && list.find((p) => p.id === personQuery);
          setSelectedPersonId(match ? personQuery! : list[0].id);
        }
      } catch (err) {
        console.error('Failed to load persons list:', err);
      } finally {
        if (!cancelled) setLoadingPersons(false);
      }
    }
    loadPersons();
    return () => { cancelled = true; };
  }, [personQuery]);

  // 2. Fetch entity profile
  useEffect(() => {
    if (!selectedPersonId) { setProfile(null); return; }
    let cancelled = false;
    async function loadProfile() {
      setLoadingProfile(true);
      setProfileError(null);
      try {
        const data = await getEntityProfile(selectedPersonId);
        if (!cancelled) setProfile(data);
      } catch (err: any) {
        const msg = err?.message || 'Failed to load investigation profile for this person.';
        if (!cancelled) {
          setProfileError(msg);
          showToast.error('Subject Profile Error', msg);
        }
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    }
    loadProfile();
    return () => { cancelled = true; };
  }, [selectedPersonId]);


  // 3. Optionally fetch full network when "full" scope is requested
  useEffect(() => {
    if (graphScope === 'full' && fullNetwork.nodes.length === 0) {
      setLoadingFullNetwork(true);
      getGraphNetwork(undefined, 300)
        .then((res) => {
          setFullNetwork({ nodes: res.nodes || [], edges: res.edges || [] });
          showToast.info('Full Graph Loaded', `Retrieved ${res.nodes?.length || 0} nodes across all envelopes.`);
        })
        .catch((err) => {
          console.error('Failed to load full network:', err);
          showToast.error('Network Error', 'Failed to retrieve full graph network.');
        })
        .finally(() => setLoadingFullNetwork(false));
    }
  }, [graphScope, fullNetwork.nodes.length]);

  const handleSelectPerson = (personId: string) => {
    setSelectedPersonId(personId);
    setSearchParams({ person: personId });
    setDrawerNode(null);
    const p = persons.find((x) => x.id === personId);
    if (p) {
      showToast.info(
        `Focus: ${p.name || 'Subject'}`,
        `Degree: ${p.degree ?? 0} • Confidence: ${p.confidence ? `${Math.round(p.confidence * 100)}%` : 'Direct Link'}`
      );
    }
  };

  const handleOpenEvidenceById = (eid: number | string) => {
    const numericId = typeof eid === 'string' ? parseInt(eid, 10) : eid;
    showToast.info(`Inspecting Evidence Record #${numericId}`);
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


  // Compute displayed graph
  const displayedGraph = useMemo(() => {
    let rawNodes: GraphNode[] = [];
    let rawEdges: GraphEdge[] = [];

    if (graphScope === 'full' && fullNetwork.nodes.length > 0) {
      rawNodes = fullNetwork.nodes;
      rawEdges = fullNetwork.edges;
    } else if (profile?.subgraph) {
      rawNodes = profile.subgraph.nodes || [];
      rawEdges = profile.subgraph.edges || [];

      if (graphScope === 'focused' && profile.target_entity) {
        const tid = profile.target_entity.id;
        const hopEdges = rawEdges.filter((e) => e.source === tid || e.target === tid);
        const hopIds = new Set<string>([tid]);
        hopEdges.forEach((e) => { hopIds.add(e.source); hopIds.add(e.target); });
        rawNodes = rawNodes.filter((n) => hopIds.has(n.id));
        rawEdges = hopEdges;
      } else if (graphScope === '2hop' && profile.target_entity) {
        // Correct 2-hop: collect 1-hop neighbors, then their neighbors
        const tid = profile.target_entity.id;
        const oneHop = new Set<string>([tid]);
        rawEdges.forEach((e) => {
          if (e.source === tid || e.target === tid) { oneHop.add(e.source); oneHop.add(e.target); }
        });
        const twoHop = new Set<string>(oneHop);
        rawEdges.forEach((e) => {
          if (oneHop.has(e.source) || oneHop.has(e.target)) { twoHop.add(e.source); twoHop.add(e.target); }
        });
        rawNodes = rawNodes.filter((n) => twoHop.has(n.id));
        rawEdges = rawEdges.filter((e) => twoHop.has(e.source) && twoHop.has(e.target));
      }
    }

    let filteredNodes = rawNodes;
    if (typeFilter !== 'ALL') {
      filteredNodes = filteredNodes.filter(
        (n) => n.id === selectedPersonId || n.labels?.[0]?.toUpperCase() === typeFilter.toUpperCase()
      );
    }
    if (graphSearch.trim()) {
      const q = graphSearch.toLowerCase();
      filteredNodes = filteredNodes.filter(
        (n) => (n.name || n.id).toLowerCase().includes(q) || n.id === selectedPersonId
      );
    }

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    let filteredEdges = rawEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    if (relFilter !== 'ALL') {
      filteredEdges = filteredEdges.filter((e) => e.type?.toUpperCase() === relFilter.toUpperCase());
    }

    return { nodes: filteredNodes, edges: filteredEdges };
  }, [profile, graphScope, fullNetwork, typeFilter, relFilter, graphSearch, selectedPersonId]);

  const CANVAS_W = 1400;
  const CANVAS_H = 750;

  // Hierarchical tree & radial layout computation
  const nodePositions = useMemo(
    () => computeTreeLayout(displayedGraph.nodes, displayedGraph.edges, selectedPersonId, CANVAS_W, CANVAS_H, layoutMode),
    [displayedGraph.nodes, displayedGraph.edges, selectedPersonId, layoutMode]
  );

  // Consolidate parallel edges between the same two nodes to avoid messy clutter
  const consolidatedEdges = useMemo(() => {
    const map = new Map<string, { source: string; target: string; typeCounts: Record<string, number>; total: number }>();

    displayedGraph.edges.forEach((e) => {
      const key = `${e.source}-->${e.target}`;
      if (!map.has(key)) {
        map.set(key, { source: e.source, target: e.target, typeCounts: {}, total: 0 });
      }
      const item = map.get(key)!;
      item.typeCounts[e.type] = (item.typeCounts[e.type] || 0) + 1;
      item.total += 1;
    });

    const result: Array<{
      id: string;
      source: string;
      target: string;
      primaryType: string;
      allTypes: string;
      count: number;
    }> = [];

    let i = 0;
    map.forEach((item, k) => {
      const sorted = Object.entries(item.typeCounts).sort((a, b) => b[1] - a[1]);
      const primaryType = sorted[0]?.[0] || 'ASSOCIATED_WITH';
      const allTypes = sorted.map(([t, c]) => (c > 1 ? `${t} (${c})` : t)).join(', ');
      result.push({
        id: `con-edge-${k}-${i++}`,
        source: item.source,
        target: item.target,
        primaryType,
        allTypes,
        count: item.total,
      });
    });

    return result;
  }, [displayedGraph.edges]);

  // Auto-fit view whenever computed nodePositions change
  useEffect(() => {
    const pts = Object.values(nodePositions);
    if (pts.length > 0) {
      const timer = setTimeout(() => fitToView(pts), 60);
      return () => clearTimeout(timer);
    }
  }, [nodePositions, fitToView]);

  // Node position lookup (custom dragged position or auto layout)
  const getNodePos = useCallback(
    (id: string) => draggedPositions[id] || nodePositions[id],
    [draggedPositions, nodePositions]
  );

  // Hover state for interactive edge/node highlighting
  const hoverState = useMemo(() => {
    if (!hoveredNodeId) return null;
    const connected = new Set<string>([hoveredNodeId]);
    let degree = 0;
    displayedGraph.edges.forEach((e) => {
      if (e.source === hoveredNodeId) { connected.add(e.target); degree++; }
      if (e.target === hoveredNodeId) { connected.add(e.source); degree++; }
    });
    const hoveredNode = displayedGraph.nodes.find((n) => n.id === hoveredNodeId);
    return { id: hoveredNodeId, connected, degree, name: hoveredNode?.name || hoveredNodeId };
  }, [hoveredNodeId, displayedGraph.edges, displayedGraph.nodes]);

  // Handle interactive node dragging
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, node: GraphNode) => {
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const currentPos = draggedPositions[node.id] || nodePositions[node.id];
    if (!currentPos) return;

    let hasMoved = false;

    const onMove = (moveEv: MouseEvent) => {
      const dx = (moveEv.clientX - startX) / transform.k;
      const dy = (moveEv.clientY - startY) / transform.k;
      if (Math.hypot(dx, dy) > 3) {
        hasMoved = true;
      }
      setDraggedPositions((prev) => ({
        ...prev,
        [node.id]: {
          x: Math.round(currentPos.x + dx),
          y: Math.round(currentPos.y + dy),
          depth: currentPos.depth,
        },
      }));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!hasMoved) {
        setDrawerNode((prev) => (prev?.id === node.id ? null : node));
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [draggedPositions, nodePositions, transform.k]);

  // Dynamic relationship types for filter dropdown
  const availableRelTypes = useMemo(() => {
    const s = new Set<string>();
    (profile?.subgraph?.edges || fullNetwork.edges || []).forEach((e) => { if (e.type) s.add(e.type); });
    return Array.from(s).sort();
  }, [profile, fullNetwork]);

  // Node radius helper
  const getNodeRadius = (node: GraphNode) =>
    node.id === selectedPersonId ? 28 : drawerNode?.id === node.id ? 21 : 15;

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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-800 pb-4">
        <div>
          <span className="text-[10px] font-mono text-emerald-400 tracking-widest uppercase block">
            CRIMELINK • TARGET PROFILE INTELLIGENCE
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5">
            Suspect & Entity Network Profile
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Isolate and examine an accused individual's direct associates, financial movements, vehicles, and communications.
          </p>
        </div>

        {/* Accused Selection Dropdown & Quick Search */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <label className="text-xs font-mono text-zinc-400 uppercase whitespace-nowrap">
            Selected Suspect:
          </label>
          {loadingPersons ? (
            <div className="text-xs font-mono text-zinc-500">Loading persons…</div>
          ) : persons.length === 0 ? (
            <span className="badge bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono text-xs">
              0 Persons Detected in DB
            </span>
          ) : (
            <select
              value={selectedPersonId}
              onChange={(e) => handleSelectPerson(e.target.value)}
              className="form-select text-xs font-semibold font-mono bg-[#141418] border-zinc-800 text-zinc-100 rounded px-3 py-1.5 min-w-[220px]"
            >
              {persons.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#141418] text-zinc-100">
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
                    ? 'border-red-900/60 bg-red-950/40 text-red-300'
                    : stat.highlight
                    ? 'border-emerald-500/40 bg-emerald-950/30 text-white'
                    : 'bg-[#121215]'
                }`}
              >
                <span
                  className={`text-[9px] font-mono uppercase tracking-wider block truncate ${
                    stat.highlight ? 'text-emerald-400 font-semibold' : stat.isAlert ? 'text-red-400 font-bold' : 'text-zinc-400'
                  }`}
                >
                  {stat.label}
                </span>
                <p
                  className={`text-sm font-bold font-mono mt-1 truncate ${
                    stat.highlight ? 'text-white' : stat.isAlert ? 'text-red-300 font-black' : 'text-zinc-100'
                  }`}
                  title={String(stat.value)}
                >
                  {stat.value}
                </p>
                <span
                  className={`text-[9px] font-mono block mt-0.5 truncate ${
                    stat.highlight ? 'text-zinc-400' : 'text-zinc-500'
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
          {/* ────────────────────────────────────────────────────────────────────────── */}
          {/* PROFILE SUMMARY + ANOMALY ALERTS BANNER                                    */}
          {/* ────────────────────────────────────────────────────────────────────────── */}
          <div className="card p-5 bg-[#121215] border border-zinc-800">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 flex items-center justify-center font-mono font-bold text-base shadow-[0_0_15px_rgba(16,185,129,0.15)]">
                  {target.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-white tracking-tight">{target.name}</h2>
                    <span className="badge bg-emerald-950/60 border border-emerald-500/50 text-emerald-400 font-mono text-[10px] tracking-wider">
                      PRIMARY SUSPECT
                    </span>
                    {target.source_record_id && (
                      <button
                        onClick={() => handleOpenEvidenceById(target.source_record_id!)}
                        className="badge bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono text-[10px] cursor-pointer transition-colors"
                      >
                        Evidence Record #{target.source_record_id} ↗
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 font-mono mt-0.5">
                    Node ID: <span className="text-zinc-300">{target.id}</span> • Resolution Confidence:{' '}
                    <strong className="text-emerald-400">
                      {target.confidence != null ? `${Math.round(target.confidence * 100)}%` : 'Not available in source'}
                    </strong>
                  </p>
                </div>
              </div>

              {/* Alerts Badge */}
              <div className="flex items-center gap-2">
                {profile.alerts && profile.alerts.length > 0 ? (
                  <div className="p-2 px-3.5 bg-red-950/40 border border-red-500/40 rounded-lg text-xs text-red-300 flex items-center gap-2 shadow-[0_0_12px_rgba(239,68,68,0.2)] font-mono">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                    <span className="font-semibold tracking-wide">{profile.alerts.length} Suspicious Graph Anomalies Detected</span>
                  </div>
                ) : (
                  <div className="p-2 px-3.5 bg-emerald-950/40 border border-emerald-500/40 rounded-lg text-xs text-emerald-300 font-mono flex items-center gap-1.5">
                    <span>✓</span> No Anomalous Risk Alerts Flagged
                  </div>
                )}
              </div>
            </div>

            {/* If alerts exist, display summary explanations in dark card style */}
            {profile.alerts && profile.alerts.length > 0 && (
              <div className="mt-4 pt-3.5 border-t border-zinc-800/90 space-y-2.5">
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest block flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  <span>Detected Pattern Details:</span>
                </span>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {profile.alerts.map((al, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-[#16161a] hover:bg-[#1a1a20] border border-red-900/40 hover:border-red-500/50 rounded-lg text-xs transition-all"
                    >
                      <div className="flex justify-between items-center font-mono text-[10px] mb-1.5">
                        <span className="font-bold text-red-400 uppercase tracking-wider">{al.pattern_type}</span>
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-950/80 border border-red-500/50 text-red-300">
                          Risk: {al.risk_score}/100
                        </span>
                      </div>
                      <p className="text-xs text-zinc-300 leading-relaxed font-mono text-[11px]">{al.explanation}</p>
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
            <div className="card p-5 space-y-4 flex flex-col bg-[#121215] border border-zinc-800">
              <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
                <div>
                  <h3 className="text-xs font-mono text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>1. Person Connections & Associates</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Direct relevant connections to {target.name}.
                  </p>
                </div>
                <span className="badge bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 font-mono text-[10px]">
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
                <div className="p-6 text-center text-xs text-zinc-500 italic font-mono">
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
                        <tr key={idx} className="hover:bg-zinc-800/40 transition-colors">
                          <td className="font-bold text-zinc-100 text-xs">{p.name}</td>
                          <td>
                            <span className="badge bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-[10px]">
                              {p.relationship_type}
                            </span>
                          </td>
                          <td className="font-mono text-xs text-zinc-400">
                            {p.confidence != null ? `${Math.round(p.confidence * 100)}%` : '—'}
                          </td>
                          <td>
                            {p.evidence_source_id ? (
                              <button
                                onClick={() => handleOpenEvidenceById(p.evidence_source_id!)}
                                className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer"
                              >
                                Record #{p.evidence_source_id}
                              </button>
                            ) : (
                              <span className="text-[10px] text-zinc-500">—</span>
                            )}
                          </td>
                          <td>
                            <button
                              onClick={() => handleSelectPerson(p.person_id)}
                              className="text-xs text-emerald-400 font-semibold hover:text-emerald-300 hover:underline cursor-pointer font-mono"
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
            <div className="card p-5 space-y-4 flex flex-col bg-[#121215] border border-zinc-800">
              <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
                <div>
                  <h3 className="text-xs font-mono text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                    <span>5. Communication History</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Chronological voice calls & intercepts involving {target.name}.
                  </p>
                </div>
                <span className="badge bg-purple-950/60 border border-purple-500/40 text-purple-300 font-mono text-[10px]">
                  {profile.communications.length} Records
                </span>
              </div>

              {profile.communications.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-500 italic font-mono">
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
                        <tr key={comm.id} className="hover:bg-zinc-800/40 transition-colors">
                          <td className="text-zinc-400 font-mono text-[11px] whitespace-nowrap">
                            {comm.timestamp || '—'}
                          </td>
                          <td className="font-semibold text-zinc-100 text-xs">{comm.from_party}</td>
                          <td className="font-semibold text-zinc-100 text-xs">{comm.to_party}</td>
                          <td className="font-mono text-[10px] text-zinc-400">{comm.channel}</td>
                          <td>
                            <span className="badge bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 font-mono text-[10px]">
                              {comm.event_type}
                            </span>
                          </td>
                          <td>
                            {comm.evidence_source_id ? (
                              <button
                                onClick={() => handleOpenEvidenceById(comm.evidence_source_id!)}
                                className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer"
                              >
                                #{comm.evidence_source_id}
                              </button>
                            ) : (
                              <span className="text-[10px] text-zinc-500">—</span>
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
            <div className="card p-5 space-y-4 bg-[#121215] border border-zinc-800">
              <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
                <div>
                  <h3 className="text-xs font-mono text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-violet-400" />
                    <span>2. Location History & Sightings</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Sites and meeting points linked to {target.name}.
                  </p>
                </div>
                <span className="badge bg-violet-950/60 border border-violet-500/40 text-violet-300 font-mono text-[10px]">
                  {profile.locations.length} Sites
                </span>
              </div>

              {profile.locations.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-500 italic font-mono">
                  No records found for this entity.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* If any location has real coordinates, render an OpenStreetMap preview without paid APIs */}
                  {profile.locations.some((l) => l.latitude != null && l.longitude != null) ? (
                    <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900 h-48 relative">
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
                          <tr key={idx} className="hover:bg-zinc-800/40 transition-colors">
                            <td className="font-mono text-zinc-400 text-[11px] whitespace-nowrap">
                              {loc.timestamp || '—'}
                            </td>
                            <td className="font-semibold text-zinc-100 text-xs">{loc.location_name}</td>
                            <td>
                              <span className="badge bg-violet-950/60 border border-violet-500/40 text-violet-300 font-mono text-[10px]">
                                {loc.relationship_type}
                              </span>
                            </td>
                            <td className="font-mono text-[11px] text-zinc-400">
                              {loc.confidence != null ? `${Math.round(loc.confidence * 100)}%` : '—'}
                            </td>
                            <td>
                              {loc.evidence_source_id ? (
                                <button
                                  onClick={() => handleOpenEvidenceById(loc.evidence_source_id!)}
                                  className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer"
                                >
                                  #{loc.evidence_source_id}
                                </button>
                              ) : (
                                <span className="text-[10px] text-zinc-500">—</span>
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
            <div className="card p-5 space-y-4 bg-[#121215] border border-zinc-800">
              <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
                <div>
                  <h3 className="text-xs font-mono text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-400" />
                    <span>4. Vehicle Intelligence</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Vehicles operated, owned, or sighted with {target.name}.
                  </p>
                </div>
                <span className="badge bg-rose-950/60 border border-rose-500/40 text-rose-300 font-mono text-[10px]">
                  {profile.vehicles.length} Vehicles
                </span>
              </div>

              {profile.vehicles.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-500 italic font-mono">
                  No records found for this entity.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {profile.vehicles.map((v, idx) => (
                    <div key={idx} className="p-3.5 bg-[#16161a] border border-zinc-800 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-white text-sm tracking-wide">{v.vehicle_number}</span>
                        <span className="badge bg-rose-950/60 border border-rose-500/40 text-rose-300 font-mono text-[10px]">
                          {v.relationship_type}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs text-zinc-400 font-mono text-[11px]">
                        <p>
                          <span className="text-zinc-500">Operator:</span>{' '}
                          <strong className="text-zinc-200">{v.owner || target.name}</strong>
                        </p>
                        <p>
                          <span className="text-zinc-500">Details:</span>{' '}
                          <span className="text-zinc-300">{v.details || '—'}</span>
                        </p>
                        <p>
                          <span className="text-zinc-500">Seen:</span>{' '}
                          <span className="text-zinc-400">{v.timestamp || '—'}</span>
                        </p>
                      </div>
                      <div className="pt-2 border-t border-zinc-800 flex justify-between items-center text-[10px] font-mono">
                        <span className="text-zinc-500">
                          Conf: {v.confidence != null ? `${Math.round(v.confidence * 100)}%` : '—'}
                        </span>
                        {v.evidence_source_id && (
                          <button
                            onClick={() => handleOpenEvidenceById(v.evidence_source_id!)}
                            className="text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer font-bold"
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
          <div className="card p-5 space-y-4 bg-[#121215] border border-zinc-800">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-xs font-mono text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>3. Financial Transaction History</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Ledger flows between accounts associated with {target.name}.
                </p>
              </div>

              {/* Tabs for Incoming / Outgoing */}
              <div className="flex items-center gap-1 bg-[#18181c] p-1 rounded-md text-xs font-mono border border-zinc-800">
                {(['ALL', 'INCOMING', 'OUTGOING'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setTransactionTab(tab)}
                    className={`px-3 py-1 rounded cursor-pointer transition-colors ${
                      transactionTab === tab ? 'bg-emerald-500 font-bold text-zinc-950 shadow-xs' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {filteredTransactions.length === 0 ? (
              <div className="p-8 text-center text-xs text-zinc-500 italic font-mono">
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
                      <tr key={t.id} className="hover:bg-zinc-800/40 transition-colors">
                        <td>
                          <span
                            className={`badge font-mono text-[10px] ${
                              t.direction === 'INCOMING' ? 'badge-success' : 'badge-high'
                            }`}
                          >
                            {t.direction}
                          </span>
                        </td>
                        <td className="font-mono text-zinc-400 text-[11px] whitespace-nowrap">
                          {t.timestamp || '—'}
                        </td>
                        <td className="font-mono font-semibold text-zinc-100 text-xs">{t.source_account}</td>
                        <td className="font-mono font-semibold text-zinc-100 text-xs">{t.destination_account}</td>
                        <td className="font-mono font-semibold text-xs text-emerald-400">
                          {t.amount != null ? `₹${t.amount}` : <span className="text-zinc-500 italic">—</span>}
                        </td>
                        <td>
                          <span className="badge bg-amber-950/60 border border-amber-500/40 text-amber-300 font-mono text-[10px]">
                            {t.transaction_type}
                          </span>
                        </td>
                        <td className="text-zinc-200 font-semibold text-xs">
                          {t.associated_person || '—'}
                        </td>
                        <td>
                          {t.evidence_source_id ? (
                            <button
                              onClick={() => handleOpenEvidenceById(t.evidence_source_id!)}
                              className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer"
                            >
                              Record #{t.evidence_source_id}
                            </button>
                          ) : (
                            <span className="text-[10px] text-zinc-500">—</span>
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
          <div className="card p-5 space-y-4 bg-[#121215] border border-zinc-800">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-xs font-mono text-zinc-300 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  <span>6. Corroborating Evidence & Source References</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Underlying documents in PostgreSQL establishing intelligence facts for {target.name}.
                </p>
              </div>
              <span className="badge bg-blue-950/60 border border-blue-500/40 text-blue-300 font-mono text-[10px]">
                {profile.evidence_records.length} Documents
              </span>
            </div>

            {profile.evidence_records.length === 0 ? (
              <div className="p-6 text-center text-xs text-zinc-500 italic font-mono">
                No records found for this entity.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {profile.evidence_records.map((rec) => (
                  <div
                    key={rec.id}
                    onClick={() => setActiveEvidence(rec)}
                    className="p-3.5 bg-[#16161a] hover:bg-[#1a1a20] border border-zinc-800 hover:border-zinc-700 rounded-lg space-y-2 cursor-pointer transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="badge bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-[10px]">
                        {rec.source_type}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-500">ID #{rec.id}</span>
                    </div>
                    <h4 className="font-bold text-zinc-100 text-xs truncate group-hover:text-emerald-400 transition-colors">{rec.title}</h4>
                    {rec.content_snippet && (
                      <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed font-mono">
                        {rec.content_snippet}
                      </p>
                    )}
                    <div className="pt-2 border-t border-zinc-800 flex justify-between items-center text-[10px] font-mono text-zinc-500">
                      <span>{rec.created_at ? new Date(rec.created_at).toLocaleDateString() : '—'}</span>
                      <span className="text-emerald-400 font-semibold group-hover:text-emerald-300 transition-colors">Inspect Evidence →</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 7. INTERACTIVE NETWORK GRAPH ─────────────────────────────────── */}
          <div className="card p-5 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-zinc-100 pb-4">
              <div>
                <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-widest">
                  7. Interactive Neighborhood Network Graph
                </h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Topological link visualization centered on {target.name}. Click any node to inspect details.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Layout Mode switcher */}
                <div className="flex items-center bg-zinc-900 border border-zinc-800 p-1 rounded-md text-xs font-mono">
                  <button
                    onClick={() => setLayoutMode('tree')}
                    className={`px-2.5 py-1 rounded cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                      layoutMode === 'tree' ? 'bg-emerald-500 text-zinc-950 font-bold shadow-xs' : 'text-zinc-400 hover:text-white'
                    }`}
                    title="Top-down hierarchical tree structure"
                  >
                    <span>🌲</span> Tree Hierarchy
                  </button>
                  <button
                    onClick={() => setLayoutMode('radial_tree')}
                    className={`px-2.5 py-1 rounded cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                      layoutMode === 'radial_tree' ? 'bg-emerald-500 text-zinc-950 font-bold shadow-xs' : 'text-zinc-400 hover:text-white'
                    }`}
                    title="Concentric radial hop rings"
                  >
                    <span>🎯</span> Concentric Radial
                  </button>
                </div>

                {/* Scope tabs */}
                <div className="flex items-center bg-zinc-900 border border-zinc-800 p-1 rounded-md text-xs font-mono">
                  {(['focused', '2hop', 'full'] as const).map((sc) => (
                    <button
                      key={sc}
                      onClick={() => setGraphScope(sc)}
                      className={`px-2.5 py-1 rounded cursor-pointer transition-colors whitespace-nowrap ${
                        graphScope === sc ? 'bg-emerald-500 text-zinc-950 font-bold shadow-xs' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {sc === 'focused' ? '1-Hop Immediate' : sc === '2hop' ? '2-Hop Network' : 'Full Graph'}
                    </button>
                  ))}
                </div>

                {/* Zoom & View controls */}
                <div className="flex items-center bg-zinc-900 border border-zinc-800 p-1 rounded-md gap-1">
                  <button onClick={zoomIn} className="px-2 py-1 text-xs font-bold text-zinc-300 hover:text-white cursor-pointer rounded hover:bg-zinc-800 transition-colors" title="Zoom In (+)">+</button>
                  <button onClick={zoomOut} className="px-2 py-1 text-xs font-bold text-zinc-300 hover:text-white cursor-pointer rounded hover:bg-zinc-800 transition-colors" title="Zoom Out (−)">−</button>
                  <button
                    onClick={() => fitToView(Object.values(nodePositions))}
                    className="px-2 py-1 text-xs font-mono text-zinc-300 hover:text-white cursor-pointer rounded hover:bg-zinc-800 transition-colors flex items-center gap-1"
                    title="Fit all nodes to view (Center graph)"
                  >
                    <span>⛶</span> Fit
                  </button>
                  <button onClick={resetZoom} className="px-2 py-0.5 text-[10px] font-mono text-zinc-400 cursor-pointer hover:text-white rounded hover:bg-zinc-800 transition-colors" title="100% Reset">
                    {Math.round(transform.k * 100)}%
                  </button>
                </div>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1">Filter Entity Type</label>
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="form-select text-xs font-mono">
                  <option value="ALL">All Entity Types</option>
                  {['PERSON','PHONE','ACCOUNT','VEHICLE','LOCATION','CASE'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1">Filter Relationship Type</label>
                <select value={relFilter} onChange={(e) => setRelFilter(e.target.value)} className="form-select text-xs font-mono">
                  <option value="ALL">All Relationship Types</option>
                  {availableRelTypes.map((rt) => <option key={rt} value={rt}>{rt}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-mono text-zinc-400 uppercase tracking-widest mb-1">Search in Graph</label>
                <input type="text" placeholder="Filter node label / name…" value={graphSearch} onChange={(e) => setGraphSearch(e.target.value)} className="form-input text-xs" />
              </div>
            </div>

            {/* Graph Canvas */}
            <div
              ref={containerRef}
              className={`relative border border-zinc-800 rounded-xl overflow-hidden bg-[#09090b] select-none ${
                isPanning ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              style={{ height: '680px' }}
              onMouseDown={onMouseDown}
              onDoubleClick={(e) => {
                if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'svg') {
                  fitToView(Object.values(nodePositions));
                }
              }}
            >
              {/* Dot grid */}
              <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none" />

              {loadingFullNetwork ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <CrimeGraphLoader size={28} text="Loading full network graph…" />
                </div>
              ) : displayedGraph.nodes.length === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center space-y-2">
                    <div className="text-3xl">🕸️</div>
                    <p className="text-xs font-mono text-zinc-400">No nodes matching current filters.</p>
                    <button onClick={() => { setTypeFilter('ALL'); setRelFilter('ALL'); setGraphSearch(''); }} className="text-xs text-zinc-500 underline cursor-pointer hover:text-black">Clear filters</button>
                  </div>
                </div>
              ) : (
                <svg
                  className="w-full h-full block select-none pointer-events-auto"
                >
                  <defs>
                    <marker id="nw-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill="#71717a" />
                    </marker>
                    <marker id="nw-arrow-highlight" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                      <polygon points="0 0, 8 3, 0 6" fill="#10b981" />
                    </marker>
                    <filter id="nw-glow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    <filter id="nw-center-glow" x="-50%" y="-50%" width="200%" height="200%">
                      <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#10b981" floodOpacity="0.7" />
                    </filter>
                  </defs>

                  <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
                    {/* Consolidated Edges (Removes the 408 overlapping lines clutter) */}
                    {consolidatedEdges.map((edge) => {
                      const sPos = getNodePos(edge.source);
                      const tPos = getNodePos(edge.target);
                      if (!sPos || !tPos) return null;

                      const dx = tPos.x - sPos.x;
                      const dy = tPos.y - sPos.y;
                      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                      const srcNode = displayedGraph.nodes.find((n) => n.id === edge.source);
                      const tgtNode = displayedGraph.nodes.find((n) => n.id === edge.target);
                      const srcR = getNodeRadius(srcNode as GraphNode) + 2;
                      const tgtR = getNodeRadius(tgtNode as GraphNode) + 8;
                      const x1 = sPos.x + (dx / dist) * srcR;
                      const y1 = sPos.y + (dy / dist) * srcR;
                      const x2 = tPos.x - (dx / dist) * tgtR;
                      const y2 = tPos.y - (dy / dist) * tgtR;
                      const midX = (x1 + x2) / 2;
                      const midY = (y1 + y2) / 2;

                      const isSelected = drawerNode?.id === edge.source || drawerNode?.id === edge.target;
                      const isHoverConnected = hoverState && (edge.source === hoverState.id || edge.target === hoverState.id);
                      const isHighlighted = isSelected || isHoverConnected;
                      const isMuted = hoverState && !isHoverConnected;
                      const edgeColor = getEdgeColor(edge.primaryType);

                      // For tree hierarchy: downward flowing bezier curve
                      const isCurved = layoutMode === 'tree' && Math.abs(y2 - y1) > 25;
                      const pathD = isCurved
                        ? `M ${x1} ${y1} C ${x1} ${y1 + (y2 - y1) * 0.55}, ${x2} ${y1 + (y2 - y1) * 0.45}, ${x2} ${y2}`
                        : `M ${x1} ${y1} L ${x2} ${y2}`;

                      // Only display edge labels when hovering/selected or always enabled
                      const shouldShowLabel = edgeLabelMode === 'always' || (edgeLabelMode === 'hover' && isHighlighted);
                      const labelText = edge.count > 1 ? `${edge.primaryType} (${edge.count})` : edge.primaryType;
                      const pillWidth = Math.max(38, labelText.length * 6.5 + 12);
                      const strokeW = isHighlighted ? 2.5 : Math.min(1.2 + Math.log2(edge.count + 1) * 0.4, 3.2);

                      return (
                        <g key={edge.id} style={{ transition: 'opacity 150ms ease-out' }} opacity={isMuted ? 0.08 : 1}>
                          <path
                            d={pathD}
                            fill="none"
                            stroke={isHighlighted ? '#10b981' : edgeColor}
                            strokeWidth={strokeW}
                            strokeOpacity={isHighlighted ? 1 : 0.55}
                            markerEnd={isHighlighted ? 'url(#nw-arrow-highlight)' : 'url(#nw-arrow)'}
                          />
                          {shouldShowLabel && dist > 45 && (
                            <g transform={`translate(${midX}, ${midY})`}>
                              <rect
                                x={-pillWidth / 2}
                                y={-7}
                                width={pillWidth}
                                height={14}
                                rx={3}
                                fill="#09090b"
                                stroke={isHighlighted ? '#10b981' : edgeColor}
                                strokeWidth={isHighlighted ? 1.5 : 1}
                                strokeOpacity={isHighlighted ? 1 : 0.8}
                              />
                              <text
                                x={0}
                                y={3}
                                fill={isHighlighted ? '#10b981' : '#e4e4e7'}
                                fontSize="7"
                                fontFamily="monospace"
                                fontWeight={isHighlighted ? 700 : 500}
                                textAnchor="middle"
                                className="select-none pointer-events-none"
                              >
                                {labelText}
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                    {/* Nodes with High-Contrast Protected Labels */}
                    {displayedGraph.nodes.map((node) => {
                      const pos = getNodePos(node.id);
                      if (!pos) return null;
                      const isCenter = node.id === selectedPersonId;
                      const isActive = drawerNode?.id === node.id;
                      const isHovered = hoveredNodeId === node.id;
                      const isNeighbor = hoverState?.connected.has(node.id);
                      const isMuted = hoverState && !isNeighbor;

                      const r = getNodeRadius(node);
                      const style = getNodeStyle(node.labels);
                      const rawName = node.name || node.id.split(':').slice(1).join(':') || node.id;
                      const maxLen = isCenter ? 22 : 18;
                      const displayName = rawName.length > maxLen ? `${rawName.slice(0, maxLen - 1)}…` : rawName;
                      const primaryLabel = node.labels?.[0]?.toUpperCase() || 'ENTITY';
                      const labelPillW = Math.max(displayName.length * 7.4 + 16, 68);

                      // Influencer intelligence role (Kingpin, Broker, Money Mule, etc.)
                      const influencer = influencerMap.get(node.id);
                      const badgeText = influencer ? `${influencer.badge_icon} ${influencer.role}` : primaryLabel.slice(0, 7);
                      const badgePillW = Math.max(badgeText.length * 6.8 + 14, 46);
                      const badgeColor = influencer ? influencer.badge_color : (isCenter || isHovered ? '#10b981' : '#71717a');

                      return (
                        <g
                          key={node.id}
                          onMouseDown={(e) => handleNodeMouseDown(e, node)}
                          onMouseEnter={() => setHoveredNodeId(node.id)}
                          onMouseLeave={() => setHoveredNodeId(null)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            focusNode(pos.x, pos.y, 1.4);
                          }}
                          style={{
                            cursor: isHovered ? 'grab' : 'pointer',
                            transition: 'opacity 150ms ease-out',
                          }}
                          opacity={isMuted ? 0.2 : 1}
                        >
                          {/* Outer glow ring */}
                          {(isCenter || isActive || isHovered || isNeighbor || influencer?.role === 'KINGPIN' || influencer?.role === 'BROKER') && (
                            <circle
                              cx={pos.x} cy={pos.y} r={r + (isHovered ? 10 : 8)}
                              fill="none"
                              stroke={isCenter ? '#10b981' : isHovered ? '#34d399' : influencer ? influencer.badge_color : style.fill}
                              strokeWidth={isHovered ? 2.5 : 2}
                              strokeOpacity={isHovered ? 0.8 : 0.45}
                              strokeDasharray={isCenter ? '4 2' : influencer?.role === 'KINGPIN' ? '3 1.5' : undefined}
                            />
                          )}

                          {/* Node Circle */}
                          <circle
                            cx={pos.x} cy={pos.y} r={r}
                            fill={isCenter ? '#18181b' : style.fill}
                            stroke={isCenter ? '#10b981' : isHovered ? '#ffffff' : isActive ? '#ffffff' : influencer ? influencer.badge_color : style.stroke}
                            strokeWidth={isCenter ? 2.5 : isHovered ? 2.5 : isActive ? 2 : influencer?.role === 'KINGPIN' ? 2.2 : 1.2}
                            filter={isCenter ? 'url(#nw-center-glow)' : (isActive || isHovered) ? 'url(#nw-glow)' : undefined}
                          />

                          {/* Explicit Influence Role Badge or Entity Tag above node */}
                          <g transform={`translate(${pos.x}, ${pos.y - r - 9})`}>
                            <rect
                              x={-badgePillW / 2}
                              y={-7}
                              width={badgePillW}
                              height={14}
                              rx={4}
                              fill="#101014"
                              stroke={badgeColor}
                              strokeWidth={influencer ? 1.4 : isHovered ? 1.2 : 0.8}
                              strokeOpacity={influencer ? 0.95 : 0.7}
                            />
                            <text
                              x={0}
                              y={3}
                              textAnchor="middle"
                              fontSize={influencer ? "7.5" : "6.5"}
                              fontFamily="monospace"
                              fontWeight="bold"
                              fill={badgeColor}
                              className="select-none pointer-events-none"
                            >
                              {badgeText}
                            </text>
                          </g>

                          {/* Center Node Icon / Monogram */}
                          {isCenter && (
                            <text
                              x={pos.x} y={pos.y + 1}
                              textAnchor="middle" dominantBaseline="middle"
                              fontSize="8.5" fontFamily="monospace" fontWeight="bold"
                              fill="#10b981"
                              className="select-none pointer-events-none"
                            >
                              ROOT
                            </text>
                          )}

                          {/* Protected Name Label Card below node (Never crossed out by lines) */}
                          <g transform={`translate(${pos.x}, ${pos.y + r + 14})`}>
                            <rect
                              x={-labelPillW / 2}
                              y={-8}
                              width={labelPillW}
                              height={16}
                              rx={4}
                              fill="#09090b"
                              stroke={isCenter || isHovered ? '#10b981' : isActive ? '#ffffff' : '#27272a'}
                              strokeWidth={1}
                            />
                            <text
                              x={0}
                              y={3.5}
                              textAnchor="middle"
                              fontSize={isCenter ? '9.5' : '8.5'}
                              fontFamily="monospace"
                              fontWeight={isCenter || isHovered ? 'bold' : 'normal'}
                              fill={isCenter || isHovered ? '#10b981' : isActive ? '#ffffff' : '#e4e4e7'}
                              className="select-none pointer-events-none"
                            >
                              {displayName}
                            </text>
                          </g>

                          {/* Low-confidence indicator dot */}
                          {!isCenter && node.confidence != null && node.confidence < 0.6 && (
                            <circle cx={pos.x + r - 3} cy={pos.y - r + 3} r={4} fill="#ef4444" stroke="#09090b" strokeWidth="1.5" />
                          )}
                        </g>
                      );
                    })}
                  </g>
                </svg>
              )}

              {/* Floating On-Canvas Controller Dock (Always in view) */}
              <div className="absolute top-3 right-3 z-30 flex items-center gap-2 flex-wrap">
                {/* Layout Mode Switcher */}
                <div className="bg-[#101014]/95 backdrop-blur-md border border-zinc-800 rounded-lg p-1 flex items-center gap-1 shadow-lg text-xs font-mono">
                  <button
                    onClick={() => setLayoutMode('tree')}
                    className={`px-2.5 py-1 rounded cursor-pointer transition-all flex items-center gap-1.5 ${
                      layoutMode === 'tree' ? 'bg-emerald-500 text-zinc-950 font-bold shadow-xs' : 'text-zinc-400 hover:text-white'
                    }`}
                    title="Organized hierarchical tree (Suspect -> Associates -> Accounts -> Logistics)"
                  >
                    <span>🌲</span> Org Tree
                  </button>
                  <button
                    onClick={() => setLayoutMode('radial_tree')}
                    className={`px-2.5 py-1 rounded cursor-pointer transition-all flex items-center gap-1.5 ${
                      layoutMode === 'radial_tree' ? 'bg-emerald-500 text-zinc-950 font-bold shadow-xs' : 'text-zinc-400 hover:text-white'
                    }`}
                    title="Concentric radial rings around primary suspect"
                  >
                    <span>🎯</span> Radial
                  </button>
                </div>

                {/* Edge Label Visibility Toggle */}
                <button
                  onClick={() => setEdgeLabelMode((m) => (m === 'hover' ? 'always' : m === 'always' ? 'none' : 'hover'))}
                  className="bg-[#101014]/95 backdrop-blur-md border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white px-2.5 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 shadow-lg cursor-pointer transition-colors"
                  title="Toggle edge relationship labels: on hover, always visible, or hidden"
                >
                  <span>🏷️</span> Labels: <strong className="text-emerald-400 uppercase">{edgeLabelMode}</strong>
                </button>

                {/* D-Pad Pan & Zoom Navigation Controller */}
                <div className="bg-[#101014]/95 backdrop-blur-md border border-zinc-800 rounded-lg p-1 flex items-center gap-1 shadow-lg">
                  <button onClick={() => panBy(120, 0)} className="w-6 h-6 flex items-center justify-center text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 rounded cursor-pointer" title="Pan Left">◀</button>
                  <button onClick={() => panBy(0, 120)} className="w-6 h-6 flex items-center justify-center text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 rounded cursor-pointer" title="Pan Up">▲</button>
                  <button onClick={() => panBy(0, -120)} className="w-6 h-6 flex items-center justify-center text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 rounded cursor-pointer" title="Pan Down">▼</button>
                  <button onClick={() => panBy(-120, 0)} className="w-6 h-6 flex items-center justify-center text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 rounded cursor-pointer" title="Pan Right">▶</button>
                  <div className="w-[1px] h-4 bg-zinc-800 mx-0.5" />
                  <button onClick={zoomIn} className="w-6 h-6 flex items-center justify-center text-xs font-bold text-zinc-300 hover:text-white hover:bg-zinc-800 rounded cursor-pointer" title="Zoom In">+</button>
                  <button onClick={zoomOut} className="w-6 h-6 flex items-center justify-center text-xs font-bold text-zinc-300 hover:text-white hover:bg-zinc-800 rounded cursor-pointer" title="Zoom Out">−</button>
                  <button
                    onClick={() => fitToView(Object.values(nodePositions))}
                    className="px-2 py-0.5 text-xs font-mono text-zinc-300 hover:text-white hover:bg-zinc-800 rounded cursor-pointer flex items-center gap-1"
                    title="Fit graph to view"
                  >
                    ⛶ Fit
                  </button>
                  <button onClick={resetZoom} className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 hover:text-white rounded cursor-pointer" title="Reset Zoom">
                    {Math.round(transform.k * 100)}%
                  </button>
                </div>
              </div>

              {/* Legend & Role Key */}
              <div className="absolute bottom-3 left-3 z-20 bg-[#101014]/95 backdrop-blur-md border border-zinc-800 rounded-lg p-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] font-mono text-zinc-300 shadow-md max-w-md">
                <div className="w-full flex items-center justify-between border-b border-zinc-800/80 pb-1 mb-0.5 text-[9px] text-zinc-400 uppercase tracking-wider font-bold">
                  <span>Graph Centrality Roles</span>
                  <span className="text-emerald-400">PageRank • Betweenness</span>
                </div>
                <div className="flex items-center gap-1 text-amber-400 font-bold">
                  <span>👑</span> KINGPIN
                </div>
                <div className="flex items-center gap-1 text-sky-400 font-bold">
                  <span>🔄</span> BROKER
                </div>
                <div className="flex items-center gap-1 text-emerald-400 font-bold">
                  <span>💸</span> MONEY MULE
                </div>
                <div className="flex items-center gap-1 text-purple-400 font-bold">
                  <span>📞</span> DISPATCH
                </div>
                <div className="w-full border-t border-zinc-800/60 pt-1 mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  {Object.entries(NODE_COLORS).filter(([k]) => !['BANK_ACCOUNT','ORGANIZATION','EVENT'].includes(k)).map(([label, style]) => (
                    <div key={label} className="flex items-center gap-1 text-zinc-400">
                      <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: style.fill }} />
                      {label}
                    </div>
                  ))}
                </div>
              </div>

              {/* Node/Edge count + HUD interaction banner */}
              <div className="absolute top-3 left-3 z-20 flex items-center gap-2 flex-wrap">
                <div className="bg-[#101014]/90 backdrop-blur-sm border border-zinc-800 rounded px-2.5 py-1 text-[10px] font-mono text-emerald-400 shadow-sm">
                  {displayedGraph.nodes.length} Nodes • {consolidatedEdges.length} Links ({displayedGraph.edges.length} total)
                </div>
                {hoverState ? (
                  <div className="bg-emerald-950/80 border border-emerald-500/40 rounded px-2.5 py-1 text-[10px] font-mono text-emerald-300 shadow-sm flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Focus: <strong>{hoverState.name}</strong> ({hoverState.degree} links) • Double-Click to Zoom</span>
                  </div>
                ) : (
                  <div className="bg-[#101014]/90 backdrop-blur-sm border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-zinc-400 shadow-sm hidden sm:block">
                    Scroll to Zoom • Drag Canvas to Pan • Drag Nodes to Reposition • Double-Click to Focus
                  </div>
                )}
              </div>

              {/* Selected node quick-pill */}
              {drawerNode && (
                <div className="absolute top-3 right-3 z-20 bg-[#101014] border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono shadow-md flex items-center gap-2 max-w-[200px]">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getNodeStyle(drawerNode.labels).fill }} />
                  <span className="truncate font-semibold text-zinc-200">{drawerNode.name || drawerNode.id}</span>
                  <button onClick={() => setDrawerNode(null)} className="text-zinc-400 hover:text-white ml-auto flex-shrink-0 cursor-pointer">✕</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Entity Detail Drawer */}
      {drawerNode && (
        <EntityDetailDrawer
          node={drawerNode}
          allNodes={displayedGraph.nodes}
          allEdges={displayedGraph.edges}
          influencer={influencerMap.get(drawerNode.id)}
          onClose={() => setDrawerNode(null)}
          onSelectEntity={(nodeId) => { if (nodeId.startsWith('PERSON:')) handleSelectPerson(nodeId); }}
          onOpenEvidence={handleOpenEvidenceById}
        />
      )}

      {/* Evidence Preview Modal — click outside to dismiss */}
      {activeEvidence && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
          onClick={() => setActiveEvidence(null)}
        >
          <div className="card w-full max-w-lg p-6 space-y-4 shadow-2xl relative bg-[#121215] border border-zinc-800" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start border-b border-zinc-800 pb-3">
              <div>
                <span className="badge bg-zinc-900 border border-zinc-700 text-emerald-400 font-mono text-[10px]">{activeEvidence.source_type} EVIDENCE RECORD</span>
                <h3 className="text-base font-bold text-white mt-1">{activeEvidence.title}</h3>
                <p className="text-xs text-zinc-400 font-mono">
                  Record ID #{activeEvidence.id} •{' '}
                  {activeEvidence.created_at ? new Date(activeEvidence.created_at).toLocaleString() : 'N/A'}
                </p>
              </div>
              <button onClick={() => setActiveEvidence(null)} className="text-zinc-400 hover:text-white p-1 cursor-pointer">✕</button>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 block">Evidence Content Snippet</span>
              <pre className="p-3 bg-zinc-50 border border-zinc-200 rounded text-xs font-mono text-zinc-800 whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed">
                {activeEvidence.content_snippet || 'No document text content available.'}
              </pre>
            </div>

            <div className="pt-2 flex justify-between items-center">
              <Link to={`/cases/${activeEvidence.id}`} className="btn-primary text-xs px-3.5 py-1.5">Inspect Full Case Envelope →</Link>
              <button onClick={() => setActiveEvidence(null)} className="btn-secondary text-xs px-3.5 py-1.5 cursor-pointer">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
