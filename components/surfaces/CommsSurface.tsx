"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import WidgetState from "@/components/WidgetState";

// Live Comms surface — the owner's real Gmail. READ is read-only metadata. REPLY is a
// deliberate draft → review → send flow (the "Hands" layer): AUGUST drafts, you edit,
// and NOTHING sends without an explicit tap on the exact final text. Sending is a
// dedicated server route (/api/comms/send) fired only from the confirm tap — never an
// LLM tool. Tokens live server-side only; this component sees normalized data.

const REFRESH_MS = 3 * 60_000;

type Category = "personal" | "work" | "noise";
type InboxItem = {
  id: string;
  ts: number;
  sender: string;
  subject: string;
  category: Category;
  unread: boolean;
  important: boolean;
};
type InboxState = {
  connected: boolean;
  oauthConfigured: boolean;
  storageConfigured: boolean;
  email?: string;
  messages: InboxItem[];
  unread: number;
  briefLine: string;
  stale?: boolean;
  canSend?: boolean;
};

// drafting → ready (editable) → confirm (review exact text) → sending → sent / error
type ReplyPhase = "drafting" | "ready" | "confirm" | "sending" | "sent" | "error";
type DraftMeta = { to: string; fromName: string; subject: string };

const DAY = 86_400_000;
function fmtTime(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startToday) {
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
  }
  if (ts >= startToday - DAY) return "y'day";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function statusNote(code: string | null): string | null {
  if (!code || code === "connected") return null;
  if (code === "denied") return "Connection cancelled.";
  if (code === "state_mismatch") return "Security check failed — try connecting again.";
  if (code === "oauth_unconfigured") return "Gmail OAuth isn't configured on the server.";
  if (code === "storage_unconfigured") return "Token storage (Upstash) isn't configured.";
  if (code.startsWith("error_")) return `Couldn't connect: ${code.slice(6).replace(/_/g, " ")}.`;
  if (code === "invalid") return "Connection response was malformed — try again.";
  return null;
}

function sendErrorMessage(code: string): string {
  if (code.includes("needs_send_consent") || code.includes("insufficient_scope")) {
    return "Reconnect Gmail to grant send access, then try again.";
  }
  if (code.includes("not_connected")) return "Gmail isn't connected.";
  if (code.includes("message_not_found")) return "Couldn't find that message anymore.";
  if (code.includes("empty")) return "Nothing to send.";
  return "Send failed — nothing was sent. Try again.";
}

export default function CommsSurface() {
  const [data, setData] = useState<InboxState | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [note, setNote] = useState<string | null>(null);

  // Reply state — only one draft open at a time.
  const [replyMsg, setReplyMsg] = useState<InboxItem | null>(null);
  const [phase, setPhase] = useState<ReplyPhase>("drafting");
  const [meta, setMeta] = useState<DraftMeta | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const draftAbort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const j: InboxState = await res.json();
      setData(j);
      setStatus("live");
    } catch {
      setStatus((s) => (s === "live" ? "live" : "error"));
    }
  }, []);

  const closeReply = useCallback(() => {
    draftAbort.current?.abort();
    draftAbort.current = null;
    setReplyMsg(null);
    setMeta(null);
    setText("");
    setErr(null);
  }, []);

  // Start a draft for a message: read the thread server-side + have AUGUST draft. The
  // draft endpoint has NO send capability — this only ever produces editable text.
  const openDraft = useCallback(async (m: InboxItem) => {
    if (sentIds.has(m.id)) return;
    draftAbort.current?.abort();
    const ac = new AbortController();
    draftAbort.current = ac;
    setReplyMsg(m);
    setMeta(null);
    setText("");
    setErr(null);
    setPhase("drafting");
    try {
      const res = await fetch("/api/comms/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: m.id }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as DraftMeta & { draft: string };
      if (ac.signal.aborted) return;
      setMeta({ to: j.to, fromName: j.fromName, subject: j.subject });
      setText(j.draft || "");
      setPhase("ready");
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setErr("AUGUST couldn't draft a reply just now.");
      setPhase("error");
    }
  }, [sentIds]);

  // The ONLY send trigger. Fires on the explicit confirm tap, sending the CURRENT
  // edited text verbatim. No retry loop — a failure returns to the confirm step.
  const confirmSend = useCallback(async () => {
    if (!replyMsg) return;
    const bodyText = text.trim();
    if (!bodyText) {
      setErr("Nothing to send.");
      setPhase("error");
      return;
    }
    setPhase("sending");
    setErr(null);
    try {
      const res = await fetch("/api/comms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: replyMsg.id, body: bodyText }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error || String(res.status));
      setSentIds((prev) => new Set(prev).add(replyMsg.id));
      setPhase("sent");
      window.setTimeout(() => {
        closeReply();
        load();
      }, 1500);
    } catch (e) {
      setErr(sendErrorMessage(String((e as Error)?.message ?? "")));
      setPhase("error");
    }
  }, [replyMsg, text, closeReply, load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("comms");
    setNote(statusNote(code));
    if (code) {
      params.delete("comms");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
      );
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const connected = !!data?.connected;
  const canSend = !!data?.canSend;
  const liveBadge = connected ? (
    <span className="comms-live">
      LIVE · GMAIL{data?.email ? ` · ${data.email}` : ""}
    </span>
  ) : (
    <span className="todo">read-only · not connected</span>
  );

  return (
    <div className="surface comms-surface">
      <header className="surface-head">
        <h2 className="surface-title">Comms</h2>
        {liveBadge}
      </header>

      <section className="panel comms-log">
        <div className="panel-head">Inbox — rendered as log</div>

        {note ? <div className="comms-note">{note}</div> : null}

        {status === "loading" && !data ? (
          <WidgetState state="loading" rows={6} />
        ) : status === "error" && !data ? (
          <WidgetState state="error" onRetry={load} />
        ) : data && !data.oauthConfigured ? (
          <div className="comms-connect">
            <p className="comms-connect-lead">Gmail isn&rsquo;t configured on the server.</p>
            <p className="comms-connect-sub">
              Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to enable
              read-only inbox access.
            </p>
          </div>
        ) : data && !connected ? (
          <div className="comms-connect">
            <p className="comms-connect-lead">Let me read your inbox.</p>
            <p className="comms-connect-sub">
              Read-only to start — I can see who wrote and the subject lines. If you let me, I can
              also <em>draft</em> replies for you to review and send; nothing ever sends without
              your tap. You can revoke any time from your Google account.
            </p>
            <a className="comms-connect-btn" href="/api/auth/google">
              Connect Gmail
            </a>
          </div>
        ) : data && connected && data.messages.length === 0 ? (
          <WidgetState state="empty" />
        ) : data && connected ? (
          <>
            {/* Connected to read, but the send scope isn't granted yet — offer the
                one-time reconnect that adds it (incremental consent). */}
            {!canSend ? (
              <div className="comms-reply-prompt">
                I can read your inbox.{" "}
                <a href="/api/auth/google">Reconnect</a> to let me draft replies you can edit and send.
              </div>
            ) : (
              <div className="comms-reply-prompt comms-reply-prompt-quiet">
                Tap a message and I&rsquo;ll draft a reply — you edit, you send.
              </div>
            )}

            <ul className="loglines">
              {data.messages.map((m) => {
                const isActive = replyMsg?.id === m.id;
                const isSent = sentIds.has(m.id);
                const replyable = canSend && !isSent;
                return (
                  <li key={m.id} className="logrow">
                    <div
                      className={`logline ${m.category}${m.unread ? " unread" : ""}${replyable ? " replyable" : ""}${isActive ? " active" : ""}${isSent ? " sent" : ""}`}
                      onClick={replyable && !isActive ? () => openDraft(m) : undefined}
                      role={replyable ? "button" : undefined}
                      tabIndex={replyable ? 0 : undefined}
                      onKeyDown={
                        replyable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openDraft(m);
                              }
                            }
                          : undefined
                      }
                      aria-label={replyable ? `Draft a reply to ${m.sender}` : undefined}
                    >
                      <span className="log-t">{fmtTime(m.ts)}</span>
                      <span className="log-arrow">{isSent ? "↩" : m.unread ? "●" : "›"}</span>
                      <span className="log-from" title={m.sender}>{m.sender}</span>
                      {/* single-line ellipsis clamp (globals: .log-subj) — the title
                          keeps the full subject reachable on hover */}
                      <span className="log-subj" title={m.subject}>{m.subject}</span>
                      <span className="log-tag">{isSent ? "replied" : m.category}</span>
                    </div>

                    {isActive ? (
                      <ReplyComposer
                        phase={phase}
                        meta={meta}
                        text={text}
                        err={err}
                        onText={setText}
                        onReview={() => setPhase("confirm")}
                        onBack={() => setPhase("ready")}
                        onConfirm={confirmSend}
                        onRetry={() => (meta ? setPhase("confirm") : openDraft(m))}
                        onClose={closeReply}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <div className="comms-foot">
              $ augustctl mailbox --tail · {data.messages.length} shown ·{" "}
              {data.unread} unread{data.stale ? " · stale (feed degraded)" : ""}
            </div>
          </>
        ) : (
          <WidgetState state="loading" rows={6} />
        )}
      </section>
    </div>
  );
}

// The inline draft/confirm/send panel. Presentational — all sending is driven by the
// parent's confirmSend (the single tap-gated trigger).
function ReplyComposer({
  phase,
  meta,
  text,
  err,
  onText,
  onReview,
  onBack,
  onConfirm,
  onRetry,
  onClose,
}: {
  phase: ReplyPhase;
  meta: DraftMeta | null;
  text: string;
  err: string | null;
  onText: (v: string) => void;
  onReview: () => void;
  onBack: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="comms-reply" role="region" aria-label="Draft reply">
      {phase === "drafting" ? (
        <div className="comms-reply-status mb-pulse">AUGUST is drafting a reply…</div>
      ) : null}

      {phase === "ready" ? (
        <>
          {/* clamped to one line in globals (.comms-reply-meta) — the confirm step
              still shows the exact full subject before anything sends */}
          <div className="comms-reply-meta" title={meta?.subject}>
            to <span className="comms-reply-to">{meta?.fromName || meta?.to}</span> ·{" "}
            <span className="comms-reply-subj">{meta?.subject}</span>
          </div>
          <textarea
            className="comms-reply-field"
            value={text}
            onChange={(e) => onText(e.target.value)}
            rows={5}
            aria-label="Reply draft — edit freely before sending"
            spellCheck
          />
          <div className="comms-reply-actions">
            <button type="button" className="comms-btn comms-btn-go" onClick={onReview} disabled={!text.trim()}>
              Review &amp; send →
            </button>
            <button type="button" className="comms-btn comms-btn-ghost" onClick={onClose}>
              Discard
            </button>
          </div>
        </>
      ) : null}

      {phase === "confirm" ? (
        <div className="comms-confirm">
          <div className="comms-confirm-head">Send this reply? This is exactly what goes out.</div>
          <dl className="comms-confirm-fields">
            <div>
              <dt>To</dt>
              <dd>{meta?.to}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>{meta?.subject}</dd>
            </div>
            <div>
              <dt>Body</dt>
              <dd className="comms-confirm-body">{text.trim()}</dd>
            </div>
          </dl>
          <div className="comms-reply-actions">
            <button type="button" className="comms-btn comms-btn-send" onClick={onConfirm}>
              ✓ Confirm &amp; send
            </button>
            <button type="button" className="comms-btn comms-btn-ghost" onClick={onBack}>
              ← Back to edit
            </button>
          </div>
        </div>
      ) : null}

      {phase === "sending" ? <div className="comms-reply-status mb-pulse">Sending…</div> : null}

      {phase === "sent" ? (
        <div className="comms-reply-status comms-sent">✓ Sent — threaded into the conversation.</div>
      ) : null}

      {phase === "error" ? (
        <div className="comms-reply-status comms-err">
          <span>{err}</span>
          <div className="comms-reply-actions">
            <button type="button" className="comms-btn comms-btn-go" onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="comms-btn comms-btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
