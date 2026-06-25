"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  BriefIdea,
  Chapter,
  ConsensusItem,
  DailyBrief,
  IntelCatalyst,
  IntelLevel,
  IntelSource,
  IntelVideo,
  OptionIdea,
  TradeIdea,
  VideoAnalysis,
} from "@/lib/intel/types";
import { SymbolProvider } from "./symbolContext";
import OptionsWorkspace from "./OptionsWorkspace";

// Market Intel dashboard. One overview fetch + targeted actions. Honest states
// throughout — nothing fabricated; "Not specified" where the creator didn't say.

type Overview = {
  config: { storage: boolean; ai: boolean; youtube: boolean };
  clock: { date: string; nice: string; time: string; session: string; sessionLabel: string };
  lastSync: number;
  lastBriefAt: number;
  lastProcessed: number;
  sources: IntelSource[];
  videos: IntelVideo[];
  brief: DailyBrief | null;
};

const watchUrl = (v: string, t?: number) => `https://www.youtube.com/watch?v=${v}${t ? `&t=${Math.floor(t)}s` : ""}`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const ago = (ms: number) => (ms ? `${Math.max(1, Math.round((Date.now() - ms) / 60000))}m ago` : "never");

export default function IntelDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [openVideo, setOpenVideo] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false); // Options Intel is a secondary, opt-in panel

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/intel/overview", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setData(await r.json());
      setStatus("ready");
    } catch {
      setStatus((s) => (s === "ready" ? "ready" : "error"));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addSource = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setBusy("add");
    setMsg(null);
    try {
      const r = await fetch("/api/intel/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const j = await r.json();
      if (!j.ok) setMsg(`Couldn't add: ${j.error ?? "error"}`);
      else setMsg(`Added: ${j.source?.title ?? url}`);
      await load();
    } finally {
      setBusy(null);
    }
  }, [load]);

  const removeSource = useCallback(async (id: string) => {
    await fetch(`/api/intel/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }, [load]);

  const sync = useCallback(async () => {
    setBusy("sync");
    setMsg(null);
    try {
      const r = await fetch("/api/intel/sync", { method: "POST" });
      const j = await r.json();
      setMsg(j.ok ? `Sync: ${j.discovered} new video(s).` : j.message ?? "Sync needs YOUTUBE_API_KEY.");
      await load();
    } finally {
      setBusy(null);
    }
  }, [load]);

  const generateBrief = useCallback(async () => {
    setBusy("brief");
    setMsg(null);
    try {
      const r = await fetch("/api/intel/briefs/today", { method: "POST" });
      const j = await r.json();
      if (!j.ok) setMsg(`Brief: ${j.error ?? "failed"}`);
      await load();
    } finally {
      setBusy(null);
    }
  }, [load]);

  if (status === "loading") {
    return (
      <div className="intel-wrap">
        <div className="iskel" style={{ width: "40%" }} />
        <div className="iskel" /><div className="iskel" /><div className="iskel" style={{ width: "70%" }} />
      </div>
    );
  }
  if (!data) {
    return <div className="intel-wrap"><div className="istate istate-err">Couldn&apos;t load Market Intel. <button className="ibtn ibtn-sm" onClick={load}>Retry</button></div></div>;
  }

  const { config, clock, sources, videos, brief } = data;
  // Initial shared symbol: first option underlying, else first top idea ticker, else SPY.
  const initialSymbol =
    brief?.options?.bestCreatorPlays[0]?.underlyingSymbol ||
    brief?.options?.directionalOnly[0]?.underlyingSymbol ||
    brief?.topIdeas[0]?.ticker ||
    "SPY";

  return (
    <SymbolProvider initial={initialSymbol}>
    <div className="intel-wrap">
      {/* A — COMMAND HEADER */}
      <header className="intel-head">
        <div>
          <div className="intel-title">MARKET INTEL</div>
          <div className="intel-sub">
            <span>{clock.nice} · <b>{clock.time} ET</b></span>
            <span>· <b>{clock.sessionLabel}</b></span>
            <span>· sync <b>{ago(data.lastSync)}</b></span>
            <span>· brief <b>{data.lastBriefAt ? ago(data.lastBriefAt) : "none"}</b></span>
          </div>
        </div>
        <div className="intel-actions">
          <button className="ibtn" disabled={busy === "sync"} onClick={sync}>{busy === "sync" ? "Syncing…" : "Sync Sources"}</button>
          <button className="ibtn ibtn-primary" disabled={busy === "brief" || !config.ai} onClick={generateBrief}>{busy === "brief" ? "Generating…" : "Generate Brief"}</button>
          <a className="ibtn ibtn-ghost" href="/api/intel/export/today">Export</a>
          <a className="intel-home" href="/">← AUGUST</a>
        </div>
      </header>

      {!config.storage && <div className="istate iwarn">Upstash isn&apos;t configured — Market Intel needs UPSTASH_REDIS_REST_URL/TOKEN to store sources and analysis.</div>}
      {!config.ai && <div className="istate iwarn">ANTHROPIC_API_KEY not set — extraction and briefs are disabled.</div>}
      {!config.youtube && <div className="inote" style={{ marginTop: 8 }}>YOUTUBE_API_KEY not set: add videos by URL and paste transcripts to process them now. Channel auto-discovery and live status need the key.</div>}
      {msg && <div className="istate" style={{ color: "var(--steel)" }}>{msg}</div>}

      <div className="intel-grid">
        <div>
          {/* B — TONIGHT'S BRIEF */}
          <BriefCard brief={brief} ai={config.ai} onOpenVideo={setOpenVideo} />
        </div>
        <div>
          {/* G — SOURCE MONITOR */}
          <AddSource onAdd={addSource} busy={busy === "add"} />
          <SourceMonitor sources={sources} onRemove={removeSource} />
          {/* H — VIDEO LIBRARY */}
          <VideoLibrary videos={videos} onOpen={setOpenVideo} />
          {/* J — ASK AUGUST */}
          <AskAugust ai={config.ai} />
        </div>
      </div>

      {/* OPTIONS INTEL — SECONDARY, opt-in. The YouTube-ingestion core above is the
          feature; this options/chart workspace sits below it and is collapsed by default
          (it also defers loading the TradingView widget + chain fetches until opened). */}
      <section className="optx-section">
        <button type="button" className="optx-toggle" aria-expanded={optionsOpen} onClick={() => setOptionsOpen((o) => !o)}>
          <span className="optx-toggle-caret">{optionsOpen ? "▾" : "▸"}</span>
          <span className="optx-toggle-title">OPTIONS INTEL</span>
          <span className="optx-toggle-note">chart · creator option plays · AUGUST candidates — secondary</span>
        </button>
        {optionsOpen && <OptionsWorkspace brief={brief} levels={brief?.levels ?? []} />}
      </section>

      <div className="idisc">AUGUST Market Intel is decision-support / research over creator commentary. It never trades and never invents prices, levels, or tickers. Not financial advice.</div>

      {openVideo && <VideoDrawer videoId={openVideo} onClose={() => setOpenVideo(null)} onProcessed={load} aiOn={config.ai} />}
    </div>
    </SymbolProvider>
  );
}

// --- badges ---------------------------------------------------------------
function DirBadge({ d }: { d: TradeIdea["direction"] }) {
  const cls = d === "bullish" ? "b-bull" : d === "bearish" ? "b-bear" : d === "watch" ? "b-watch" : "b-neutral";
  return <span className={`badge ${cls}`}>{d}</span>;
}
function ExpBadge({ e }: { e: "explicit" | "inferred" }) {
  return <span className={`badge ${e === "explicit" ? "b-explicit" : "b-inferred"}`}>{e === "explicit" ? "Source claim" : "AUGUST inference"}</span>;
}
function val(v: { value: number | null; text: string }) {
  if (v.value === null && (!v.text || /not specified/i.test(v.text))) return <span className="notspec">Not specified</span>;
  return <b>{v.text || (v.value !== null ? String(v.value) : "—")}</b>;
}

// --- B: brief -------------------------------------------------------------
function BriefCard({ brief, ai, onOpenVideo }: { brief: DailyBrief | null; ai: boolean; onOpenVideo: (id: string) => void }) {
  const [read60, setRead60] = useState(false);
  if (!brief) {
    return (
      <div className="icard">
        <div className="icard-h">Tonight&apos;s Brief</div>
        <div className="istate">No brief generated yet. Add a source, process a transcript, then press <b>Generate Brief</b>{!ai ? " (needs ANTHROPIC_API_KEY)" : ""}.</div>
      </div>
    );
  }
  return (
    <>
      <div className="icard">
        <div className="icard-h">
          Tonight&apos;s Brief · {brief.date}
          <button className="ibtn ibtn-sm ibtn-ghost" onClick={() => setRead60((r) => !r)}>{read60 ? "Full" : "Read in 60s"}</button>
        </div>
        {brief.read60 && <p className="brief-read60">{brief.read60}</p>}
        {!brief.grounded && <div className="inote iwarn">AI narrative offline — structured intel only.</div>}
        {!read60 && (
          <dl style={{ margin: 0 }}>
            {brief.posture && <div className="brief-row"><dt>Posture</dt><dd>{brief.posture}</dd></div>}
            {brief.whatChanged && <div className="brief-row"><dt>What changed</dt><dd>{brief.whatChanged}</dd></div>}
            {brief.whatMattersTomorrow && <div className="brief-row"><dt>Tomorrow</dt><dd>{brief.whatMattersTomorrow}</dd></div>}
            {brief.watchAtOpen && <div className="brief-row"><dt>At the open</dt><dd>{brief.watchAtOpen}</dd></div>}
            {brief.invalidation && <div className="brief-row"><dt>Invalidation</dt><dd>{brief.invalidation}</dd></div>}
          </dl>
        )}
        {!read60 && (brief.bullCase || brief.bearCase) && (
          <div className="bullbear">
            <div className="bull"><h4>BULL CASE</h4><div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{brief.bullCase || "—"}</div></div>
            <div className="bear"><h4>BEAR CASE</h4><div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{brief.bearCase || "—"}</div></div>
          </div>
        )}
      </div>

      {/* D-ish: Creator Favorites */}
      {brief.creatorFavorites.length > 0 && (
        <div className="icard">
          <div className="icard-h">Creator Favorites</div>
          {brief.creatorFavorites.map((i) => <IdeaCard key={i.id} idea={i} favorite onOpenVideo={onOpenVideo} />)}
        </div>
      )}

      {/* C: Top Trade Ideas */}
      <div className="icard">
        <div className="icard-h">Top Trade Ideas</div>
        {brief.topIdeas.length === 0 ? <div className="istate">No ideas extracted yet.</div> : brief.topIdeas.map((i) => <IdeaCard key={i.id} idea={i} onOpenVideo={onOpenVideo} />)}
      </div>

      {/* E: Levels */}
      {brief.levels.length > 0 && (
        <div className="icard">
          <div className="icard-h">Levels &amp; Triggers</div>
          {brief.levels.slice(0, 24).map((l) => <LevelRow key={l.id} l={l} />)}
        </div>
      )}

      {/* F: Catalysts */}
      {brief.catalysts.length > 0 && (
        <div className="icard">
          <div className="icard-h">Catalyst Map</div>
          {brief.catalysts.slice(0, 20).map((c, i) => <CatalystRow key={i} c={c} />)}
        </div>
      )}

      {/* Consensus & Conflicts */}
      {brief.consensus.length > 0 && (
        <div className="icard">
          <div className="icard-h">Consensus &amp; Conflicts</div>
          {brief.consensus.slice(0, 20).map((c) => <ConsensusRow key={c.ticker} c={c} />)}
        </div>
      )}
    </>
  );
}

function IdeaCard({ idea, favorite, onOpenVideo }: { idea: BriefIdea | TradeIdea; favorite?: boolean; onOpenVideo?: (id: string) => void }) {
  const b = idea as BriefIdea;
  return (
    <div className="idea">
      <div className="idea-top">
        <span className="idea-tkr">{idea.ticker}</span>
        {idea.assetName && <span className="idea-name">{idea.assetName}</span>}
        <DirBadge d={idea.direction} />
        <span className="badge b-neutral">{idea.timeHorizon.replace("_", " ")}</span>
        <ExpBadge e={idea.explicitness} />
        {favorite && <span className="badge b-fav">Creator favorite</span>}
        {idea.creatorDesignation.isPrediction && <span className="badge b-pred">Prediction</span>}
        {idea.enriched?.triggered && <span className="badge b-triggered">Triggered</span>}
        {idea.enriched?.invalidated && <span className="badge b-invalid">Invalidated</span>}
      </div>
      <div className="idea-thesis">{idea.thesis}</div>
      <div className="idea-grid">
        <div className="idea-f"><span>Entry</span>{val(idea.entry)}</div>
        <div className="idea-f"><span>Invalidation</span>{val(idea.invalidation)}</div>
        <div className="idea-f"><span>Target</span>{idea.targets[0] ? val(idea.targets[0]) : <span className="notspec">Not specified</span>}</div>
        <div className="idea-f"><span>Catalyst</span><b>{idea.catalysts[0] ?? "—"}</b></div>
        {idea.enriched?.price != null && <div className="idea-f"><span>Live price</span><b>${idea.enriched.price.toFixed(2)}</b></div>}
        <div className="idea-f"><span>Confidence</span><b>{(idea.confidence * 100).toFixed(0)}%</b></div>
      </div>
      {idea.videoId && (
        <a className="idea-cite" href={watchUrl(idea.videoId, idea.sourceStartSeconds)} target="_blank" rel="noreferrer">
          ▸ {b.channelTitle ?? "source"} @ {mmss(idea.sourceStartSeconds)}{b.rankScore !== undefined ? ` · rank ${b.rankScore}` : ""}
        </a>
      )}
    </div>
  );
}

function LevelRow({ l }: { l: IntelLevel }) {
  return (
    <div className="lvl-row">
      <span className="intel-mono" style={{ color: "var(--bone)" }}>{l.instrument}</span>
      <span className="badge b-neutral">{l.type}</span>
      <span style={{ color: "var(--ash)", fontSize: 11 }}>{l.level !== null ? l.level : <span className="notspec">{l.levelText || "Not specified"}</span>} {l.crossed ? <span className="badge b-triggered">crossed</span> : null}</span>
      {l.videoId ? <a className="idea-cite" href={watchUrl(l.videoId, l.sourceStartSeconds)} target="_blank" rel="noreferrer">@{mmss(l.sourceStartSeconds)}</a> : <span className="idea-cite">@{mmss(l.sourceStartSeconds)}</span>}
    </div>
  );
}
function CatalystRow({ c }: { c: IntelCatalyst }) {
  return (
    <div className="cat-row">
      <b style={{ color: "var(--bone)" }}>{c.name}</b>{" "}
      <span className={`badge ${c.importance === "high" ? "b-bear" : c.importance === "medium" ? "b-watch" : "b-neutral"}`}>{c.importance}</span>{" "}
      <span className={`badge ${c.externallyVerified ? "b-verified" : "b-inferred"}`}>{c.externallyVerified ? "Verified" : "Creator claim"}</span>
      {c.eventTime && <span className="intel-mono" style={{ color: "var(--ash)", fontSize: 10, marginLeft: 6 }}>{c.eventTime}</span>}
      {c.affectedTickers.length > 0 && <span style={{ color: "var(--steel)", fontSize: 11 }}> · {c.affectedTickers.join(" ")}</span>}
    </div>
  );
}
function DrawerOptionRow({ o }: { o: OptionIdea }) {
  const origin = o.origin === "creator_explicit" ? <span className="badge b-explicit">Creator play</span> : o.origin === "august_candidate" ? <span className="badge b-inferred">AUGUST candidate</span> : <span className="badge b-watch">Directional only</span>;
  const contract = o.legs.length ? o.legs.map((l) => `${l.action} ${l.strike ?? "?"}${l.optionType === "call" ? "C" : "P"}${l.expiration ? ` ${l.expiration}` : ""}`).join(" / ") : "no contract specified";
  return (
    <div className="optidea">
      <div className="optidea-top">
        <span className="idea-tkr">{o.underlyingSymbol}</span>
        <span className={`badge ${o.direction === "bullish" ? "b-bull" : o.direction === "bearish" ? "b-bear" : "b-neutral"}`}>{o.direction}</span>
        <span className="badge b-neutral">{o.strategyType.replace(/_/g, " ")}</span>
        {origin}
      </div>
      <div className="optidea-contract">{contract}</div>
      <div className="idea-grid">
        <div className="idea-f"><span>Expiration</span>{o.expirationText?.resolved ? <b>{o.expirationText.resolved}</b> : o.expirationText?.text ? <span className="notspec">{o.expirationText.text}</span> : <span className="notspec">Not specified</span>}</div>
        <div className="idea-f"><span>Creator premium</span>{o.quotedPremium !== null ? <b>${o.quotedPremium}</b> : <span className="notspec">Not specified</span>}</div>
        <div className="idea-f"><span>Breakeven</span>{o.breakevens.length ? <b>{o.breakevens.join(", ")}</b> : <span className="notspec">Not computable</span>}</div>
      </div>
      {o.videoId && <a className="idea-cite" href={watchUrl(o.videoId, o.sourceStartSeconds)} target="_blank" rel="noreferrer">▸ source @ {mmss(o.sourceStartSeconds)}</a>}
    </div>
  );
}
function ConsensusRow({ c }: { c: ConsensusItem }) {
  const cls = c.agreement === "conflict" ? "b-conflict" : c.agreement === "agree" ? "b-triggered" : "b-neutral";
  return (
    <div className="consensus-row">
      <span className="intel-mono" style={{ color: "var(--bone)" }}>{c.ticker}</span>
      <span style={{ fontSize: 11, color: "var(--ash)" }}>{c.sources.map((s) => s.channelTitle).join(" · ")}</span>
      <span className={`badge ${cls}`}>{c.agreement}</span>
    </div>
  );
}

// --- G: source monitor + add ----------------------------------------------
function AddSource({ onAdd, busy }: { onAdd: (url: string) => void; busy: boolean }) {
  const [url, setUrl] = useState("");
  return (
    <div className="icard">
      <div className="icard-h">Add a source</div>
      <div className="iinrow">
        <input className="iinput" placeholder="Channel URL, @handle, channel id, or video URL" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAdd(url); setUrl(""); } }} />
        <button className="ibtn ibtn-primary" disabled={busy || !url.trim()} onClick={() => { onAdd(url); setUrl(""); }}>{busy ? "…" : "Add"}</button>
      </div>
      <div className="inote">Seeds: paste a Stock Market Live or StockedUp video URL to start, or a channel to monitor.</div>
    </div>
  );
}
function SourceMonitor({ sources, onRemove }: { sources: IntelSource[]; onRemove: (id: string) => void }) {
  return (
    <div className="icard">
      <div className="icard-h">Source Monitor · {sources.length}</div>
      {sources.length === 0 ? <div className="istate">No sources yet.</div> : sources.map((s) => (
        <div key={s.id} className="irow">
          {s.thumbnail ? <img className="irow-thumb" src={s.thumbnail} alt="" /> : <span className="irow-thumb" />}
          <div className="irow-main">
            <div className="irow-title">{s.title}</div>
            <div className="irow-meta">
              <span>{s.type}</span>
              <span className={`badge ${s.status === "active" ? "b-verified" : "b-stale"}`}>{s.status}</span>
              <span>checked {ago(s.lastChecked)}</span>
              {s.error && <span className="iwarn">{s.error}</span>}
            </div>
          </div>
          <div className="irow-actions">
            <a className="ibtn ibtn-sm ibtn-ghost" href={s.url} target="_blank" rel="noreferrer">View</a>
            <button className="ibtn ibtn-sm ibtn-ghost" onClick={() => onRemove(s.id)}>Remove</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- H: video library -----------------------------------------------------
function statusBadge(v: IntelVideo) {
  if (v.liveState === "live") return <span className="badge b-live">Live</span>;
  if (v.status === "analyzing") return <span className="badge b-proc">Processing</span>;
  if (v.status === "preliminary") return <span className="badge b-proc">Preliminary</span>;
  if (v.status === "analyzed") return <span className="badge b-verified">Analyzed</span>;
  if (v.transcriptStatus === "pending" || v.transcriptStatus === "unavailable") return <span className="badge b-pending">Transcript {v.transcriptStatus}</span>;
  return <span className="badge b-pending">{v.status}</span>;
}
function VideoLibrary({ videos, onOpen }: { videos: IntelVideo[]; onOpen: (id: string) => void }) {
  return (
    <div className="icard">
      <div className="icard-h">Video Library · {videos.length}</div>
      {videos.length === 0 ? <div className="istate">No videos yet — add a video source above.</div> : videos.slice(0, 20).map((v) => (
        <div key={v.videoId} className="irow clickable" onClick={() => onOpen(v.videoId)}>
          {v.thumbnail ? <img className="irow-thumb" src={v.thumbnail} alt="" /> : <span className="irow-thumb" />}
          <div className="irow-main">
            <div className="irow-title">{v.title}</div>
            <div className="irow-meta">
              <span>{v.channelTitle ?? ""}</span>
              {statusBadge(v)}
              {v.stale && <span className="badge b-stale">Stale</span>}
              {typeof v.ideaCount === "number" && <span>{v.ideaCount} ideas{v.optionCount ? ` · ${v.optionCount} options` : ""} · {v.levelCount ?? 0} levels</span>}
            </div>
          </div>
          <div className="irow-actions"><span className="ibtn ibtn-sm ibtn-ghost">Open</span></div>
        </div>
      ))}
    </div>
  );
}

// --- I: video drawer ------------------------------------------------------
function VideoDrawer({ videoId, onClose, onProcessed, aiOn }: { videoId: string; onClose: () => void; onProcessed: () => void; aiOn: boolean }) {
  const [bundle, setBundle] = useState<{ video: IntelVideo; analysis: VideoAnalysis | null; chapters: Chapter[] } | null>(null);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/intel/videos/${encodeURIComponent(videoId)}`, { cache: "no-store" });
    if (r.ok) setBundle(await r.json());
  }, [videoId]);
  useEffect(() => { load(); }, [load]);

  const process = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/intel/videos/${encodeURIComponent(videoId)}/transcript`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript }) });
      const j = await r.json();
      if (!j.ok) setErr(`Processing failed: ${j.error ?? "error"}`);
      else { setTranscript(""); await load(); onProcessed(); }
    } finally {
      setBusy(false);
    }
  }, [transcript, videoId, load, onProcessed]);

  const v = bundle?.video;
  const a = bundle?.analysis;
  return (
    <>
      <div className="idrawer-scrim" onClick={onClose} />
      <div className="idrawer">
        <button className="idrawer-x" onClick={onClose} aria-label="Close">✕</button>
        {!bundle ? <div className="iskel" /> : (
          <>
            <div className="intel-mono" style={{ fontSize: 10, color: "var(--ash)" }}>VIDEO</div>
            <h3 style={{ margin: "4px 0 6px", fontSize: 16 }}>{v?.title}</h3>
            <div className="irow-meta" style={{ marginBottom: 12 }}>
              <span>{v?.channelTitle}</span>{v && statusBadge(v)}{v?.stale && <span className="badge b-stale">Stale</span>}
              <a className="idea-cite" href={watchUrl(videoId)} target="_blank" rel="noreferrer">▸ open on YouTube</a>
            </div>

            {a?.warnings?.length ? <div className="inote iwarn">{a.warnings.join(" · ")}</div> : null}

            {/* transcript paste — works today */}
            {v?.status !== "analyzed" && (
              <div className="icard" style={{ marginTop: 12 }}>
                <div className="icard-h">Process transcript {a?.pass === "preliminary" ? "(preliminary done — paste full for the rest)" : ""}</div>
                <textarea className="iinput" placeholder={"Paste the YouTube transcript here (Show transcript → copy). Timestamps preserved when present."} value={transcript} onChange={(e) => setTranscript(e.target.value)} />
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="ibtn ibtn-primary" disabled={busy || !aiOn || transcript.trim().length < 40} onClick={process}>{busy ? "Analyzing…" : "Analyze transcript"}</button>
                  {!aiOn && <span className="inote iwarn">Needs ANTHROPIC_API_KEY.</span>}
                  {err && <span className="inote istate-err">{err}</span>}
                </div>
              </div>
            )}

            {/* chapter timeline */}
            {bundle.chapters.length > 0 && (
              <div className="icard">
                <div className="icard-h">Chapters</div>
                {bundle.chapters.map((ch, i) => (
                  <a key={i} className="chap" href={watchUrl(videoId, ch.startSeconds)} target="_blank" rel="noreferrer">
                    <span className="chap-t">{mmss(ch.startSeconds)}</span>
                    <span className={ch.priority === "high" ? "chap-hi" : ""}>{ch.title} {ch.creatorDefined ? "" : "· AUGUST-detected"}</span>
                  </a>
                ))}
              </div>
            )}

            {a && (
              <>
                {a.overallSummary && <div className="icard"><div className="icard-h">Summary {a.pass === "preliminary" && <span className="badge b-proc">Preliminary</span>}</div><p style={{ fontSize: 13, lineHeight: 1.55 }}>{a.overallSummary}</p></div>}
                {a.tradeIdeas.length > 0 && <div className="icard"><div className="icard-h">Trade Ideas · {a.tradeIdeas.length}</div>{a.tradeIdeas.map((i) => <IdeaCard key={i.id} idea={i} favorite={i.creatorDesignation.isFavoriteSetup} />)}</div>}
                {a.optionIdeas?.length > 0 && <div className="icard"><div className="icard-h">Option Ideas · {a.optionIdeas.length}</div>{a.optionIdeas.map((o) => <DrawerOptionRow key={o.id} o={o} />)}</div>}
                {a.levels.length > 0 && <div className="icard"><div className="icard-h">Levels · {a.levels.length}</div>{a.levels.map((l) => <LevelRow key={l.id} l={l} />)}</div>}
                {a.catalysts.length > 0 && <div className="icard"><div className="icard-h">Catalysts</div>{a.catalysts.map((c, i) => <CatalystRow key={i} c={c} />)}</div>}
                <button className="ibtn ibtn-sm ibtn-ghost" onClick={async () => { setBusy(true); await fetch(`/api/intel/videos/${encodeURIComponent(videoId)}/reprocess`, { method: "POST" }); await load(); onProcessed(); setBusy(false); }}>Reprocess</button>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

// --- J: ask AUGUST --------------------------------------------------------
function AskAugust({ ai }: { ai: boolean }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ answer: string; citations: { videoId: string; videoTitle: string; channelTitle: string; startSeconds: number; note: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    if (q.trim().length < 3) return;
    setBusy(true);
    try {
      const r = await fetch("/api/intel/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
      setRes(await r.json());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="icard">
      <div className="icard-h">Ask AUGUST</div>
      <div className="iinrow">
        <input className="iinput" placeholder="What did both channels say about QQQ?" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(); }} />
        <button className="ibtn ibtn-primary" disabled={busy || !ai} onClick={ask}>{busy ? "…" : "Ask"}</button>
      </div>
      {!ai && <div className="inote iwarn">Needs ANTHROPIC_API_KEY.</div>}
      {res && (
        <div>
          <div className="ask-ans">{res.answer}</div>
          {res.citations.map((c, i) => (
            <a key={i} className="idea-cite" style={{ display: "block" }} href={watchUrl(c.videoId, c.startSeconds)} target="_blank" rel="noreferrer">▸ {c.channelTitle || c.videoTitle} @ {mmss(c.startSeconds)} — {c.note}</a>
          ))}
        </div>
      )}
    </div>
  );
}
