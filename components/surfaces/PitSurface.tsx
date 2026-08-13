"use client";

// THE PIT (GAME-1) — play against the desk. SIMULATED ONLY, permanently
// labeled. Two modes off /api/pit: BEAT THE DESK (ride/fade every live call;
// the desk's own since-call % scores you when it triggers) and the DAILY
// CLOSE CALL (over/under three pulse symbols vs the previous close). One
// anonymous player per visitor (the privacy-fix principal), display name,
// top-20 board. Resolution is lazy server-side — loading the pit settles
// anything that closed since your last visit.

import { useCallback, useEffect, useRef, useState } from "react";
import { relativeTime, type PublicIdea } from "@/lib/ideas";
import { sideOf } from "@/components/surfaces/dock/derive";
import type { LeaderRow, PitPlayer } from "@/lib/pit";
import "@/app/intel/feed.css";

type DailyState = {
  date: string;
  locked: boolean;
  already: { picks: Array<{ sym: string; dir: string; line: number }>; resolved?: boolean; results?: boolean[] } | null;
  symbols: Array<{ sym: string; label: string; line: number | null }>;
};

type PitState = {
  player: PitPlayer;
  ideas: PublicIdea[];
  daily: DailyState;
  leaderboard: LeaderRow[];
};

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const px = (n: number) =>
  n >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2);

export default function PitSurface({ active }: { active: boolean }) {
  const [state, setState] = useState<PitState | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [editName, setEditName] = useState(false);
  const [dailyDraft, setDailyDraft] = useState<Record<string, "over" | "under">>({});
  const [justPicked, setJustPicked] = useState<string | null>(null); // pick pulse
  const [shareDone, setShareDone] = useState(false);
  const visited = useRef(false);

  const load = useCallback(() => {
    fetch("/api/pit", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: PitState & { ok?: boolean }) => {
        if (j.ok === false) throw new Error("pit");
        setState(j);
        setErr(false);
      })
      .catch(() => setErr(true));
  }, []);

  useEffect(() => {
    if (!active || visited.current) return;
    visited.current = true;
    load();
  }, [active, load]);

  const post = async (body: Record<string, unknown>, busyKey: string) => {
    setBusy(busyKey);
    try {
      const res = await fetch("/api/pit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; player?: PitPlayer };
      if (res.ok && j.ok && j.player) {
        setState((s) => (s ? { ...s, player: j.player! } : s));
        return true;
      }
    } catch {
      /* fall through */
    } finally {
      setBusy(null);
    }
    return false;
  };

  const pick = async (idea: PublicIdea, side: "ride" | "fade") => {
    const ok = await post({ action: "pick", ideaId: idea.id, side }, idea.id);
    if (ok) {
      setJustPicked(idea.id);
      window.setTimeout(() => setJustPicked(null), 700);
      load(); // refresh the board rank
    }
  };

  const share = async () => {
    const p = state?.player;
    if (!p) return;
    const text = `🔥 ${p.streak}-streak against the desk — ${fmtPct(p.score)} in THE PIT (simulated)`;
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
      setShareDone(true);
      window.setTimeout(() => setShareDone(false), 1500);
    } catch {
      /* user dismissed */
    }
  };

  if (err) {
    return (
      <div className="pit intel-embed-frame">
        <div className="if-state">
          <div className="if-state-title">THE PIT IS UNREACHABLE</div>
          <button type="button" className="if-retry" onClick={load}>
            RETRY
          </button>
        </div>
      </div>
    );
  }

  const p = state?.player ?? null;
  const picked = new Set(p?.picks.map((k) => k.ideaId) ?? []);
  const flame = p ? Math.min(5, p.streak) : 0;

  return (
    <div className="pit intel-embed-frame">
      {/* G6 — the permanent honesty rail */}
      <p className="pit-sim" role="note">
        SIMULATED — entertainment, not investment advice. No real orders.
      </p>

      <div className="pit-cols">
        <div className="pit-col">
          {/* player sheet */}
          <section className="ifm pit-me">
            <div className="ifm-h">
              <span className="ifm-title">
                {editName ? (
                  <form
                    className="pit-nameform"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await post({ action: "name", name: nameDraft }, "name")) setEditName(false);
                    }}
                  >
                    <input
                      className="pit-namein"
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      maxLength={16}
                      placeholder="display name"
                      aria-label="Display name"
                    />
                    <button type="submit" className="pit-btn" disabled={busy === "name"}>
                      SET
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="pit-namebtn"
                    onClick={() => {
                      setNameDraft(p?.name === "PLAYER" ? "" : (p?.name ?? ""));
                      setEditName(true);
                    }}
                    title="change your display name"
                  >
                    {p?.name ?? "PLAYER"} ✎
                  </button>
                )}
              </span>
              <span className="ifm-sub">YOUR SHEET</span>
            </div>
            {p ? (
              <div className="ifm-body pit-stats">
                <span className={`pit-score ${p.score >= 0 ? "if-pos" : "if-neg"}`}>{fmtPct(p.score)}</span>
                <span className="pit-stat">W {p.wins}</span>
                <span className="pit-stat">L {p.losses}</span>
                <span className="pit-stat">PUSH {p.pushes}</span>
                <span className={`pit-flame f${flame}`} title={`streak ${p.streak} · best ${p.bestStreak}`}>
                  {"🔥".repeat(Math.max(0, Math.min(3, Math.ceil(flame / 2))) || 0) || "·"} {p.streak}
                </span>
                <button type="button" className="pit-btn" onClick={share}>
                  {shareDone ? "COPIED" : "SHARE"}
                </button>
              </div>
            ) : (
              <div className="ifm-body">
                <span className="if-abs">loading your sheet…</span>
              </div>
            )}
            {p && p.picks.length > 0 ? (
              <ul className="pit-hist">
                {p.picks.slice(0, 8).map((k) => (
                  <li key={k.ideaId} className="pit-histrow">
                    <span className="pit-h-tkr">{k.ticker}</span>
                    <span className={`pit-h-side pit-${k.side}`}>{k.side.toUpperCase()}</span>
                    <span className="pit-h-when">{relativeTime(k.at)}</span>
                    <span
                      className={`pit-h-res ${
                        k.status === "open" ? "" : k.status === "push" ? "" : k.pct! >= 0 ? "if-pos" : "if-neg"
                      }`}
                    >
                      {k.status === "open" ? "OPEN" : k.status === "push" ? "PUSH" : fmtPct(k.pct!)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* G3 — daily close call */}
          <section className="ifm">
            <div className="ifm-h">
              <span className="ifm-title">DAILY CLOSE CALL</span>
              <span className="ifm-sub">
                {state?.daily.locked ? "LOCKED — resolves at the close" : "over/under vs yesterday's close · locks 09:30 ET"}
              </span>
            </div>
            <div className="ifm-body pit-daily">
              {state?.daily.already ? (
                ((already) =>
                  already.picks.map((k, i) => (
                  <span key={k.sym} className="pit-dailyrow">
                    <span className="pit-h-tkr">{k.sym.replace("-USD", "")}</span>
                    <span className={`pit-h-side pit-${k.dir === "over" ? "ride" : "fade"}`}>{k.dir.toUpperCase()}</span>
                    <span className="pit-line">{px(k.line)}</span>
                    <span
                      className={`pit-h-res ${
                        already.resolved ? (already.results?.[i] ? "if-pos" : "if-neg") : ""
                      }`}
                    >
                      {already.resolved ? (already.results?.[i] ? "HIT ✓" : "MISS") : "PENDING"}
                    </span>
                  </span>
                )))(state.daily.already)
              ) : state?.daily.locked ? (
                <span className="if-abs">today's card is locked — come back before the next open</span>
              ) : (
                <>
                  {state?.daily.symbols
                    .filter((s) => s.line != null)
                    .map((s) => (
                      <span key={s.sym} className="pit-dailyrow">
                        <span className="pit-h-tkr">{s.label}</span>
                        <span className="pit-line">{px(s.line!)}</span>
                        {(["over", "under"] as const).map((d) => (
                          <button
                            key={d}
                            type="button"
                            className={`pit-btn pit-ou${dailyDraft[s.sym] === d ? " on" : ""}`}
                            onClick={() => setDailyDraft((m) => ({ ...m, [s.sym]: d }))}
                          >
                            {d.toUpperCase()}
                          </button>
                        ))}
                      </span>
                    ))}
                  <button
                    type="button"
                    className="pit-btn pit-lockin"
                    disabled={busy === "daily" || Object.keys(dailyDraft).length === 0}
                    onClick={() =>
                      post(
                        {
                          action: "daily",
                          picks: Object.entries(dailyDraft).map(([sym, dir]) => ({ sym, dir })),
                        },
                        "daily",
                      )
                    }
                  >
                    LOCK IT IN
                  </button>
                </>
              )}
            </div>
          </section>

          {/* G4 — leaderboard */}
          <section className="ifm">
            <div className="ifm-h">
              <span className="ifm-title">LEADERBOARD</span>
              <span className="ifm-sub">TOP {state?.leaderboard.length ?? 0}</span>
            </div>
            <ol className="pit-lb">
              {(state?.leaderboard ?? []).map((r, i) => (
                <li key={r.pid} className={`pit-lbrow${p && r.pid === p.pid ? " me" : ""}`}>
                  <span className="pit-rank">{i + 1}</span>
                  <span className="pit-lbname">{r.name}</span>
                  {r.streak > 1 ? <span className="pit-lbstreak">🔥{r.streak}</span> : null}
                  <span className={`pit-lbscore ${r.score >= 0 ? "if-pos" : "if-neg"}`}>{fmtPct(r.score)}</span>
                </li>
              ))}
              {(state?.leaderboard ?? []).length === 0 ? (
                <li className="if-abs">nobody on the board yet — be first</li>
              ) : null}
            </ol>
          </section>
        </div>

        {/* G2 — beat the desk */}
        <div className="pit-col">
          <section className="ifm">
            <div className="ifm-h">
              <span className="ifm-title">BEAT THE DESK</span>
              <span className="ifm-sub">ride or fade every live call — the desk's own % scores you at trigger</span>
            </div>
            <div className="pit-cards">
              {(state?.ideas ?? []).map((idea) => {
                const side = sideOf(idea);
                const mine = p?.picks.find((k) => k.ideaId === idea.id);
                return (
                  <article key={idea.id} className={`pit-card${justPicked === idea.id ? " picked" : ""}`}>
                    <span className="pit-card-top">
                      <span className="pit-h-tkr">{idea.instrument}</span>
                      {side ? (
                        <span className={`if-bside ${side.side === "LONG" ? "if-dir-bull" : side.side === "SHORT" ? "if-dir-bear" : "if-dir-neut"}${side.derived ? " derived" : ""}`}>
                          {side.side}
                        </span>
                      ) : null}
                      <span className="pit-h-when">{relativeTime(idea.createdAt)}</span>
                    </span>
                    {idea.entry ? (
                      <span className="if-mcard-entry">
                        <span className="if-mcard-entry-k">ENTRY</span> {idea.entry}
                      </span>
                    ) : null}
                    <span className="pit-card-thesis">{idea.thesis.slice(0, 110)}</span>
                    {mine ? (
                      <span className={`pit-mine pit-${mine.side}`}>
                        YOU {mine.side.toUpperCase()} ·{" "}
                        {mine.status === "open" ? "waiting on the desk" : mine.status === "push" ? "push" : fmtPct(mine.pct!)}
                      </span>
                    ) : (
                      <span className="pit-card-acts">
                        <button type="button" className="pit-btn pit-ride" disabled={busy === idea.id} onClick={() => pick(idea, "ride")}>
                          RIDE
                        </button>
                        <button type="button" className="pit-btn pit-fadeb" disabled={busy === idea.id} onClick={() => pick(idea, "fade")}>
                          FADE
                        </button>
                        <button type="button" className="pit-btn" disabled={busy === idea.id} title="no pick on this one">
                          SKIP
                        </button>
                      </span>
                    )}
                  </article>
                );
              })}
              {state && state.ideas.length === 0 ? (
                <span className="if-abs">no open calls right now — the desk is quiet</span>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
