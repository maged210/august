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
import { IDEA_RISKS, relativeTime, type Idea, type IdeaRiskLevel } from "@/lib/ideas";

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

  useEffect(() => {
    void load();
  }, [load]);

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
