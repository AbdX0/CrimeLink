import type { PersonConnectionItem } from '../api/graph';

interface FocusedPersonGraphProps {
  centerPersonName: string;
  connections: PersonConnectionItem[];
  onSelectPerson?: (personId: string) => void;
}

export default function FocusedPersonGraph({
  centerPersonName,
  connections,
  onSelectPerson,
}: FocusedPersonGraphProps) {
  if (connections.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-zinc-400 font-mono bg-zinc-50 border border-zinc-200 rounded-lg">
        No direct person-to-person connections detected for this individual.
      </div>
    );
  }

  const width = 440;
  const height = 280;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(105, 60 + connections.length * 10);

  return (
    <div className="relative w-full overflow-hidden bg-[#101014] border border-zinc-800 rounded-lg p-3">
      <div className="absolute top-2 left-2 z-10">
        <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
          Person-to-Person Graph ({connections.length})
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto max-h-[280px]"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="18"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
          </marker>
        </defs>

        {/* Edges */}
        {connections.map((conn, idx) => {
          const angle = (idx / connections.length) * 2 * Math.PI - Math.PI / 2;
          const x = cx + radius * Math.cos(angle);
          const y = cy + radius * Math.sin(angle);
          const midX = (cx + x) / 2;
          const midY = (cy + y) / 2;

          return (
            <g key={conn.person_id + idx}>
              <line
                x1={cx}
                y1={cy}
                x2={x}
                y2={y}
                stroke="#3f3f46"
                strokeWidth="1.5"
                strokeDasharray={conn.relationship_type === 'ASSOCIATED_WITH' ? '3 3' : undefined}
                markerEnd="url(#arrow)"
              />
              <text
                x={midX}
                y={midY - 4}
                textAnchor="middle"
                fontSize="8"
                fontFamily="monospace"
                fill="#a1a1aa"
                className="select-none font-semibold"
              >
                {conn.relationship_type}
              </text>
            </g>
          );
        })}

        {/* Center Node (Selected Person) */}
        <g className="cursor-default">
          <circle
            cx={cx}
            cy={cy}
            r={24}
            fill="#09090b"
            stroke="#10b981"
            strokeWidth="2.5"
            className="shadow-md"
          />
          <text
            x={cx}
            y={cy + 34}
            textAnchor="middle"
            fontSize="10"
            fontFamily="monospace"
            fontWeight="bold"
            fill="#ffffff"
            className="select-none"
          >
            {centerPersonName.length > 14 ? `${centerPersonName.slice(0, 12)}…` : centerPersonName}
          </text>
        </g>

        {/* Connected Person Nodes */}
        {connections.map((conn, idx) => {
          const angle = (idx / connections.length) * 2 * Math.PI - Math.PI / 2;
          const x = cx + radius * Math.cos(angle);
          const y = cy + radius * Math.sin(angle);
          const name = conn.name || conn.person_id.replace('PERSON:', '');

          return (
            <g
              key={conn.person_id}
              className="cursor-pointer transition-transform hover:scale-110"
              onClick={() => onSelectPerson?.(conn.person_id)}
            >
              <circle
                cx={x}
                cy={y}
                r={17}
                fill="#18181c"
                stroke="#3f3f46"
                strokeWidth="2"
              />
              <text
                x={x}
                y={y > cy ? y + 22 : y - 22}
                textAnchor="middle"
                fontSize="9"
                fontFamily="monospace"
                fill="#e4e4e7"
                fontWeight="500"
                className="select-none"
              >
                {name.length > 13 ? `${name.slice(0, 11)}…` : name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
