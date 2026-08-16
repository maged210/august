"use client";

// VIX IN CONTEXT (COMMAND CENTER R2) — level, day change, fixed-threshold
// regime bucket, trend vs SPY/QQQ, and ONE context sentence generated from
// the actual numbers (lib/levels.vixContext) — never hardcoded prose.

import { useEffect, useState } from "react";
import DataTag from "@/components/DataTag";
import { vixBucket } from "@/lib/regime";
import { vixContext } from "@/lib/levels";

type Quote = { price: number; chgPct: number; closes: number[] };

export default function VixContextModule() {
  const [q, setQ] = useState<Record<string, Quote> | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      fetch("/api/intel/quotes?symbols=%5EVIX,SPY,QQQ", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { quotes?: Record<string, Quote> }) => {
          if (!cancelled && j.quotes) { setQ(j.quotes); setErr(false); }
        })
        .catch(() => { if (!cancelled) setErr(true); });
    };
    pull();
    const id = window.setInterval(() => { if (!document.hidden) pull(); }, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const vix = q?.["^VIX"];
  const line = vix
    ? vixContext(
        Number.isFinite(vix.chgPct) ? vix.chgPct : null,
        Number.isFinite(q?.SPY?.chgPct ?? NaN) ? q!.SPY.chgPct : null,
        Number.isFinite(q?.QQQ?.chgPct ?? NaN) ? q!.QQQ.chgPct : null,
      )
    : null;

  return (
    <section className="ifm" aria-label="VIX in context">
      <div className="ifm-h">
        <span className="ifm-title">VIX IN CONTEXT</span>
        {vix ? (
          <DataTag kind="delayed" detail="60s" title="^VIX vs SPY/QQQ · Yahoo quotes · 60s poll" />
        ) : err ? (
          <DataTag kind="unavail" title="quotes unreachable" />
        ) : (
          <span className="hb-pending">loading…</span>
        )}
      </div>
      {vix ? (
        <div className="ifm-body vixc">
          <div className="vixc-head">
            <b className="vixc-lvl">{vix.price.toFixed(1)}</b>
            <span className={`vixc-chg ${vix.chgPct >= 0 ? "if-neg" : "if-pos"}`}>
              {vix.chgPct >= 0 ? "+" : ""}{vix.chgPct.toFixed(1)}%
            </span>
            <span className={`vixc-bucket vb-${vixBucket(vix.price).toLowerCase()}`} title="fixed thresholds: <15 LOW · <20 NORMAL · <28 ELEVATED · ≥28 HIGH">
              {vixBucket(vix.price)}
            </span>
          </div>
          {line ? <p className="vixc-line">{line}</p> : null}
        </div>
      ) : err ? (
        <div className="ifm-body nql-empty">VIX · DATA UNAVAILABLE — quotes unreachable</div>
      ) : null}
    </section>
  );
}
