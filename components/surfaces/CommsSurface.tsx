"use client";

import { useCallback, useEffect, useState } from "react";
import WidgetState from "@/components/WidgetState";

// Live Comms surface — the owner's real Gmail, READ-ONLY, rendered as a terminal
// log. OAuth happens via a full-page redirect to /api/auth/google; tokens live
// server-side only. This component only ever sees normalized metadata.

const REFRESH_MS = 3 * 60_000;

type Category = "personal" | "work" | "noise";
type InboxItem = {
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
};

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

// Human-readable note for the ?comms=… status the callback redirects back with.
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

export default function CommsSurface() {
  const [data, setData] = useState<InboxState | null>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [note, setNote] = useState<string | null>(null);

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

  // Surface the OAuth outcome from the callback redirect (?comms=…), then strip
  // it from the URL so a refresh doesn't repeat the note.
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
              Read-only — I can see who wrote and the subject lines, nothing more. No sending, no
              changes. You can revoke any time from your Google account.
            </p>
            {/* Full-page navigation to the server-side consent flow. */}
            <a className="comms-connect-btn" href="/api/auth/google">
              Connect Gmail
            </a>
          </div>
        ) : data && connected && data.messages.length === 0 ? (
          <WidgetState state="empty" />
        ) : data && connected ? (
          <>
            <ul className="loglines">
              {data.messages.map((m, i) => (
                <li key={i} className={`logline ${m.category}${m.unread ? " unread" : ""}`}>
                  <span className="log-t">{fmtTime(m.ts)}</span>
                  <span className="log-arrow">{m.unread ? "●" : "›"}</span>
                  <span className="log-from">{m.sender}</span>
                  <span className="log-subj">{m.subject}</span>
                  <span className="log-tag">{m.category}</span>
                </li>
              ))}
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
