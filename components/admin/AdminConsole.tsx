"use client";

// THE MORNING CONTROL ROOM (ADMIN-1) — the desk's backstage, in the desk's
// own design language. Driving metric: transcript paste → reviewed →
// approved → clean public board in under two minutes, fully doable on a phone.
//
// Anatomy:
//   STATUS STRIP  live · tracked · drafts · tape · last ingest age
//   LEFT column   intake (transcript drag-drop) · ingest log · new idea ·
//                 tape quick-add (sentiment inferred from the note)
//   RIGHT column  draft review v2 (inline edits, UPDATE-to dedupe, approve/
//                 reject all) · LIVE BOOK MANAGER (inline side/entry/target/
//                 stop/risk, close/invalidate/re-arm/demote/delete, STALE
//                 surfacing) · tape drafts · live tape (undo on remove)
//
// Credentials unchanged (CORE V2): owner session cookie or ADMIN_TOKEN kept
// tab-scoped in sessionStorage. House rules: real states only, no mock rows.

import { useCallback, useEffect, useRef, useState } from "react";
import WidgetState from "@/components/WidgetState";
import {
  IDEA_RISKS,
  IDEA_SIDES,
  relativeTime,
  suggestSide,
  type Idea,
  type IdeaRiskLevel,
  type IdeaSide,
  type IdeaStatus,
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
const STALE_DAYS_KEY = "aug-admin-stale-days";
const STALE_DAYS_DEFAULT = 5;
const TAPE_UNDO_MS = 6000;

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

// AD-E — sentiment inferred from the note text, as an EDITABLE default.
function suggestTapeSentiment(note: string): TapeSentiment | null {
  const bull = /\b(buy|bought|calls?|long|bid)\b/i.test(note);
  const bear = /\b(sell|sold|puts?|short)\b/i.test(note);
  if (bull === bear) return null;
  return bull ? "bull" : "bear";
}

const STATUS_LABEL: Record<IdeaStatus, string> = {
  draft: "DRAFT",
  live: "LIVE",
  closed: "CLOSED",
  invalidated: "INVALID",
};

export default function AdminConsole() {
  const [gate, setGate] = useState<GateState>("checking");
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [gateError, setGateError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null); // idea id or "create"
  const [actionError, setActionError] = useState("");
  const [form, setForm] = useState<Draft>(EMPTY_DRAFT);
  // transcript intake (P4 + AD-D)
  const [trText, setTrText] = useState("");
  const [trSource, setTrSource] = useState("");
  const [trBusy, setTrBusy] = useState(false);
  const [trResult, setTrResult] = useState("");
  const [transcripts, setTranscripts] = useState<TranscriptRecord[]>([]);
  const [openIngest, setOpenIngest] = useState<string | null>(null);
  // desk tape (G3 r4 + AD-E)
  const [tape, setTape] = useState<TapeEntry[]>([]);
  const [tapeForm, setTapeForm] = useState<TapeDraft>(EMPTY_TAPE);
  const [tapeBusy, setTapeBusy] = useState<string | null>(null); // entry id or "create"
  const sentimentTouched = useRef(false);
  // AD-E — undo window on live-tape removal (a public-facing deletion)
  const [pendingRemove, setPendingRemove] = useState<Record<string, number>>({});
  const removeTimers = useRef<Map<string, number>>(new Map());
  // AD-A — status strip extras
  const [trackedCount, setTrackedCount] = useState<number | null>(null);
  // AD-B — STALE threshold (days), persisted locally
  const [staleDays, setStaleDays] = useState(STALE_DAYS_DEFAULT);

  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(STALE_DAYS_KEY));
      if (Number.isFinite(v) && v >= 1 && v <= 60) setStaleDays(Math.floor(v));
    } catch {
      /* private mode */
    }
  }, []);
  const applyStaleDays = (v: number) => {
    const n = Math.min(60, Math.max(1, Math.floor(v) || STALE_DAYS_DEFAULT));
    setStaleDays(n);
    try {
      window.localStorage.setItem(STALE_DAYS_KEY, String(n));
    } catch {
      /* private mode */
    }
  };

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
      // status strip: the tracked pipeline's count (public feed, cheap)
      fetch("/api/intel/feed", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((j: { ok?: boolean; ideas?: unknown[] }) => {
          if (j.ok && Array.isArray(j.ideas)) setTrackedCount(j.ideas.length);
        })
        .catch(() => {});
    }
  }, [gate, loadTranscripts, loadTape]);

  // clear any pending-remove timers on unmount
  useEffect(() => {
    const timers = removeTimers.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
    };
  }, []);

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
      sentimentTouched.current = false;
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

  // AD-E — REMOVE on live tape gets an undo window: the delete fires only
  // after the grace period; UNDO cancels it. Draft rejects delete immediately
  // (they were never public).
  const tapeRemoveWithUndo = (t: TapeEntry) => {
    if (t.status !== "live") {
      void tapeDelete(t.id);
      return;
    }
    const timer = window.setTimeout(() => {
      removeTimers.current.delete(t.id);
      setPendingRemove((m) => {
        const { [t.id]: _gone, ...rest } = m;
        return rest;
      });
      void tapeDelete(t.id);
    }, TAPE_UNDO_MS);
    removeTimers.current.set(t.id, timer);
    setPendingRemove((m) => ({ ...m, [t.id]: Date.now() + TAPE_UNDO_MS }));
  };
  const tapeUndoRemove = (id: string) => {
    const timer = removeTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    removeTimers.current.delete(id);
    setPendingRemove((m) => {
      const { [id]: _gone, ...rest } = m;
      return rest;
    });
  };

  const processTranscript = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = trText.trim();
    if (!text || trBusy) return;
    setTrBusy(true);
    setTrResult("");
    setActionError("");
    // AD-D — auto-title: the source label, or the transcript's first line
    const source =
      trSource.trim() || text.split("\n").find((l) => l.trim())?.trim().slice(0, 80) || "";
    try {
      const res = await fetch("/api/admin/transcripts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ text, source }),
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
          : `Processed — ${j.drafts} draft${j.drafts === 1 ? "" : "s"} created, review on the right.`,
      );
      await Promise.all([load(), loadTranscripts(), loadTape()]);
    } catch (err) {
      setActionError(`Transcript failed: ${(err as Error).message}`);
    } finally {
      setTrBusy(false);
    }
  };

  // AD-D — drag-drop a .txt transcript straight onto the intake box
  const onDropTranscript = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!/\.txt$|^text\//i.test(file.name) && !file.type.startsWith("text/")) {
      setActionError("Drop a plain-text (.txt) transcript.");
      return;
    }
    try {
      const text = await file.text();
      setTrText(text.slice(0, 120_000));
      if (!trSource.trim()) setTrSource(file.name.replace(/\.txt$/i, "").slice(0, 80));
    } catch {
      setActionError("Couldn't read that file.");
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

  // AD-B — hard delete, confirmed in the UI
  const removeIdea = async (idea: Idea) => {
    if (!window.confirm(`Delete ${idea.instrument} (${STATUS_LABEL[idea.status]}) permanently?`)) {
      return;
    }
    setBusyId(idea.id);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/ideas/${encodeURIComponent(idea.id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? String(res.status));
      }
      await load();
    } catch (e) {
      setActionError(`Delete failed: ${(e as Error).message}`);
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

  // F6 — DEMOTE TO TAPE (kept from the ux-2 fix round)
  const demoteToTape = async (idea: Idea) => {
    setBusyId(idea.id);
    setActionError("");
    try {
      const res = await fetch("/api/admin/tape", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          symbol: idea.instrument,
          note: idea.thesis.slice(0, 200),
          kind: "note",
          sentiment: idea.side === "long" ? "bull" : idea.side === "short" ? "bear" : "neutral",
          status: idea.status === "live" ? "live" : "draft",
          source: "desk",
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? String(res.status));
      }
      const patch = await fetch(`/api/admin/ideas/${encodeURIComponent(idea.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status: "closed" }),
      });
      if (!patch.ok) {
        const j = (await patch.json().catch(() => ({}))) as { error?: string };
        throw new Error(`note created but the idea stayed on the book: ${j.error ?? patch.status}`);
      }
      await Promise.all([load(), loadTape()]);
    } catch (e) {
      setActionError(`Demote failed: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  // AD-C — approve a draft: any inline edits + the (possibly suggested) side
  // ride the SAME PATCH that flips it live. A ticker matching a LIVE idea
  // REFRESHES that idea instead (levels updated, thesis archived into its
  // history, age reset) and the draft is consumed (closed) — no duplicates.
  const approveDraft = async (draft: Idea, edits: DraftEdits) => {
    const live = (ideas ?? []).find(
      (i) => i.status === "live" && i.instrument.trim().toUpperCase() === draft.instrument.trim().toUpperCase(),
    );
    const side = edits.side ?? draft.side ?? suggestSide(edits.entry ?? draft.entry) ?? null;
    const fields = {
      thesis: (edits.thesis ?? draft.thesis).trim(),
      entry: (edits.entry ?? draft.entry).trim(),
      target: (edits.target ?? draft.target).trim(),
      stop: (edits.stop ?? draft.stop ?? "").trim(),
      riskLevel: edits.riskLevel ?? draft.riskLevel,
      ...(side ? { side } : {}),
    };
    setBusyId(draft.id);
    setActionError("");
    try {
      if (live) {
        // UPDATE to <ticker> — refresh the existing public idea
        const res = await fetch(`/api/admin/ideas/${encodeURIComponent(live.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ ...fields, archiveThesis: true, status: "live" }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? String(res.status));
        }
        const consume = await fetch(`/api/admin/ideas/${encodeURIComponent(draft.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ status: "closed" }),
        });
        if (!consume.ok) throw new Error("updated, but the draft didn't close");
      } else {
        const res = await fetch(`/api/admin/ideas/${encodeURIComponent(draft.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ ...fields, status: "live" }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? String(res.status));
        }
      }
      await load();
    } catch (e) {
      setActionError(`Approve failed: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  // AD-C — batch actions run the UNEDITED per-card logic sequentially (cards
  // with pending inline edits should be approved individually).
  const [batchBusy, setBatchBusy] = useState<null | "approve" | "reject">(null);
  const approveAll = async (drafts: Idea[]) => {
    setBatchBusy("approve");
    for (const d of drafts) {
      // eslint-disable-next-line no-await-in-loop
      await approveDraft(d, {});
    }
    setBatchBusy(null);
  };
  const rejectAll = async (drafts: Idea[]) => {
    setBatchBusy("reject");
    for (const d of drafts) {
      // eslint-disable-next-line no-await-in-loop
      await mutate(d.id, { status: "closed" });
    }
    setBatchBusy(null);
  };

  // ---- render ----------------------------------------------------------------

  if (gate === "checking") {
    return (
      <main className="admin-page">
        <div className="adm-shell">
          <AdminStrip ideas={null} tape={[]} tracked={null} transcripts={[]} />
          <WidgetState state="loading" rows={5} />
        </div>
      </main>
    );
  }

  if (gate === "locked") {
    return (
      <main className="admin-page">
        <div className="adm-shell adm-lock">
          <AdminStrip ideas={null} tape={[]} tracked={null} transcripts={[]} />
          <form
            className="adm-lockform"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                window.sessionStorage.setItem(TOKEN_KEY, tokenDraft.trim());
              } catch {
                /* tab-scoped best effort */
              }
              setGate("checking");
              const res = await fetch("/api/admin/ideas", {
                cache: "no-store",
                headers: authHeaders(),
              });
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
            }}
          >
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
              Signed-in owner sessions pass without a token. The token lives in this tab only.
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
          <AdminStrip ideas={null} tape={[]} tracked={null} transcripts={[]} />
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
  const book = rows.filter((i) => i.status !== "draft");
  const liveIdeas = rows.filter((i) => i.status === "live");
  const tapeDrafts = tape.filter((t) => t.status === "draft");
  const tapeLive = tape.filter((t) => t.status === "live");
  const liveTickers = new Set(liveIdeas.map((i) => i.instrument.trim().toUpperCase()));

  // AD-B — STALE = live, past the threshold with no touch; stale floats first
  const staleMs = staleDays * 86_400_000;
  const isStale = (i: Idea) => i.status === "live" && Date.now() - i.updatedAt > staleMs;
  const bookSorted = [...book].sort((a, b) => {
    const sa = isStale(a) ? 0 : 1;
    const sb = isStale(b) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const order: Record<IdeaStatus, number> = { live: 0, invalidated: 1, closed: 2, draft: 3 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return b.updatedAt - a.updatedAt;
  });

  const tapeRow = (t: TapeEntry) => {
    const pendingUntil = pendingRemove[t.id];
    return (
      <li key={t.id} id={`adm-tape-${t.id}`} className={`adm-taperow adm-tape-${t.sentiment}`}>
        <span className="adm-tape-sym">{t.symbol}</span>
        <span className="adm-tape-note">{t.note}</span>
        {t.expiry ? <span className="adm-tape-x">{t.expiry}</span> : null}
        {t.premium ? <span className="adm-tape-x">{t.premium}</span> : null}
        <span className={`adm-tape-kind adm-tk-${t.kind}`}>{t.kind.toUpperCase()}</span>
        <span className="adm-src">{t.source.toUpperCase()}</span>
        <span className="adm-when">{relativeTime(t.ts)}</span>
        <span className="adm-tape-acts">
          {pendingUntil ? (
            <button
              type="button"
              className="adm-btn adm-btn-acc"
              onClick={() => tapeUndoRemove(t.id)}
            >
              UNDO
            </button>
          ) : t.status === "draft" ? (
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
              onClick={() => tapeRemoveWithUndo(t)}
              title="removes from the public tape after a short undo window"
            >
              REMOVE
            </button>
          )}
        </span>
      </li>
    );
  };

  return (
    <main className="admin-page">
      <div className="adm-shell">
        <AdminStrip ideas={rows} tape={tapeLive} tracked={trackedCount} transcripts={transcripts} />
        {actionError ? (
          <p className="adm-err" role="alert">
            {actionError}
          </p>
        ) : null}

        <div className="adm-cols">
          {/* ── LEFT — intake + create ─────────────────────────────────── */}
          <div className="adm-col">
            <section className="adm-panel">
              <div className="adm-panel-h">
                <span className="adm-panel-t">TRANSCRIPT INTAKE</span>
                <span className="adm-panel-sub">paste or drop a .txt</span>
              </div>
              <form className="adm-form" onSubmit={processTranscript}>
                <input
                  className="adm-input"
                  value={trSource}
                  onChange={(e) => setTrSource(e.target.value)}
                  aria-label="Transcript source"
                  placeholder="source label (optional) — auto-titled from the first line"
                  spellCheck={false}
                />
                <textarea
                  className="adm-input adm-textarea adm-transcript"
                  value={trText}
                  onChange={(e) => setTrText(e.target.value)}
                  onDrop={onDropTranscript}
                  onDragOver={(e) => e.preventDefault()}
                  aria-label="Transcript text"
                  placeholder="paste the transcript (or drag a .txt here) — ideas + tape callouts extract into the queues"
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
                  <span className="adm-charcount">
                    {trText.length > 0 ? `${(trText.length / 1000).toFixed(1)}k chars` : ""}
                  </span>
                  {trResult ? <span className="adm-ok">{trResult}</span> : null}
                </div>
              </form>
              {transcripts.length > 0 ? (
                <ul className="adm-trlog">
                  {transcripts.map((t) => {
                    const open = openIngest === t.id;
                    const linked = [
                      ...t.ideaIds.map((id) => ({ id, kind: "idea" as const })),
                      ...(t.tapeIds ?? []).map((id) => ({ id, kind: "tape" as const })),
                    ];
                    return (
                      <li key={t.id} className="adm-trrow-wrap">
                        <button
                          type="button"
                          className="adm-trrow"
                          aria-expanded={open}
                          onClick={() => setOpenIngest(open ? null : t.id)}
                        >
                          <span className={`adm-trstatus${t.status === "failed" ? " bad" : ""}`}>
                            {t.status === "failed" ? "FAILED" : "OK"}
                          </span>
                          <span className="adm-trmeta">
                            {t.source || t.id} · {(t.chars / 1000).toFixed(1)}k ·{" "}
                            {relativeTime(t.receivedAt)}
                            {t.status === "processed"
                              ? ` · ${t.ideaIds.length} idea${t.ideaIds.length === 1 ? "" : "s"} · ${t.tapeIds?.length ?? 0} tape`
                              : ""}
                            {t.status === "failed" && t.error && t.error !== "pending"
                              ? ` · ${t.error}`
                              : ""}
                          </span>
                          <span className="adm-trcaret" aria-hidden="true">
                            {open ? "▾" : "▸"}
                          </span>
                        </button>
                        {open ? (
                          <div className="adm-trdetail">
                            {linked.length === 0 ? (
                              <span className="adm-empty">nothing extracted from this one</span>
                            ) : (
                              linked.map((l) => {
                                const idea = l.kind === "idea" ? rows.find((i) => i.id === l.id) : null;
                                const te = l.kind === "tape" ? tape.find((x) => x.id === l.id) : null;
                                const label =
                                  l.kind === "idea"
                                    ? idea
                                      ? `${idea.instrument} · ${STATUS_LABEL[idea.status]}`
                                      : `${l.id} · deleted`
                                    : te
                                      ? `${te.symbol} · TAPE ${te.status.toUpperCase()}`
                                      : `${l.id} · removed`;
                                const target = l.kind === "idea" ? `adm-idea-${l.id}` : `adm-tape-${l.id}`;
                                const exists = l.kind === "idea" ? !!idea : !!te;
                                return (
                                  <button
                                    key={l.id}
                                    type="button"
                                    className="adm-trlink"
                                    disabled={!exists}
                                    onClick={() =>
                                      document
                                        .getElementById(target)
                                        ?.scrollIntoView({ behavior: "smooth", block: "center" })
                                    }
                                  >
                                    {label}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>

            <section className="adm-panel">
              <div className="adm-panel-h">
                <span className="adm-panel-t">NEW IDEA</span>
              </div>
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

            <section className="adm-panel">
              <div className="adm-panel-h">
                <span className="adm-panel-t">DESK TAPE — QUICK ADD</span>
                <span className="adm-panel-sub">Enter saves straight to the public tape</span>
              </div>
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
                    onChange={(e) => {
                      const note = e.target.value;
                      // AD-E — sentiment inferred as an editable default (only
                      // until the select is touched by hand)
                      setTapeForm((f) => ({
                        ...f,
                        note,
                        sentiment: sentimentTouched.current
                          ? f.sentiment
                          : (suggestTapeSentiment(note) ?? f.sentiment),
                      }));
                    }}
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
                    onChange={(e) => {
                      sentimentTouched.current = true;
                      setTapeForm({ ...tapeForm, sentiment: e.target.value as TapeSentiment });
                    }}
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
              </form>
            </section>
          </div>

          {/* ── RIGHT — queues + the live book ─────────────────────────── */}
          <div className="adm-col">
            <section className="adm-panel">
              <div className="adm-panel-h">
                <span className="adm-panel-t">
                  DRAFT QUEUE{drafts.length ? ` · ${drafts.length}` : ""}
                </span>
                {drafts.length > 1 ? (
                  <span className="adm-panel-acts">
                    <button
                      type="button"
                      className="adm-btn adm-btn-acc"
                      disabled={batchBusy !== null}
                      onClick={() => approveAll(drafts)}
                    >
                      {batchBusy === "approve" ? "APPROVING…" : "APPROVE ALL"}
                    </button>
                    <button
                      type="button"
                      className="adm-btn adm-btn-warn"
                      disabled={batchBusy !== null}
                      onClick={() => rejectAll(drafts)}
                    >
                      {batchBusy === "reject" ? "REJECTING…" : "REJECT ALL"}
                    </button>
                  </span>
                ) : null}
              </div>
              {drafts.length ? (
                drafts.map((d) => (
                  <DraftCard
                    key={d.id}
                    draft={d}
                    updateTo={liveTickers.has(d.instrument.trim().toUpperCase())}
                    busy={busyId === d.id || batchBusy !== null}
                    onApprove={(edits) => approveDraft(d, edits)}
                    onReject={() => mutate(d.id, { status: "closed" })}
                  />
                ))
              ) : (
                <p className="adm-empty">no drafts waiting</p>
              )}
            </section>

            <section className="adm-panel">
              <div className="adm-panel-h">
                <span className="adm-panel-t">
                  LIVE BOOK MANAGER{book.length ? ` · ${book.length}` : ""}
                </span>
                <span className="adm-panel-acts adm-stale-ctl">
                  <label htmlFor="adm-stale">STALE AFTER</label>
                  <input
                    id="adm-stale"
                    className="adm-input adm-stale-in"
                    type="number"
                    min={1}
                    max={60}
                    value={staleDays}
                    onChange={(e) => applyStaleDays(Number(e.target.value))}
                  />
                  <span>D</span>
                </span>
              </div>
              {bookSorted.length ? (
                <div className="adm-book">
                  {bookSorted.map((i) => (
                    <BookRow
                      key={i.id}
                      idea={i}
                      stale={isStale(i)}
                      busy={busyId === i.id}
                      onPatch={(patch) => mutate(i.id, patch)}
                      onDemote={() => demoteToTape(i)}
                      onDelete={() => removeIdea(i)}
                    />
                  ))}
                </div>
              ) : (
                <p className="adm-empty">nothing on the book yet</p>
              )}
            </section>

            <section className="adm-panel">
              <div className="adm-panel-h">
                <span className="adm-panel-t">
                  TAPE DRAFTS{tapeDrafts.length ? ` · ${tapeDrafts.length}` : ""}
                </span>
              </div>
              {tapeDrafts.length ? (
                <ul className="adm-tapelist">{tapeDrafts.map(tapeRow)}</ul>
              ) : (
                <p className="adm-empty">no extracted tape waiting</p>
              )}
            </section>

            <section className="adm-panel">
              <div className="adm-panel-h">
                <span className="adm-panel-t">
                  TAPE LIVE{tapeLive.length ? ` · ${tapeLive.length}` : ""}
                </span>
              </div>
              {tapeLive.length ? (
                <ul className="adm-tapelist">{tapeLive.map(tapeRow)}</ul>
              ) : (
                <p className="adm-empty">nothing on the public tape</p>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

// ── AD-A · the status strip ──────────────────────────────────────────────────

function AdminStrip({
  ideas,
  tape,
  tracked,
  transcripts,
}: {
  ideas: Idea[] | null;
  tape: TapeEntry[];
  tracked: number | null;
  transcripts: TranscriptRecord[];
}) {
  const live = ideas?.filter((i) => i.status === "live").length ?? null;
  const drafts = ideas?.filter((i) => i.status === "draft").length ?? null;
  const last = transcripts.length > 0 ? transcripts[0] : null;
  const chip = (k: string, v: React.ReactNode) => (
    <span className="adm-strip-chip">
      <span className="adm-strip-k">{k}</span> {v}
    </span>
  );
  return (
    <header className="adm-strip">
      <span className="adm-brand">
        <span className="adm-brand-dot" aria-hidden />
        AUGUST · CONTROL ROOM
      </span>
      <span className="adm-strip-mid">
        {live !== null ? chip("LIVE", live) : null}
        {tracked !== null ? chip("TRACKED", tracked) : null}
        {drafts !== null ? chip("DRAFTS", drafts) : null}
        {ideas !== null ? chip("TAPE", tape.length) : null}
        {last ? chip("LAST INGEST", relativeTime(last.receivedAt)) : null}
      </span>
      <a className="adm-back" href="/">
        ← AUGUST
      </a>
    </header>
  );
}

// ── AD-C · draft review v2 ───────────────────────────────────────────────────

type DraftEdits = {
  thesis?: string;
  entry?: string;
  target?: string;
  stop?: string;
  riskLevel?: IdeaRiskLevel;
  side?: IdeaSide;
};

function DraftCard({
  draft,
  updateTo,
  busy,
  onApprove,
  onReject,
}: {
  draft: Idea;
  updateTo: boolean;
  busy: boolean;
  onApprove: (edits: DraftEdits) => void;
  onReject: () => void;
}) {
  // inline-editable BEFORE approval — the edits ride the approving PATCH
  const [thesis, setThesis] = useState(draft.thesis);
  const [entry, setEntry] = useState(draft.entry);
  const [target, setTarget] = useState(draft.target);
  const [stop, setStop] = useState(draft.stop ?? "");
  const [risk, setRisk] = useState<IdeaRiskLevel>(draft.riskLevel);
  const [side, setSide] = useState<IdeaSide | null>(draft.side ?? null);
  const suggested = !side ? suggestSide(entry) : null;

  return (
    <article id={`adm-idea-${draft.id}`} className="adm-card adm-draft">
      <div className="adm-card-top">
        <span className="adm-sym">{draft.instrument}</span>
        {updateTo ? (
          <span
            className="adm-update-chip"
            title="a LIVE idea already carries this ticker — approving REFRESHES it (levels update, thesis joins its history, age resets) instead of duplicating"
          >
            UPDATE to {draft.instrument.toUpperCase()}
          </span>
        ) : null}
        <span className="adm-src">{draft.source.toUpperCase()}</span>
        <span className="adm-when">{relativeTime(draft.createdAt)}</span>
      </div>
      <textarea
        className="adm-input adm-textarea"
        value={thesis}
        onChange={(e) => setThesis(e.target.value)}
        aria-label={`Thesis for ${draft.instrument}`}
        rows={3}
      />
      <div className="adm-form-row adm-levels-row">
        <input
          className="adm-input"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          aria-label="Entry"
          placeholder="entry"
        />
        <input
          className="adm-input"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Target"
          placeholder="target"
        />
        <input
          className="adm-input"
          value={stop}
          onChange={(e) => setStop(e.target.value)}
          aria-label="Stop"
          placeholder="stop"
        />
        <RiskSelect value={risk} onChange={setRisk} />
      </div>
      <div className="adm-sides" role="group" aria-label="Side">
        <span className="adm-k adm-sides-k">SIDE</span>
        {IDEA_SIDES.map((s) => {
          const active = side === s;
          const isSuggested = !side && suggested === s;
          return (
            <button
              key={s}
              type="button"
              className={`adm-side adm-side-${s}${active ? " on" : ""}${isSuggested ? " suggested" : ""}`}
              disabled={busy}
              aria-pressed={active}
              title={
                isSuggested
                  ? "suggested from the entry language — click to confirm, or pick another"
                  : active
                    ? "click again to clear"
                    : `mark ${s}`
              }
              onClick={() => setSide(active ? null : s)}
            >
              {s === "long" ? "▲ LONG" : s === "short" ? "▼ SHORT" : "◆ WATCH"}
              {isSuggested ? "?" : ""}
            </button>
          );
        })}
      </div>
      <div className="adm-actions">
        <button
          type="button"
          className="adm-btn adm-btn-acc"
          disabled={busy || !thesis.trim()}
          onClick={() =>
            onApprove({
              thesis,
              entry,
              target,
              stop,
              riskLevel: risk,
              ...(side ? { side } : {}),
            })
          }
        >
          {updateTo ? "APPROVE — UPDATE" : "APPROVE"}
        </button>
        <button type="button" className="adm-btn adm-btn-warn" disabled={busy} onClick={onReject}>
          REJECT
        </button>
      </div>
    </article>
  );
}

// ── AD-B · the live book manager row ────────────────────────────────────────

function BookRow({
  idea,
  stale,
  busy,
  onPatch,
  onDemote,
  onDelete,
}: {
  idea: Idea;
  stale: boolean;
  busy: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  onDemote: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      id={`adm-idea-${idea.id}`}
      className={`adm-bookrow adm-st-${idea.status}${stale ? " stale" : ""}`}
    >
      <div className="adm-book-head">
        <span className="adm-sym">{idea.instrument}</span>
        <span className={`adm-status adm-status-${idea.status}`}>{STATUS_LABEL[idea.status]}</span>
        {stale ? (
          <span className="adm-stale-chip" title={`no touch in over the stale window — refresh or close`}>
            STALE
          </span>
        ) : null}
        <span className="adm-when" title="last touched">
          {relativeTime(idea.updatedAt)}
        </span>
      </div>
      <p className="adm-thesis">{idea.thesis}</p>
      {idea.thesisHistory?.length ? (
        <p className="adm-hist" title={idea.thesisHistory.join("\n\n")}>
          {idea.thesisHistory.length} prior thesis{idea.thesisHistory.length === 1 ? "" : "es"} in history
        </p>
      ) : null}
      <div className="adm-form-row adm-levels-row">
        <InlineField label="ENTRY" value={idea.entry} busy={busy} onSave={(entry) => onPatch({ entry })} />
        <InlineField label="TARGET" value={idea.target} busy={busy} onSave={(target) => onPatch({ target })} />
        <InlineField label="STOP" value={idea.stop ?? ""} busy={busy} onSave={(stop) => onPatch({ stop })} />
        <RiskSelect value={idea.riskLevel} onChange={(riskLevel) => onPatch({ riskLevel })} />
      </div>
      <div className="adm-sides" role="group" aria-label="Side">
        <span className="adm-k adm-sides-k">SIDE</span>
        {IDEA_SIDES.map((s) => (
          <button
            key={s}
            type="button"
            className={`adm-side adm-side-${s}${idea.side === s ? " on" : ""}`}
            disabled={busy}
            aria-pressed={idea.side === s}
            title={idea.side === s ? "click again to clear the side" : `set ${s}`}
            onClick={() => onPatch({ side: idea.side === s ? null : s })}
          >
            {s === "long" ? "▲ LONG" : s === "short" ? "▼ SHORT" : "◆ WATCH"}
          </button>
        ))}
      </div>
      <div className="adm-actions">
        {stale ? (
          <button
            type="button"
            className="adm-btn adm-btn-acc"
            disabled={busy}
            title="reset the age — the call stands"
            onClick={() => onPatch({ status: "live" })}
          >
            REFRESH
          </button>
        ) : null}
        {idea.status === "live" ? (
          <>
            <button type="button" className="adm-btn adm-btn-warn" disabled={busy} onClick={() => onPatch({ status: "closed" })}>
              CLOSE
            </button>
            <button type="button" className="adm-btn adm-btn-warn" disabled={busy} onClick={() => onPatch({ status: "invalidated" })}>
              INVALIDATE
            </button>
          </>
        ) : (
          <button type="button" className="adm-btn" disabled={busy} onClick={() => onPatch({ status: "live" })}>
            RE-ARM
          </button>
        )}
        <button type="button" className="adm-btn" disabled={busy} title="thesis → tape note, idea leaves the book" onClick={onDemote}>
          DEMOTE → TAPE
        </button>
        <button type="button" className="adm-btn adm-btn-danger" disabled={busy} onClick={onDelete}>
          DELETE
        </button>
      </div>
    </div>
  );
}

// small inline level editor — Enter or SET applies, blur discards nothing
function InlineField({
  label,
  value,
  busy,
  onSave,
}: {
  label: string;
  value: string;
  busy: boolean;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const dirty = v.trim() !== value.trim();
  return (
    <form
      className="adm-inline"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !busy) onSave(v.trim());
      }}
    >
      <span className="adm-k">{label}</span>
      <input
        className="adm-input adm-input-inline"
        value={v}
        onChange={(e) => setV(e.target.value)}
        aria-label={label}
        placeholder="·"
        disabled={busy}
        spellCheck={false}
      />
      {dirty ? (
        <button type="submit" className="adm-btn adm-btn-acc adm-btn-set" disabled={busy}>
          SET
        </button>
      ) : null}
    </form>
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
