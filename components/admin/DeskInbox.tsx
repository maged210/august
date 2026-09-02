"use client";

// THE DESK INBOX (feature/desk-inbox) — the ONE queue where every idea that
// can't enter the lifecycle on its own gets resolved by a human tap. Groups:
//   PENDING      drafts from ingest (or the manual form) — APPROVE / DENY
//   NEEDS LEVEL  live rows the pass can't grade — SET LEVEL / DENY; includes
//                QUOTE SUSPECT rows (quote >3× off the stated level — the NOW
//                split bug) detected live here, even while a stale sticky
//                evaluation still stands
//   REVIEW       side/entry-language conflicts — KEEP SIDE / FLIP SIDE / DENY
// DENY is two-tap (arm, then pick a reason chip) and terminal — never a
// deletion; the denied ledger below keeps the record. All writes ride the
// existing admin PATCH (gated + rate-limited); nothing here auto-resolves.

import { useEffect, useMemo, useState } from "react";
import {
  buildLevelEntry,
  DENY_REASONS,
  entryConflict,
  parseEntryTrigger,
  inboxBuckets,
  relativeTime,
  suggestSide,
  type DenyReason,
  type Idea,
  type IdeaSide,
} from "@/lib/ideas";
import { deskSymbolFor } from "@/lib/desk-symbols";
import type { TranscriptRecord } from "@/lib/transcripts";

const REASON_LABEL: Record<DenyReason, string> = {
  no_level: "NO LEVEL",
  not_a_call: "NOT A CALL",
  duplicate: "DUPLICATE",
  stale: "STALE",
};

type Quote = { price: number };

/** provenance for a row: video title + date from its transcript, or the
 *  honest fallbacks ("pasted" for an unlabeled paste, "manual" for the form) */
function sourceLine(idea: Idea, byIdeaId: Map<string, TranscriptRecord>): string {
  const rec = byIdeaId.get(idea.id);
  if (rec) {
    const date = new Date(rec.receivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${rec.source || "pasted"} · ${date}`;
  }
  return idea.source === "manual" ? "manual" : "pasted";
}

/** >3× either way — the same rule as lib/ideas' QUOTE_SUSPECT guard */
const suspectGap = (price: number, level: number) =>
  price > 0 && level > 0 && (price > level * 3 || price * 3 < level);

export default function DeskInbox({
  ideas,
  transcripts,
  busyId,
  onApprove,
  onPatch,
  onCount,
}: {
  ideas: Idea[];
  transcripts: TranscriptRecord[];
  busyId: string | null;
  /** PENDING approve — the console's dedupe-refresh approve (AD-C) */
  onApprove: (draft: Idea) => void;
  /** everything else composes over the one admin PATCH verb */
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void> | void;
  /** the AUGMENTED inbox count (incl. live-detected quote suspects) — the
   *  strip chip must never disagree with the panel header */
  onCount?: (n: number) => void;
}) {
  const buckets = useMemo(() => inboxBuckets(ideas), [ideas]);

  // live quotes for the rows that actually consume them: NEEDS LEVEL rows
  // (the >50% warn) and live rows with a parsed level (suspect detection).
  // /api/intel/quotes serves AT MOST 20 symbols — request exactly what
  // matters, in that priority order, so nothing silently loses its guard.
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const symbols = useMemo(() => {
    const prioritized = [
      ...buckets.needsLevel,
      ...ideas.filter((i) => i.status === "live" && parseEntryTrigger(i.entry)?.kind === "level"),
    ];
    return [...new Set(prioritized.map((i) => deskSymbolFor(i.instrument.trim().toUpperCase())))].slice(0, 20);
  }, [ideas, buckets]);
  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    fetch(`/api/intel/quotes?symbols=${encodeURIComponent(symbols.join(","))}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((j: { quotes?: Record<string, Quote> }) => {
        if (!cancelled && j.quotes) setQuotes(j.quotes);
      })
      .catch(() => {}); // no quotes → no suspect augmentation, no warn — honest degrade
    return () => {
      cancelled = true;
    };
  }, [symbols]);

  const quoteFor = (idea: Idea): number | null => {
    const q = quotes[deskSymbolFor(idea.instrument.trim().toUpperCase())];
    return q && Number.isFinite(q.price) && q.price > 0 ? q.price : null;
  };

  // QUOTE SUSPECT by LIVE quote — catches rows whose stored evaluation is a
  // stale sticky verdict (the NOW case) without waiting for the next pass
  const liveSuspects = useMemo(() => {
    const inNeeds = new Set(buckets.needsLevel.map((i) => i.id));
    return ideas.filter((i) => {
      if (i.status !== "live" || inNeeds.has(i.id)) return false;
      const parsed = parseEntryTrigger(i.entry);
      if (!parsed || parsed.kind !== "level") return false;
      const price = quoteFor(i);
      return price !== null && suspectGap(price, parsed.level);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideas, quotes, buckets]);

  const needsLevel = useMemo(() => [...buckets.needsLevel, ...liveSuspects], [buckets, liveSuspects]);
  const deniedAll = useMemo(
    () => ideas.filter((i) => i.status === "denied").sort((a, b) => b.updatedAt - a.updatedAt),
    [ideas],
  );
  const denied = deniedAll.slice(0, 8);
  const count = buckets.pending.length + needsLevel.length + buckets.review.length;

  // keep the strip's INBOX chip in lockstep with this header (the pure
  // inboxCount can't see the live-quote suspect augmentation)
  useEffect(() => {
    onCount?.(count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const isSuspect = (idea: Idea): boolean => {
    if (idea.evaluation?.state === "QUOTE_SUSPECT") return true;
    return liveSuspects.some((i) => i.id === idea.id);
  };

  // ── per-row action state (one open control at a time keeps taps honest) ──
  const [denyArm, setDenyArm] = useState<string | null>(null); // row id with reason chips open
  const [levelOpen, setLevelOpen] = useState<string | null>(null); // row id with SET LEVEL open
  const [levelDir, setLevelDir] = useState<"above" | "below">("above");
  const [levelText, setLevelText] = useState("");
  const [levelWarnArmed, setLevelWarnArmed] = useState(false); // >50% two-tap
  const [levelError, setLevelError] = useState<string | null>(null);

  const openSetLevel = (idea: Idea) => {
    setLevelOpen(idea.id);
    setDenyArm(null);
    setLevelText("");
    setLevelWarnArmed(false);
    setLevelError(null);
    const side = idea.side ?? suggestSide(idea.entry);
    setLevelDir(side === "short" ? "below" : "above");
  };

  const saveLevel = (idea: Idea) => {
    const n = Number(levelText.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      setLevelError("a positive number, please");
      return;
    }
    // the written entry must round-trip to EXACTLY the typed level — a
    // formatted string the parser reads differently would grade a level
    // nobody stated (the never-fabricate law)
    const entry = buildLevelEntry(levelDir, n);
    const back = parseEntryTrigger(entry);
    if (!back || back.kind !== "level" || back.level !== n) {
      setLevelError("that level doesn't survive formatting — not saved");
      return;
    }
    const price = quoteFor(idea);
    const farOff = price !== null && Math.abs(n - price) / price > 0.5;
    if (farOff && !levelWarnArmed) {
      setLevelWarnArmed(true); // first tap warns; the second saves
      return;
    }
    setLevelOpen(null);
    void onPatch(idea.id, { entry, status: "live" });
  };

  const deny = (idea: Idea, reason: DenyReason) => {
    setDenyArm(null);
    void onPatch(idea.id, { status: "denied", denyReason: reason });
  };

  const resolveReview = (idea: Idea, keep: boolean) => {
    const side = idea.side;
    if (side !== "long" && side !== "short") {
      // no directional side stated — the only honest resolution is a restatement
      void onPatch(idea.id, { entry: "", status: "live" });
      return;
    }
    const newSide: IdeaSide = keep ? side : side === "long" ? "short" : "long";
    const parsed = parseEntryTrigger(idea.entry);
    // the verbatim entry STANDS unless it actively conflicts with the chosen
    // side — the full entryConflict check must clear (else the next book pass
    // re-demotes and the row ping-pongs), and a parsed level must agree with
    // the side. Unparseable-but-agreeing language is PRESERVED: the row lands
    // in NEEDS LEVEL with the human's words intact, not erased.
    const conflictClear = entryConflict(newSide, idea.entry) === null;
    const parsedAgrees =
      parsed?.kind === "level" ? (parsed.dir === "above" ? "long" : "short") === newSide : true;
    const entryStands = conflictClear && parsedAgrees;
    void onPatch(idea.id, {
      side: newSide,
      status: "live",
      ...(entryStands ? {} : { entry: "" }),
    });
  };

  const denyControl = (idea: Idea) =>
    denyArm === idea.id ? (
      <span className="adm-deny-chips" role="group" aria-label={`Deny reason for ${idea.instrument}`}>
        {DENY_REASONS.map((r) => (
          <button key={r} type="button" className="adm-btn adm-btn-warn adm-chipbtn" disabled={busyId === idea.id} onClick={() => deny(idea, r)}>
            {REASON_LABEL[r]}
          </button>
        ))}
        <button type="button" className="adm-btn adm-chipbtn" onClick={() => setDenyArm(null)}>
          CANCEL
        </button>
      </span>
    ) : (
      <button
        type="button"
        className="adm-btn adm-btn-warn"
        disabled={busyId === idea.id}
        onClick={() => {
          setDenyArm(idea.id);
          setLevelOpen(null);
        }}
        title="two-tap: pick a reason next — denial is terminal, never a deletion"
      >
        DENY
      </button>
    );

  const byIdeaId = useMemo(() => {
    const m = new Map<string, TranscriptRecord>();
    for (const t of transcripts) for (const id of t.ideaIds ?? []) m.set(id, t);
    return m;
  }, [transcripts]);

  const row = (idea: Idea, actions: React.ReactNode, chips?: React.ReactNode) => (
    // adm-idea-{id} keeps the ingest log's deep links landing (the anchor the
    // old DraftCard carried)
    <li key={idea.id} id={`adm-idea-${idea.id}`} className="adm-inbox-row">
      <div className="adm-inbox-main">
        <span className="adm-sym">{idea.instrument}</span>
        {idea.side ? <span className={`adm-inbox-side adm-side-${idea.side}`}>{idea.side.toUpperCase()}</span> : null}
        {chips}
        <span className="adm-inbox-text" title={idea.thesis}>
          {idea.entry || idea.thesis}
        </span>
      </div>
      <div className="adm-inbox-meta">
        <span className="adm-src">{sourceLine(idea, byIdeaId)}</span>
        <span className="adm-when">{relativeTime(idea.createdAt)}</span>
        <span className="adm-inbox-acts">{actions}</span>
      </div>
    </li>
  );

  const group = (label: string, rows: React.ReactNode[]) =>
    rows.length > 0 ? (
      <>
        <li className="adm-inbox-group" aria-hidden>
          {label} · {rows.length}
        </li>
        {rows}
      </>
    ) : null;

  return (
    <section className="adm-panel" aria-label="Desk inbox">
      <div className="adm-panel-h">
        <span className="adm-panel-t">INBOX{count ? ` · ${count}` : ""}</span>
      </div>
      {count === 0 ? (
        <p className="adm-empty">the queue is clear — nothing needs your hand.</p>
      ) : (
        <ul className="adm-inbox">
          {group(
            "PENDING",
            buckets.pending.map((d) =>
              row(
                d,
                <>
                  <button
                    type="button"
                    className="adm-btn adm-btn-acc"
                    disabled={busyId === d.id}
                    onClick={() => onApprove(d)}
                    title="→ LIVE (a live twin gets refreshed); lands in NEEDS LEVEL if no level parses"
                  >
                    APPROVE
                  </button>
                  {denyControl(d)}
                </>,
              ),
            ),
          )}
          {group(
            "NEEDS LEVEL",
            needsLevel.map((i) =>
              row(
                i,
                levelOpen === i.id ? (
                  <span className="adm-setlevel">
                    <select
                      className="adm-input adm-select"
                      value={levelDir}
                      onChange={(e) => setLevelDir(e.target.value as "above" | "below")}
                      aria-label="Direction"
                    >
                      <option value="above">ABOVE</option>
                      <option value="below">BELOW</option>
                    </select>
                    <input
                      className="adm-input adm-level-in"
                      value={levelText}
                      onChange={(e) => {
                        setLevelText(e.target.value);
                        setLevelWarnArmed(false);
                        setLevelError(null);
                      }}
                      placeholder={quoteFor(i) !== null ? `quote ${quoteFor(i)!.toFixed(2)}` : "level"}
                      inputMode="decimal"
                      aria-label={`Level for ${i.instrument}`}
                    />
                    <button type="button" className="adm-btn adm-btn-acc" disabled={busyId === i.id} onClick={() => saveLevel(i)}>
                      {levelWarnArmed ? "CONFIRM" : "SAVE"}
                    </button>
                    <button type="button" className="adm-btn" onClick={() => setLevelOpen(null)}>
                      CANCEL
                    </button>
                    {levelWarnArmed ? (
                      <span className="adm-level-warn" role="alert">
                        more than 50% from the quote — save again to confirm
                      </span>
                    ) : null}
                    {levelError ? (
                      <span className="adm-level-warn" role="alert">
                        {levelError}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <>
                    <button type="button" className="adm-btn adm-btn-acc" disabled={busyId === i.id} onClick={() => openSetLevel(i)}>
                      SET LEVEL
                    </button>
                    {denyControl(i)}
                  </>
                ),
                isSuspect(i) ? (
                  <span
                    className="adm-suspect-chip"
                    // a live-detected suspect still CARRIES its stale sticky
                    // evaluation — that reason asserts the very verdict this
                    // chip disputes, so only a stored QUOTE_SUSPECT reason
                    // ever rides the tooltip
                    title={
                      i.evaluation?.state === "QUOTE_SUSPECT"
                        ? i.evaluation.reason
                        : "the live quote is more than 3× away from the stated level — split, delisting, or symbol mismatch; not evaluated"
                    }
                  >
                    QUOTE SUSPECT
                  </span>
                ) : undefined,
              ),
            ),
          )}
          {group(
            "REVIEW",
            buckets.review.map((i) =>
              row(
                i,
                <>
                  {i.side === "long" || i.side === "short" ? (
                    <>
                      <button type="button" className="adm-btn adm-btn-acc" disabled={busyId === i.id} onClick={() => resolveReview(i, true)} title="keep the stated side; a conflicting entry clears → NEEDS LEVEL">
                        KEEP SIDE
                      </button>
                      <button type="button" className="adm-btn" disabled={busyId === i.id} onClick={() => resolveReview(i, false)} title="flip the side; an agreeing entry stands → LIVE">
                        FLIP SIDE
                      </button>
                    </>
                  ) : (
                    <button type="button" className="adm-btn adm-btn-acc" disabled={busyId === i.id} onClick={() => resolveReview(i, true)} title="no directional side stated — clears the entry for restatement">
                      RESTATE
                    </button>
                  )}
                  {denyControl(i)}
                </>,
                i.reviewReason ? <span className="adm-review-chip" title={i.reviewReason}>CONFLICT</span> : undefined,
              ),
            ),
          )}
        </ul>
      )}
      {denied.length > 0 ? (
        <div className="adm-denied">
          <span className="adm-denied-t">
            DENIED · {deniedAll.length}
            {deniedAll.length > denied.length ? ` (last ${denied.length} shown — the store keeps them all)` : ""}
          </span>
          {denied.map((i) => (
            <span key={i.id} id={`adm-idea-${i.id}`} className="adm-denied-row">
              {i.instrument}
              <span className="adm-reason-chip">{i.denyReason ? REASON_LABEL[i.denyReason] : "—"}</span>
              <span className="adm-when">{relativeTime(i.updatedAt)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
