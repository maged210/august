"use client";

// The trade-ideas admin console (CORE V2 P3; P4 adds the transcript intake).
// One client component against /api/admin/ideas:
//   • credential: the owner session cookie just works; otherwise the console
//     asks once for ADMIN_TOKEN and keeps it in sessionStorage (tab-scoped,
//     gone on close — deliberately NOT localStorage)
//   • board: DRAFT QUEUE → LIVE → CLOSED, newest first, with per-card
//     approve / reject / close / relist / edit
//   • nothing goes public without approve (draft→live) — the API enforces it,
//     this UI just makes the queue visible
// House rules: real states only (WidgetState), no mock rows, mono labels.

import { useCallback, useEffect, useState } from "react";
import WidgetState from "@/components/WidgetState";
import {
  IDEA_RISKS,
  IDEA_SIDES,
  relativeTime,
  type Idea,
  type IdeaRiskLevel,
  type IdeaSide,
} from "@/lib/ideas";
import {
  TAPE_KINDS,
  TAPE_SENTIMENTS,
  type TapeEntry,
  type TapeKind,
  type TapeSentiment,
} from "@/lib/tape";
// type-only: lib/transcripts is server code (Anthropic/Redis) — the type erases
import type { TranscriptRecord } from "@/lib/transcripts";

const TOKEN_KEY = "aug-admin-token";

type GateState = "checking" | "locked" | "open" | "unconfigured";

function readToken(): string {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function authHeaders(): Record<string, string> {
  const t = readToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

type Draft = {
  instrument: string;
  thesis: string;
  entry: string;
  target: string;
  riskLevel: IdeaRiskLevel;
};

const EMPTY_DRAFT: Draft = { instrument: "", thesis: "", entry: "", target: "", riskLevel: "medium" };

type TapeDraft = {
  symbol: string;
  note: string;
  expiry: string;
  premium: string;
  kind: TapeKind;
  sentiment: TapeSentiment;
};

// kind/sentiment deliberately survive a save — consecutive callouts usually
// share them; only the text fields clear (the keyboard-fast contract)
const EMPTY_TAPE: TapeDraft = {
  symbol: "",
  note: "",
  expiry: "",
  premium: "",
  kind: "note",
  sentiment: "neutral",
};

export default function AdminConsole() {
  const [gate, setGate] = useState<GateState>("checking");
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [gateError, setGateError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null); // idea id or "create"
  const [actionError, setActionError] = useState("");
  const [form, setForm] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Draft>(EMPTY_DRAFT);
  // transcript intake (P4)
  const [trText, setTrText] = useState("");
  const [trSource, setTrSource] = useState("");
  const [trBusy, setTrBusy] = useState(false);
  const [trResult, setTrResult] = useState("");
  const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([]);
  // desk tape (G3 round 4)
  const [tape, setTape] = useState<TapeEntry[]>([]);
  const [tapeForm, setTapeForm] = useState<TapeDraft>(EMPTY_TAPE);
  const [tapeBusy, setTapeBusy] = useState<string | null>(null); // entry id or "create"

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ideas", {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (res.status === 401 || res.status === 403) {
        setGate("locked");
        setIdeas(null);
        return;
      }
      if (res.status === 501) {
        setGate("unconfigured");
        setIdeas(null);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { ideas?: Idea[] };
      setIdeas(Array.isArray(j.ideas) ? j.ideas : []);
      setGate("open");
      setGateError("");
    } catch {
      // network/server trouble with a credential that may be fine — show the
      // board's error state rather than bouncing to the lock screen
      setGate((g) => (g === "checking" ? "locked" : g));
      setIdeas((prev) => (prev === null ? [] : prev));
      setActionError("Couldn't reach the admin API just now.");
    }
  }, []);

  const loadTranscripts = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/transcripts", {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!res.ok) return; // gate/storage states already surfaced by the board
      const j = (await res.json()) as { transcripts?: TranscriptRecord[] };
      setTranscripts(Array.isArray(j.transcripts) ? j.transcripts : []);
    } catch {
      /* intake log is a nicety — the board's states carry the errors */
    }
  }, []);

  const loadTape = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/tape", { cache: "no-store", headers: authHeaders() });
      if (!res.ok) return; // gate/storage states already surfaced by the board
      const j = (await res.json()) as { entries?: TapeEntry[] };
      setTape(Array.isArray(j.entries) ? j.entries : []);
    } catch {
      /* the board's states carry the errors */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (gate === "open") {
      void loadTranscripts();
      void loadTape();
    }
  }, [gate, loadTranscripts, loadTape]);

  // Quick-add (keyboard-fast): Enter anywhere in the row submits; saves
  // straight to LIVE (the owner typing IS the approval), source "desk".
  const tapeQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tapeBusy || !tapeForm.symbol.trim() || !tapeForm.note.trim()) return;
    setTapeBusy("create");
    setActionError("");
    try {
      const res = await fetch("/api/admin/tape", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ ...tapeForm, status: "live", source: "desk" }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? String(res.status));
      }
      // keep kind/sentiment for the next callout; clear only the text fields
      setTapeForm((f) => ({ ...f, symbol: "", note: "", expiry: "", premium: "" }));
      await loadTape();
    } catch (err) {
      setActionError(`Tape add failed: ${(err as Error).message}`);
    } finally {
      setTapeBusy(null);
    }
  };

  const tapeMutate = async (id: string, patch: Record<string, unknown>) => {
    setTapeBusy(id);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/tape/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? String(res.status));
      }
      await loadTape();
    } catch (e) {
      setActionError(`Tape change failed: ${(e as Error).message}`);
    } finally {
      setTapeBusy(null);
    }
  };

  const tapeDelete = async (id: string) => {
    setTapeBusy(id);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/tape/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? String(res.status));
      }
      await loadTape();
    } catch (e) {
      setActionError(`Tape delete failed: ${(e as Error).message}`);
    } finally {
      setTapeBusy(null);
    }
  };

  const processTranscript = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = trText.trim();
    if (!text || trBusy) return;
    setTrBusy(true);
    setTrResult("");
    setActionError("");
    try {
      const res = await fetch("/api/admin/transcripts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ text, source: trSource.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        drafts?: number;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        throw new Error(
          j.error === "ai_not_configured"
            ? "ANTHROPIC_API_KEY missing — extraction can't run"
            : (j.error ?? String(res.status)),
        );
      }
      setTrText("");
      setTrSource("");
      setTrResult(
        j.drafts === 0
          ? "Processed — no trade ideas or tape callouts found in that transcript."
          : `Processed — ${j.drafts} draft${j.drafts === 1 ? "" : "s"} created (ideas + tape), review below.`,
      );
      await Promise.all([load(), loadTranscripts(), loadTape()]);
    } catch (err) {
      setActionError(`Transcript failed: ${(err as Error).message}`);
      await loadTranscripts(); // the failed record still shows in the log
    } finally {
      setTrBusy(false);
    }
  };

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = tokenDraft.trim();
    if (!t) return;
    try {
      window.sessionStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* private mode — the token just won't survive a reload */
    }
    setTokenDraft("");
    setGate("checking");
    const res = await fetch("/api/admin/ideas", { cache: "no-store", headers: authHeaders() });
    if (res.ok) {
      const j = (await res.json()) as { ideas?: Idea[] };
      setIdeas(Array.isArray(j.ideas) ? j.ideas : []);
      setGate("open");
      setGateError("");
    } else if (res.status === 501) {
      setGate("unconfigured");
    } else {
      try {
        window.sessionStorage.removeItem(TOKEN_KEY);
      } catch {
        /* no-op */
      }
      setGate("locked");
      setGateError("That token was refused.");
    }
  };

  const mutate = async (id: string, patch: Record<string, unknown>) => {
    setBusyId(id);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/ideas/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? String(res.status));
      }
      await load();
    } catch (e) {
      setActionError(`Change failed: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId("create");
    setActionError("");
    try {
      const res = await fetch("/api/admin/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? String(res.status));
      }
      setForm(EMPTY_DRAFT);
      await load();
    } catch (e) {
      setActionError(`Create failed: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const beginEdit = (idea: Idea) => {
    setEditingId(idea.id);
    setEditForm({
      instrument: idea.instrument,
      thesis: idea.thesis,
      entry: idea.entry,
      target: idea.target,
      riskLevel: idea.riskLevel,
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    await mutate(editingId, editForm);
    setEditingId(null);
  };

  // ---- render ----------------------------------------------------------------

  if (gate === "checking") {
    return (
      <main className="admin-page">
        <div className="adm-shell">
          <AdminHead count={null} />
          <WidgetState state="loading" rows={5} />
        </div>
      </main>
    );
  }

  if (gate === "locked") {
    return (
      <main className="admin-page">
        <div className="adm-shell adm-lock">
          <AdminHead count={null} />
          <form className="adm-lockform" onSubmit={unlock}>
            <label className="adm-label" htmlFor="adm-token">
              ADMIN TOKEN
            </label>
            <input
              id="adm-token"
              className="adm-input"
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="paste ADMIN_TOKEN"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="adm-btn adm-btn-acc" disabled={!tokenDraft.trim()}>
              UNLOCK
            </button>
            {gateError ? <p className="adm-err">{gateError}</p> : null}
            <p className="adm-hint">
              Signed-in owner sessions pass without a token. The token lives in
              this tab only.
            </p>
          </form>
        </div>
      </main>
    );
  }

  if (gate === "unconfigured") {
    return (
      <main className="admin-page">
        <div className="adm-shell">
          <AdminHead count={null} />
          <p className="adm-err">
            Upstash is not configured — UPSTASH_REDIS_REST_URL/TOKEN needed before ideas can be
            stored.
          </p>
        </div>
      </main>
    );
  }

  const rows = ideas ?? [];
  const drafts = rows.filter((i) => i.status === "draft");
  const live = rows.filter((i) => i.status === "live");
  const closed = rows.filter((i) => i.status === "closed");
  const tapeDrafts = tape.filter((t) => t.status === "draft");
  const tapeLive = tape.filter((t) => t.status === "live");

  const tapeRow = (t: TapeEntry) => (
    <li key={t.id} className={`adm-taperow adm-tape-${t.sentiment}`}>
      <span className="adm-tape-sym">{t.symbol}</span>
      <span className="adm-tape-note">{t.note}</span>
      {t.expiry ? <span className="adm-tape-x">{t.expiry}</span> : null}
      {t.premium ? <span className="adm-tape-x">{t.premium}</span> : null}
      <span className={`adm-tape-kind adm-tk-${t.kind}`}>{t.kind.toUpperCase()}</span>
      <span className="adm-src">{t.source.toUpperCase()}</span>
      <span className="adm-when">{relativeTime(t.ts)}</span>
      <span className="adm-tape-acts">
        {t.status === "draft" ? (
          <>
            <button
              type="button"
              className="adm-btn adm-btn-acc"
              disabled={tapeBusy === t.id}
              onClick={() => tapeMutate(t.id, { status: "live" })}
            >
              APPROVE
            </button>
            <button
              type="button"
              className="adm-btn adm-btn-warn"
              disabled={tapeBusy === t.id}
              onClick={() => tapeDelete(t.id)}
            >
              REJECT
            </button>
          </>
        ) : (
          <button
            type="button"
            className="adm-btn adm-btn-warn"
            disabled={tapeBusy === t.id}
            onClick={() => tapeDelete(t.id)}
          >
            REMOVE
          </button>
        )}
      </span>
    </li>
  );

  const card = (idea: Idea) => (
    <article key={idea.id} className="adm-card">
      {editingId === idea.id ? (
        <form className="adm-form" onSubmit={saveEdit}>
          <div className="adm-form-row">
            <input
              className="adm-input"
              value={editForm.instrument}
              onChange={(e) => setEditForm({ ...editForm, instrument: e.target.value })}
              aria-label="Instrument"
              placeholder="instrument"
            />
            <RiskSelect
              value={editForm.riskLevel}
              onChange={(riskLevel) => setEditForm({ ...editForm, riskLevel })}
            />
          </div>
          <textarea
            className="adm-input adm-textarea"
            value={editForm.thesis}
            onChange={(e) => setEditForm({ ...editForm, thesis: e.target.value })}
            aria-label="Thesis"
            rows={3}
          />
          <div className="adm-form-row">
            <input
              className="adm-input"
              value={editForm.entry}
              onChange={(e) => setEditForm({ ...editForm, entry: e.target.value })}
              aria-label="Entry"
              placeholder="entry"
            />
            <input
              className="adm-input"
              value={editForm.target}
              onChange={(e) => setEditForm({ ...editForm, target: e.target.value })}
              aria-label="Target"
              placeholder="target"
            />
          </div>
          {/* UX4 — the side setter works in the edit (detail) view too;
              it PATCHes immediately, independent of the form's SAVE */}
          <SideSetter
            value={idea.side}
            busy={busyId === idea.id}
            onSet={(s) => mutate(idea.id, { side: idea.side === s ? null : s })}
          />
          <div className="adm-actions">
            <button type="submit" className="adm-btn adm-btn-acc" disabled={busyId === idea.id}>
              SAVE
            </button>
            <button type="button" className="adm-btn" onClick={() => setEditingId(null)}>
              CANCEL
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="adm-card-top">
            <span className="adm-sym">{idea.instrument}</span>
            <span className={`adm-risk adm-risk-${idea.riskLevel}`}>
              {idea.riskLevel.toUpperCase()}
            </span>
            <span className="adm-src">{idea.source.toUpperCase()}</span>
            <span className="adm-when">{relativeTime(idea.createdAt)}</span>
          </div>
          {/* UX4 — one-click side setter; clicking the active side clears it */}
          <SideSetter
            value={idea.side}
            busy={busyId === idea.id}
            onSet={(s) => mutate(idea.id, { side: idea.side === s ? null : s })}
          />
          <p className="adm-thesis">{idea.thesis}</p>
          {idea.entry || idea.target ? (
            <p className="adm-levels">
              {idea.entry ? (
                <>
                  <span className="adm-k">ENTRY</span> {idea.entry}
                </>
              ) : null}
              {idea.target ? (
                <>
                  {" "}
                  <span className="adm-k">TARGET</span> {idea.target}
                </>
              ) : null}
            </p>
          ) : null}
          <div className="adm-actions">
            {idea.status === "draft" ? (
              <>
                <button
                  type="button"
                  className="adm-btn adm-btn-acc"
                  disabled={busyId === idea.id}
                  onClick={() => mutate(idea.id, { status: "live" })}
                >
                  APPROVE
                </button>
                <button
                  type="button"
                  className="adm-btn adm-btn-warn"
                  disabled={busyId === idea.id}
                  onClick={() => mutate(idea.id, { status: "closed" })}
                >
                  REJECT
                </button>
              </>
            ) : idea.status === "live" ? (
              <button
                type="button"
                className="adm-btn adm-btn-warn"
                disabled={busyId === idea.id}
                onClick={() => mutate(idea.id, { status: "closed" })}
              >
                CLOSE
              </button>
            ) : (
              <button
                type="button"
                className="adm-btn"
                disabled={busyId === idea.id}
                onClick={() => mutate(idea.id, { status: "live" })}
              >
                RELIST
              </button>
            )}
            <button type="button" className="adm-btn" onClick={() => beginEdit(idea)}>
              EDIT
            </button>
          </div>
        </>
      )}
    </article>
  );

  return (
    <main className="admin-page">
      <div className="adm-shell">
        <AdminHead count={rows.length} />
        {actionError ? (
          <p className="adm-err" role="alert">
            {actionError}
          </p>
        ) : null}

        <section className="adm-section">
          <h2 className="adm-label">TRANSCRIPT INTAKE</h2>
          <form className="adm-form" onSubmit={processTranscript}>
            <input
              className="adm-input"
              value={trSource}
              onChange={(e) => setTrSource(e.target.value)}
              aria-label="Transcript source"
              placeholder="source label (optional) — video title or URL"
              spellCheck={false}
            />
            <textarea
              className="adm-input adm-textarea adm-transcript"
              value={trText}
              onChange={(e) => setTrText(e.target.value)}
              aria-label="Transcript text"
              placeholder="paste the NoteGPT transcript — ideas are extracted automatically into the draft queue"
              rows={7}
            />
            <div className="adm-actions">
              <button
                type="submit"
                className="adm-btn adm-btn-acc"
                disabled={trBusy || !trText.trim()}
              >
                {trBusy ? "EXTRACTING…" : "PROCESS"}
              </button>
              {trResult ? <span className="adm-ok">{trResult}</span> : null}
            </div>
          </form>
          {transcripts.length > 0 ? (
            <ul className="adm-trlog">
              {transcripts.map((t) => (
                <li key={t.id} className="adm-trrow">
                  <span className={`adm-trstatus${t.status === "failed" ? " bad" : ""}`}>
                    {t.status === "failed" ? "FAILED" : "OK"}
                  </span>
                  <span className="adm-trmeta">
                    {t.source || t.id} · {(t.chars / 1000).toFixed(1)}k chars ·{" "}
                    {relativeTime(t.receivedAt)}
                    {t.status === "processed"
                      ? ` · ${t.ideaIds.length} idea${t.ideaIds.length === 1 ? "" : "s"}${
                          t.tapeIds?.length ? ` · ${t.tapeIds.length} tape` : ""
                        }`
                      : ""}
                    {t.status === "failed" && t.error && t.error !== "pending"
                      ? ` · ${t.error}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="adm-section">
          <h2 className="adm-label">NEW IDEA</h2>
          <form className="adm-form" onSubmit={create}>
            <div className="adm-form-row">
              <input
                className="adm-input"
                value={form.instrument}
                onChange={(e) => setForm({ ...form, instrument: e.target.value })}
                aria-label="Instrument"
                placeholder="instrument — NQ, NVDA, BTC…"
              />
              <RiskSelect
                value={form.riskLevel}
                onChange={(riskLevel) => setForm({ ...form, riskLevel })}
              />
            </div>
            <textarea
              className="adm-input adm-textarea"
              value={form.thesis}
              onChange={(e) => setForm({ ...form, thesis: e.target.value })}
              aria-label="Thesis"
              placeholder="the why — one tight paragraph"
              rows={3}
            />
            <div className="adm-form-row">
              <input
                className="adm-input"
                value={form.entry}
                onChange={(e) => setForm({ ...form, entry: e.target.value })}
                aria-label="Entry"
                placeholder="entry (optional)"
              />
              <input
                className="adm-input"
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value })}
                aria-label="Target"
                placeholder="target (optional)"
              />
            </div>
            <div className="adm-actions">
              <button
                type="submit"
                className="adm-btn adm-btn-acc"
                disabled={busyId === "create" || !form.instrument.trim() || !form.thesis.trim()}
              >
                {busyId === "create" ? "SAVING…" : "SAVE DRAFT"}
              </button>
            </div>
          </form>
        </section>

        <section className="adm-section">
          <h2 className="adm-label">DESK TAPE — QUICK ADD</h2>
          <form className="adm-form" onSubmit={tapeQuickAdd}>
            <div className="adm-form-row adm-tape-add">
              <input
                className="adm-input adm-tape-in-sym"
                value={tapeForm.symbol}
                onChange={(e) => setTapeForm({ ...tapeForm, symbol: e.target.value })}
                aria-label="Tape symbol"
                placeholder="SPX"
                spellCheck={false}
                autoComplete="off"
              />
              <input
                className="adm-input"
                value={tapeForm.note}
                onChange={(e) => setTapeForm({ ...tapeForm, note: e.target.value })}
                aria-label="Tape note"
                placeholder="Buy 7600 SPX Put"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div className="adm-form-row adm-tape-add">
              <input
                className="adm-input adm-tape-in-x"
                value={tapeForm.expiry}
                onChange={(e) => setTapeForm({ ...tapeForm, expiry: e.target.value })}
                aria-label="Expiry"
                placeholder="expiry?"
                spellCheck={false}
                autoComplete="off"
              />
              <input
                className="adm-input adm-tape-in-x"
                value={tapeForm.premium}
                onChange={(e) => setTapeForm({ ...tapeForm, premium: e.target.value })}
                aria-label="Premium"
                placeholder="premium?"
                spellCheck={false}
                autoComplete="off"
              />
              <select
                className="adm-input adm-select"
                value={tapeForm.kind}
                onChange={(e) => setTapeForm({ ...tapeForm, kind: e.target.value as TapeKind })}
                aria-label="Kind"
              >
                {TAPE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.toUpperCase()}
                  </option>
                ))}
              </select>
              <select
                className="adm-input adm-select"
                value={tapeForm.sentiment}
                onChange={(e) =>
                  setTapeForm({ ...tapeForm, sentiment: e.target.value as TapeSentiment })
                }
                aria-label="Sentiment"
              >
                {TAPE_SENTIMENTS.map((s) => (
                  <option key={s} value={s}>
                    {s.toUpperCase()}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="adm-btn adm-btn-acc"
                disabled={
                  tapeBusy === "create" || !tapeForm.symbol.trim() || !tapeForm.note.trim()
                }
              >
                {tapeBusy === "create" ? "SAVING…" : "ADD LIVE"}
              </button>
            </div>
            <p className="adm-hint">Enter saves straight to the public tape (you typing it is the approval).</p>
          </form>
        </section>

        <section className="adm-section">
          <h2 className="adm-label">
            TAPE DRAFTS{" "}
            {tapeDrafts.length ? <span className="adm-count">{tapeDrafts.length}</span> : null}
          </h2>
          {tapeDrafts.length ? (
            <ul className="adm-tapelist">{tapeDrafts.map(tapeRow)}</ul>
          ) : (
            <p className="adm-empty">no extracted tape waiting</p>
          )}
        </section>

        <section className="adm-section">
          <h2 className="adm-label">
            TAPE LIVE {tapeLive.length ? <span className="adm-count">{tapeLive.length}</span> : null}
          </h2>
          {tapeLive.length ? (
            <ul className="adm-tapelist">{tapeLive.map(tapeRow)}</ul>
          ) : (
            <p className="adm-empty">nothing on the public tape</p>
          )}
        </section>

        <section className="adm-section">
          <h2 className="adm-label">
            DRAFT QUEUE {drafts.length ? <span className="adm-count">{drafts.length}</span> : null}
          </h2>
          {drafts.length ? drafts.map(card) : <p className="adm-empty">no drafts waiting</p>}
        </section>

        <section className="adm-section">
          <h2 className="adm-label">
            LIVE {live.length ? <span className="adm-count">{live.length}</span> : null}
          </h2>
          {live.length ? live.map(card) : <p className="adm-empty">nothing public right now</p>}
        </section>

        <section className="adm-section">
          <h2 className="adm-label">
            CLOSED {closed.length ? <span className="adm-count">{closed.length}</span> : null}
          </h2>
          {closed.length ? closed.map(card) : <p className="adm-empty">no closed ideas</p>}
        </section>
      </div>
    </main>
  );
}

function AdminHead({ count }: { count: number | null }) {
  return (
    <header className="adm-head">
      <span className="adm-brand">
        <span className="adm-brand-dot" aria-hidden />
        AUGUST · ADMIN
      </span>
      <span className="adm-head-right">
        {count !== null ? <span className="adm-count">{count} IDEAS</span> : null}
        <a className="adm-back" href="/">
          ← AUGUST
        </a>
      </span>
    </header>
  );
}

function RiskSelect({
  value,
  onChange,
}: {
  value: IdeaRiskLevel;
  onChange: (v: IdeaRiskLevel) => void;
}) {
  return (
    <select
      className="adm-input adm-select"
      value={value}
      onChange={(e) => onChange(e.target.value as IdeaRiskLevel)}
      aria-label="Risk level"
    >
      {IDEA_RISKS.map((r) => (
        <option key={r} value={r}>
          {r.toUpperCase()} RISK
        </option>
      ))}
    </select>
  );
}

// UX4 — the one-click side setter: three chips, the active one highlighted;
// clicking the active side clears it (the caller sends side: null).
const SIDE_GLYPH: Record<IdeaSide, string> = { long: "▲", short: "▼", watch: "◆" };

function SideSetter({
  value,
  busy,
  onSet,
}: {
  value: Idea["side"];
  busy: boolean;
  onSet: (s: IdeaSide) => void;
}) {
  return (
    <div className="adm-sides" role="group" aria-label="Side">
      <span className="adm-k adm-sides-k">SIDE</span>
      {IDEA_SIDES.map((s) => (
        <button
          key={s}
          type="button"
          className={`adm-side adm-side-${s}${value === s ? " on" : ""}`}
          disabled={busy}
          aria-pressed={value === s}
          title={value === s ? "click again to clear the side" : `mark ${s}`}
          onClick={() => onSet(s)}
        >
          <span aria-hidden="true">{SIDE_GLYPH[s]}</span> {s.toUpperCase()}
        </button>
      ))}
      {!value ? <span className="adm-sides-abs">∅ not set</span> : null}
    </div>
  );
}
