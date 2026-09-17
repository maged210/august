"use client";

// DELETE ACCOUNT (chore/ship-ready) — confirm-then-delete, never one tap.
//
// It lives beside Sign out (the header on desktop, the Account card on phones —
// feat/v4-2-today made it reachable there) rather than on a new surface. Three states: the
// quiet link, the armed confirmation, and the result. The result is NOT a
// green tick: it reports what was removed AND what the server said it cannot
// reach, verbatim, because a deletion that quietly leaves records behind is
// the failure this feature exists to prevent.

import { useState } from "react";

type Result = { deletedKeys: number; membersRemoved: number; unreachable: string[] };

export default function DeleteAccount({ email }: { email: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Result | null>(null);
  const [err, setErr] = useState("");

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // the exact word the route demands — the second, independent check
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const j = (await res.json().catch(() => ({}))) as Partial<Result> & { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setErr(j.error === "not_signed_in" ? "you are already signed out" : (j.error ?? `failed (${res.status})`));
        return;
      }
      setDone({
        deletedKeys: j.deletedKeys ?? 0,
        membersRemoved: j.membersRemoved ?? 0,
        unreachable: j.unreachable ?? [],
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="td-del td-del-done" role="status">
        <p className="td-del-head">Account deleted</p>
        <p className="td-del-line">
          {done.deletedKeys} record{done.deletedKeys === 1 ? "" : "s"} removed
          {done.membersRemoved ? `, ${done.membersRemoved} membership${done.membersRemoved === 1 ? "" : "s"} cleared` : ""}
          . You are signed out.
        </p>
        {done.unreachable.length ? (
          <>
            <p className="td-del-line">What this could not reach:</p>
            <ul className="td-del-list">
              {done.unreachable.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </>
        ) : null}
        <button type="button" className="td-btn" onClick={() => window.location.assign("/")}>
          Done
        </button>
      </div>
    );
  }

  if (!armed) {
    return (
      <button
        type="button"
        className="td-textbtn td-del-link"
        onClick={() => setArmed(true)}
        aria-label={`Delete the account ${email}`}
      >
        Delete account
      </button>
    );
  }

  return (
    <div className="td-del td-del-arm">
      <p className="td-del-line">
        Delete <strong>{email}</strong> and everything on it — your CALL record and picks, your PIT
        and Training progress, your watchlist, preferences and notifications. This cannot be undone.
      </p>
      {err ? <p className="td-del-err" role="alert">{err}</p> : null}
      <span className="td-del-acts">
        <button type="button" className="td-btn td-btn-danger" disabled={busy} onClick={run}>
          {busy ? "Deleting…" : "Delete forever"}
        </button>
        <button type="button" className="td-btn" disabled={busy} onClick={() => setArmed(false)}>
          Keep it
        </button>
      </span>
    </div>
  );
}
