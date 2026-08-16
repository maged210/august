"use client";

// WHAT'S MOVING (R4 F3) — the sector heatmap from the already-fetched SPDR
// ETF data. Color = day %, integrity-labeled. Tap a sector → its ETF context
// (quote · % · 1mo spark) from the existing quotes route. No fan-out beyond
// the one tapped symbol — the hardening round exists for a reason.

import { useEffect, useState } from "react";
import DataTag from "@/components/DataTag";

type Sector = { code: string; name?: string; sym?: string; chgPct: number };
type Quote = { price: number; chgPct: number; closes: number[] };

const heat = (p: number) => {
  const a = Math.min(1, Math.abs(p) / 2.5);
  return p >= 0 ? `rgb(64 200 110 / ${0.12 + a * 0.55})` : `rgb(220 92 74 / ${0.12 + a * 0.55})`;
};

export default function SectorHeatmap({ onAsk }: { onAsk?: (text: string) => void }) {
  const [sectors, setSectors] = useState<Sector[] | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ sym: string; q: Quote } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      fetch("/api/intel/desk", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { sectors?: Sector[] }) => {
          if (!cancelled && Array.isArray(j.sectors) && j.sectors.length) { setSectors(j.sectors); setErr(false); }
          else if (!cancelled) setErr(true);
        })
        .catch(() => { if (!cancelled) setErr(true); });
    };
    pull();
    const id = window.setInterval(() => { if (!document.hidden) pull(); }, 5 * 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const tap = (s: Sector) => {
    const sym = s.sym ?? s.code;
    if (open === s.code) { setOpen(null); setCtx(null); return; }
    setOpen(s.code);
    setCtx(null);
    fetch(`/api/intel/quotes?symbols=${encodeURIComponent(sym)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: { quotes?: Record<string, Quote> }) => {
        const q = j.quotes?.[sym];
        if (q) setCtx({ sym, q });
      })
      .catch(() => {});
  };

  return (
    <div className="shm">
      <div className="hb-row">
        <span className="hb-label">WHAT&apos;S MOVING</span>
        {sectors ? (
          <DataTag kind="delayed" detail="5m" title="SPDR sector ETFs · Yahoo · 15m server cache" />
        ) : err ? (
          <DataTag kind="unavail" title="sector data unreachable" />
        ) : (
          <span className="hb-pending">loading…</span>
        )}
      </div>
      {sectors ? (
        <>
          <div className="shm-grid">
            {sectors.map((s) => (
              <button
                key={s.code}
                type="button"
                className={`shm-tile${open === s.code ? " on" : ""}`}
                style={{ background: heat(s.chgPct) }}
                onClick={() => tap(s)}
                title={`${s.name ?? s.code} · tap for context`}
              >
                <b>{s.code}</b>
                <span>{s.chgPct >= 0 ? "+" : ""}{s.chgPct.toFixed(1)}%</span>
              </button>
            ))}
          </div>
          {open && ctx ? (
            <div className="shm-ctx">
              <b>{ctx.sym}</b>
              <span>{ctx.q.price >= 1000 ? Math.round(ctx.q.price).toLocaleString("en-US") : ctx.q.price.toFixed(2)}</span>
              <span className={ctx.q.chgPct >= 0 ? "hl-up" : "hl-down"}>
                {ctx.q.chgPct >= 0 ? "+" : ""}{ctx.q.chgPct.toFixed(1)}% today
              </span>
              <SparkMini closes={ctx.q.closes} up={ctx.q.chgPct >= 0} />
              {onAsk ? (
                <button type="button" className="cdr-ask" onClick={() => onAsk(`What's driving the ${ctx.sym} sector today?`)}>
                  ASK AUGUST →
                </button>
              ) : null}
            </div>
          ) : open ? (
            <div className="shm-ctx"><span className="hb-pending">loading…</span></div>
          ) : null}
        </>
      ) : err ? (
        <p className="nql-empty">SECTORS · DATA UNAVAILABLE</p>
      ) : null}
    </div>
  );
}

function SparkMini({ closes, up }: { closes: number[]; up: boolean }) {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  const W = 64, H = 16;
  let min = Math.min(...closes), max = Math.max(...closes);
  const pad = (max - min) * 0.1 || 1; min -= pad; max += pad;
  const d = closes.map((v, i) =>
    `${i === 0 ? "M" : "L"}${((i / (closes.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / (max - min)) * (H - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <path d={d} fill="none" style={{ stroke: up ? "var(--up, #7fe0a5)" : "var(--down, #e08a7a)" }} strokeWidth={1.2} />
    </svg>
  );
}
