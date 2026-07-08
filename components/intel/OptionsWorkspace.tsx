"use client";

// OPTIONS INTEL — the chart-centered options workspace. Everything here is additive to
// the existing Market Intel dashboard and shares ONE selected symbol (symbolContext).
//
// Product structure mirrors the spec, with each class clearly labeled and kept apart:
//   A) Creator Options Plays            — origin "creator_explicit"
//   B) AUGUST Options Candidates        — origin "august_candidate" (NOT a recommendation)
//   C) Directional Setups w/o a Contract— origin "directional_only"
//   + BEST OPTIONS IDEAS                — top-ranked across A/B/C (fit + data quality)
//
// Honesty: delayed data, NO Greeks; creator-quoted premium is shown separately from any
// current (delayed) quote; nothing here trades or connects to a broker.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DailyBrief, IntelLevel, OptionBriefIdea, OptionIdea, OptionsProviderStatus, RankFactor } from "@/lib/intel/types";
import { useSymbol } from "./symbolContext";
import TradingViewIntelChart from "./TradingViewIntelChart";

type Opts = NonNullable<DailyBrief["options"]>;
type RankedOption = OptionIdea & { rankScore?: number; rankFactors?: RankFactor[] };

const PROVIDER_LABEL: Record<OptionsProviderStatus, string> = {
  connected: "Connected (live)",
  delayed: "Connected · delayed (no Greeks)",
  missing_configuration: "No provider configured",
  unauthorized: "Provider unauthorized",
  rate_limited: "Provider rate-limited",
  unsupported_symbol: "Symbol unsupported",
  provider_error: "Provider error",
  stale: "Data stale",
};

const legText = (l: OptionIdea["legs"][number]) =>
  `${l.action} ${l.quantity} ${l.strike ?? "?"}${l.optionType === "call" ? "C" : "P"}${l.expiration ? ` ${l.expiration}` : ""}`;

export default function OptionsWorkspace({ brief, levels }: { brief: DailyBrief | null; levels: IntelLevel[] }) {
  const { symbol, setSymbol } = useSymbol();
  const options = brief?.options;

  // symbols referenced by any option idea — quick chips to drive the shared symbol
  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const grp of [options?.bestCreatorPlays, options?.augustCandidates, options?.directionalOnly]) {
      for (const i of grp ?? []) set.add(i.underlyingSymbol);
    }
    return [...set];
  }, [options]);

  const best = useMemo(() => bestIdeas(options), [options]);
  const [selected, setSelected] = useState<RankedOption | null>(null);

  return (
    <section className="optx">
      <div className="optx-head">
        <div className="optx-title">OPTIONS INTEL</div>
        <div className="optx-prov">
          {options ? PROVIDER_LABEL[options.providerStatus] : "Options provider: delayed (Yahoo) · no Greeks"}
        </div>
      </div>

      {/* symbol switcher (drives the chart + chain + candidates together) */}
      <SymbolBar symbols={symbols} />

      {/* chart + synchronized creator-levels rail (iframe can't be drawn on — honest) */}
      <div className="optx-chartrow">
        <TradingViewIntelChart height={460} />
        <CreatorLevelsRail levels={levels.filter((l) => l.instrument.toUpperCase() === symbol)} symbol={symbol} onPick={setSymbol} />
      </div>

      {/* AUGUST candidate generator for the current symbol (provider-gated, on demand) */}
      <CandidateGenerator onSelect={setSelected} />

      {!options ? (
        <div className="istate">No option ideas extracted yet. Process a transcript that discusses options, then generate the brief — creator plays, directional setups, and (when the provider has data) AUGUST candidates appear here.</div>
      ) : (
        <>
          {/* BEST OPTIONS IDEAS */}
          <div className="icard optx-best">
            <div className="icard-h">Best Options Ideas <span className="optx-note">ranked by fit + data quality — not expected profit</span></div>
            {best.length === 0 ? <div className="istate">No ranked option ideas yet.</div> : best.map((i) => (
              <OptionIdeaCard key={i.id} idea={i} onChart={setSymbol} onSelect={setSelected} />
            ))}
          </div>

          <OptionGroup title="Creator Options Plays" note="Exactly what the creator stated — never embellished." items={options.bestCreatorPlays} empty="No creator named a specific options contract." onChart={setSymbol} onSelect={setSelected} />
          <OptionGroup title="AUGUST Options Candidates" note="AUGUST-GENERATED — not a creator recommendation, not advice." items={options.augustCandidates} empty="No candidates (connect/await an options-chain provider, or no thesis qualified)." onChart={setSymbol} onSelect={setSelected} candidate />
          <OptionGroup title="Directional Setups Without a Contract" note="Directional thesis — exact options contract not specified." items={options.directionalOnly} empty="None." onChart={setSymbol} onSelect={setSelected} />

          {options.consensus.length > 1 && (
            <div className="icard">
              <div className="icard-h">Options Consensus &amp; Conflicts <span className="optx-note">do channels agree on the underlying?</span></div>
              {options.consensus.slice(0, 16).map((c) => {
                // Redacted briefs keep the source COUNT but not channel names —
                // never print "undefined"; fall back to an honest count.
                const names = c.sources.map((s) => s.channelTitle).filter(Boolean);
                return (
                  <div key={c.ticker} className="consensus-row">
                    <span className="intel-mono" style={{ color: "var(--bone)" }}>{c.ticker}</span>
                    <span style={{ fontSize: 11, color: "var(--ash)" }}>
                      {names.length ? names.join(" · ") : `${c.sources.length} source${c.sources.length === 1 ? "" : "s"}`}
                    </span>
                    <span className={`badge ${c.agreement === "conflict" ? "b-conflict" : c.agreement === "agree" ? "b-triggered" : "b-neutral"}`}>{c.agreement}</span>
                  </div>
                );
              })}
            </div>
          )}

          {options.optionsRisk.length > 0 && (
            <div className="icard">
              <div className="icard-h">Options Risk Notes</div>
              <ul className="optx-risks">{options.optionsRisk.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
        </>
      )}

      {selected && <ContractPanel idea={selected} onClose={() => setSelected(null)} onChart={setSymbol} />}
    </section>
  );
}

// --- best ideas across all three classes ----------------------------------
function bestIdeas(o?: Opts): OptionBriefIdea[] {
  if (!o) return [];
  const all = [...o.bestCreatorPlays, ...o.augustCandidates, ...o.directionalOnly];
  return all.filter((i) => i.status !== "invalidated").sort((a, b) => b.rankScore - a.rankScore).slice(0, 6);
}

// --- symbol switcher -------------------------------------------------------
function SymbolBar({ symbols }: { symbols: string[] }) {
  const { symbol, setSymbol } = useSymbol();
  const [draft, setDraft] = useState("");
  return (
    <div className="optx-symbar">
      <input
        className="iinput optx-syminput"
        placeholder="Symbol (e.g. SPY, NVDA)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { setSymbol(draft); setDraft(""); } }}
      />
      <button className="ibtn ibtn-sm" type="button" onClick={() => { if (draft.trim()) { setSymbol(draft); setDraft(""); } }}>Load</button>
      <div className="optx-chips">
        {symbols.map((s) => (
          <button key={s} type="button" className={`optx-chip${s === symbol ? " on" : ""}`} onClick={() => setSymbol(s)}>{s}</button>
        ))}
      </div>
    </div>
  );
}

// --- creator levels rail (synchronized; NOT painted on the iframe chart) ----
function CreatorLevelsRail({ levels, symbol, onPick }: { levels: IntelLevel[]; symbol: string; onPick: (s: string) => void }) {
  return (
    <aside className="optx-rail">
      <div className="optx-rail-h">Creator Levels · {symbol}</div>
      <div className="optx-rail-note">The chart is an embedded TradingView widget (an iframe) — creator levels can&apos;t be drawn on it, so they&apos;re listed here, sorted high → low.</div>
      {levels.length === 0 ? (
        <div className="istate" style={{ fontSize: 11 }}>No creator levels for {symbol}. Pick a symbol with levels, or check the brief&apos;s Levels.</div>
      ) : (
        [...levels].sort((a, b) => (b.level ?? 0) - (a.level ?? 0)).map((l) => (
          <div key={l.id} className={`optx-lvl optx-lvl-${l.type}`}>
            <span className="optx-lvl-px">{l.level !== null ? l.level : <span className="notspec">{l.levelText || "—"}</span>}</span>
            <span className="badge b-neutral">{l.type}</span>
            {l.crossed ? <span className="badge b-triggered">crossed</span> : null}
            <button type="button" className="optx-lvl-go" onClick={() => onPick(l.instrument)}>↗</button>
          </div>
        ))
      )}
    </aside>
  );
}

// --- a labeled group of option ideas --------------------------------------
function OptionGroup({
  title, note, items, empty, onChart, onSelect, candidate,
}: {
  title: string; note: string; items: OptionBriefIdea[]; empty: string;
  onChart: (s: string) => void; onSelect: (i: RankedOption) => void; candidate?: boolean;
}) {
  return (
    <div className={`icard${candidate ? " optx-candcard" : ""}`}>
      <div className="icard-h">{title} {candidate && <span className="badge b-inferred">AUGUST-generated</span>}<span className="optx-note">{note}</span></div>
      {items.length === 0 ? <div className="istate" style={{ fontSize: 12 }}>{empty}</div> : items.map((i) => (
        <OptionIdeaCard key={i.id} idea={i} onChart={onChart} onSelect={onSelect} />
      ))}
    </div>
  );
}

// --- one option idea card --------------------------------------------------
function OptionIdeaCard({ idea, onChart, onSelect }: { idea: RankedOption; onChart: (s: string) => void; onSelect: (i: RankedOption) => void }) {
  const originBadge =
    idea.origin === "creator_explicit" ? <span className="badge b-explicit">Creator play</span>
    : idea.origin === "august_candidate" ? <span className="badge b-inferred">AUGUST candidate</span>
    : <span className="badge b-watch">Directional only</span>;
  const dirCls = idea.direction === "bullish" ? "b-bull" : idea.direction === "bearish" ? "b-bear" : idea.direction === "volatility" ? "b-pred" : "b-neutral";
  const contract = idea.legs.length ? idea.legs.map(legText).join("  /  ") : "no contract specified";
  return (
    <div className="optidea">
      <div className="optidea-top">
        <button type="button" className="idea-tkr optidea-sym" onClick={() => onChart(idea.underlyingSymbol)} title="Load on chart">{idea.underlyingSymbol}</button>
        <span className={`badge ${dirCls}`}>{idea.direction}</span>
        <span className="badge b-neutral">{idea.strategyType.replace(/_/g, " ")}</span>
        {originBadge}
        {idea.conviction !== "unspecified" && <span className="badge b-neutral">{idea.conviction}</span>}
        {typeof idea.rankScore === "number" && <span className="optidea-score">{idea.rankScore}</span>}
      </div>
      <div className="optidea-contract">{contract}</div>
      <div className="idea-grid">
        <div className="idea-f"><span>Expiration</span>{idea.expirationText?.resolved ? <b>{idea.expirationText.resolved}</b> : idea.expirationText?.text ? <span className="notspec">{idea.expirationText.text} (unresolved)</span> : <span className="notspec">Not specified</span>}</div>
        <div className="idea-f"><span>Creator premium</span>{idea.quotedPremium !== null ? <b>${idea.quotedPremium}</b> : <span className="notspec">Not specified</span>}</div>
        <div className="idea-f"><span>Now (delayed)</span>{idea.contractQuote?.mid != null ? <b>${idea.contractQuote.mid}</b> : <span className="notspec">—</span>}</div>
        <div className="idea-f"><span>Breakeven</span>{idea.breakevens.length ? <b>{idea.breakevens.join(", ")}</b> : <span className="notspec">Not computable</span>}</div>
        <div className="idea-f"><span>Max loss</span>{idea.maxLoss !== null ? <b>${idea.maxLoss}</b> : <span className="notspec">—</span>}</div>
        <div className="idea-f"><span>Max profit</span>{idea.maxProfit !== null ? <b>${idea.maxProfit}</b> : <span className="notspec">{idea.strategyType.startsWith("long_call") ? "Unlimited" : "—"}</span>}</div>
      </div>
      <div className="optidea-actions">
        <button type="button" className="ibtn ibtn-sm ibtn-ghost" onClick={() => onSelect(idea)}>Contract details</button>
        {idea.videoId && <a className="idea-cite" href={`https://www.youtube.com/watch?v=${idea.videoId}&t=${Math.floor(idea.sourceStartSeconds)}s`} target="_blank" rel="noreferrer">▸ source @ {Math.floor(idea.sourceStartSeconds / 60)}:{String(Math.floor(idea.sourceStartSeconds % 60)).padStart(2, "0")}</a>}
      </div>
    </div>
  );
}

// --- on-demand AUGUST candidate generator for the current symbol -----------
function CandidateGenerator({ onSelect }: { onSelect: (i: RankedOption) => void }) {
  const { symbol } = useSymbol();
  const [dir, setDir] = useState<"bullish" | "bearish">("bullish");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ status: string; note: string; candidates: RankedOption[] } | null>(null);

  const run = useCallback(async () => {
    setBusy(true); setRes(null);
    try {
      const r = await fetch("/api/intel/options/candidates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, direction: dir }),
      });
      setRes(await r.json());
    } catch {
      setRes({ status: "provider_error", note: "Request failed.", candidates: [] });
    } finally {
      setBusy(false);
    }
  }, [symbol, dir]);

  return (
    <div className="icard optx-gen">
      <div className="icard-h">Generate AUGUST candidates · {symbol} <span className="badge b-inferred">not advice</span></div>
      <div className="optx-genrow">
        <div className="optx-dirtoggle">
          <button type="button" className={dir === "bullish" ? "on" : ""} onClick={() => setDir("bullish")}>Bullish → calls</button>
          <button type="button" className={dir === "bearish" ? "on" : ""} onClick={() => setDir("bearish")}>Bearish → puts</button>
        </div>
        <button type="button" className="ibtn ibtn-primary ibtn-sm" disabled={busy} onClick={run}>{busy ? "Scanning chain…" : "Generate"}</button>
        <span className="optx-note">Delayed chain, no Greeks · selected by moneyness, liquidity filters &amp; your settings.</span>
      </div>
      {res && (
        <div className="optx-genres">
          {/* warning derived from the LIVE response, not a stale brief snapshot */}
          {res.status !== "delayed" && res.status !== "connected" && (
            <div className="inote iwarn">Provider: {res.status}. Candidates need a working options-chain provider.</div>
          )}
          <div className="inote">{res.note || res.status}</div>
          {res.candidates.map((c) => <OptionIdeaCard key={c.id} idea={c} onChart={() => {}} onSelect={onSelect} />)}
        </div>
      )}
    </div>
  );
}

// --- contract detail panel (drawer) ----------------------------------------
function ContractPanel({ idea, onClose, onChart }: { idea: RankedOption; onClose: () => void; onChart: (s: string) => void }) {
  const q = idea.contractQuote;
  const risk = idea.optionsRisk;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // Escape-to-close + focus management (move focus into the dialog; restore on close).
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <>
      <div className="idrawer-scrim" onClick={onClose} />
      <div className="idrawer" role="dialog" aria-modal="true" aria-label={`${idea.underlyingSymbol} option contract`}>
        <button ref={closeRef} className="idrawer-x" onClick={onClose} aria-label="Close">✕</button>
        <div className="intel-mono" style={{ fontSize: 10, color: "var(--ash)" }}>OPTION CONTRACT</div>
        <h3 style={{ margin: "4px 0 6px", fontSize: 16 }}>
          <button type="button" className="idea-tkr" onClick={() => onChart(idea.underlyingSymbol)}>{idea.underlyingSymbol}</button>{" "}
          {idea.strategyType.replace(/_/g, " ")} · {idea.direction}
        </h3>
        {idea.origin === "august_candidate" && <div className="inote iwarn">AUGUST-GENERATED CONTRACT CANDIDATE — not a creator recommendation and not financial advice.</div>}

        <div className="icard">
          <div className="icard-h">Legs</div>
          {idea.legs.length === 0 ? <div className="notspec">No contract specified.</div> : idea.legs.map((l, i) => (
            <div key={i} className="optx-leg">
              <span className="badge b-neutral">{l.action}</span> {l.quantity}× {l.optionType.toUpperCase()}
              {" · strike "}{l.strike ?? <span className="notspec">not specified</span>}
              {" · exp "}{l.expiration ?? <span className="notspec">not specified</span>}
              {l.contractSymbol && <span className="intel-mono" style={{ fontSize: 10, color: "var(--ash)" }}> · {l.contractSymbol}</span>}
            </div>
          ))}
        </div>

        <div className="icard">
          <div className="icard-h">Current contract (delayed) {q?.delayed && <span className="badge b-stale">delayed</span>}</div>
          {!q ? <div className="istate" style={{ fontSize: 12 }}>No live contract located (provider unavailable or contract not specified).</div> : (
            <div className="idea-grid">
              <div className="idea-f"><span>Bid / Ask</span><b>{q.bid ?? "—"} / {q.ask ?? "—"}</b></div>
              <div className="idea-f"><span>Mid</span><b>{q.mid ?? "—"}</b></div>
              <div className="idea-f"><span>Open interest</span><b>{q.openInterest ?? "—"}</b></div>
              <div className="idea-f"><span>Volume</span><b>{q.volume ?? "—"}</b></div>
              <div className="idea-f"><span>Impl. vol</span><b>{q.impliedVolatility != null ? `${(q.impliedVolatility * 100).toFixed(0)}%` : "—"}</b></div>
              <div className="idea-f"><span>Greeks</span><span className="notspec">Unavailable from provider</span></div>
            </div>
          )}
        </div>

        <div className="icard">
          <div className="icard-h">Math (per contract)</div>
          <div className="idea-grid">
            <div className="idea-f"><span>Creator premium</span>{idea.quotedPremium !== null ? <b>${idea.quotedPremium}</b> : <span className="notspec">Not specified</span>}</div>
            <div className="idea-f"><span>Breakeven</span>{idea.breakevens.length ? <b>{idea.breakevens.join(", ")}</b> : <span className="notspec">Not computable</span>}</div>
            <div className="idea-f"><span>Max loss</span>{idea.maxLoss !== null ? <b>${idea.maxLoss}</b> : <span className="notspec">—</span>}</div>
            <div className="idea-f"><span>Max profit</span>{idea.maxProfit !== null ? <b>${idea.maxProfit}</b> : <span className="notspec">{idea.strategyType === "long_call" ? "Unlimited" : "—"}</span>}</div>
            <div className="idea-f"><span>Risk / reward</span>{idea.riskRewardRatio !== null ? <b>{idea.riskRewardRatio}</b> : <span className="notspec">—</span>}</div>
          </div>
        </div>

        <div className="icard">
          <div className="icard-h">Options-specific risk</div>
          <ul className="optx-risks">
            {risk.liquidity && <li><b>Liquidity:</b> {risk.liquidity}</li>}
            {risk.thetaDecay && <li><b>Theta:</b> {risk.thetaDecay}</li>}
            {risk.volatility && <li><b>Volatility:</b> {risk.volatility}</li>}
            {risk.assignment && <li><b>Assignment:</b> {risk.assignment}</li>}
            {risk.staleness && <li><b>Data:</b> {risk.staleness}</li>}
            {risk.earnings && <li><b>Earnings:</b> {risk.earnings}</li>}
            {idea.risks.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>

        {idea.rankFactors && idea.rankFactors.length > 0 && (
          <div className="icard">
            <div className="icard-h">Why this ranks {typeof idea.rankScore === "number" ? `(${idea.rankScore}/100)` : ""}</div>
            <div className="optx-factors">
              {idea.rankFactors.map((f, i) => (
                <div key={i} className="optx-factor"><span>{f.factor}</span><b>{f.weight >= 0 ? `+${f.weight}` : f.weight}</b><em>{f.note}</em></div>
              ))}
            </div>
            <div className="inote">A score reflects fit + data quality — never a probability of profit.</div>
          </div>
        )}
      </div>
    </>
  );
}
