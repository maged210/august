// A semicircular dial gauge — pure SVG, no chart library. Colored zones, a needle,
// a value readout. Shows a graceful "unavailable" state when value is null.
type Zone = { upTo: number; color: string };

type GaugeProps = {
  label: string;
  value: number | null;
  min: number;
  max: number;
  display?: (v: number) => string;
  zones?: Zone[];
  note?: string;
  unavailable?: string; // shown instead of a value when null (e.g. "needs FRED key")
};

export default function Gauge({
  label,
  value,
  min,
  max,
  display,
  zones,
  note,
  unavailable,
}: GaugeProps) {
  const cx = 50;
  const cy = 50;
  const r = 40;
  const span = max - min || 1;
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const frac = value == null ? 0 : (clamp(value) - min) / span;

  const point = (f: number): [number, number] => {
    const theta = Math.PI * (1 - Math.max(0, Math.min(1, f)));
    return [cx + r * Math.cos(theta), cy - r * Math.sin(theta)];
  };

  const N = 44;
  const arc = (f0: number, f1: number): string => {
    const pts: string[] = [];
    const steps = Math.max(2, Math.round((f1 - f0) * N));
    for (let s = 0; s <= steps; s++) {
      const [x, y] = point(f0 + (f1 - f0) * (s / steps));
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return pts.join(" ");
  };

  const zoneEls = (zones || []).map((z, i) => {
    const prev = i === 0 ? min : zones![i - 1].upTo;
    return (
      <polyline
        key={i}
        points={arc((prev - min) / span, (z.upTo - min) / span)}
        fill="none"
        stroke={z.color}
        strokeWidth={3}
        strokeLinecap="round"
        opacity={0.6}
      />
    );
  });

  const [nx, ny] = point(frac);

  return (
    <div className="gauge">
      <svg viewBox="0 0 100 56" className="gauge-svg" aria-hidden>
        <polyline
          points={arc(0, 1)}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={3}
          strokeLinecap="round"
        />
        {zoneEls}
        {value != null ? (
          <>
            <line
              x1={cx}
              y1={cy}
              x2={nx.toFixed(2)}
              y2={ny.toFixed(2)}
              stroke="#e8e6e1"
              strokeWidth={1.6}
              strokeLinecap="round"
            />
            <circle cx={nx.toFixed(2)} cy={ny.toFixed(2)} r={2.4} fill="#e8e6e1" />
          </>
        ) : null}
        <circle cx={cx} cy={cy} r={2.4} fill="#6a6a70" />
      </svg>
      <div className="gauge-val">
        {value == null ? "—" : display ? display(value) : String(value)}
      </div>
      <div className="gauge-label">{label}</div>
      {value == null && unavailable ? (
        <div className="gauge-note steel">{unavailable}</div>
      ) : note ? (
        <div className="gauge-note">{note}</div>
      ) : null}
    </div>
  );
}
