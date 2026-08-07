"use client";

// PANEL 1 — IDEA DETAIL (G3 round 5). The blotter's ONE detail surface:
// selection-driven (row click / ?idea= deep link), replacing the old inline
// row expansion. Renders entirely from data already on the wire — full
// thesis, stated levels with honest ∅ states, the performance block, and the
// status-history timeline. A fixed min-height keeps selection changes from
// shifting the layout.

import type { FeedCard } from "@/lib/intel/publish";
import type { TrackedLevel, TrackedStatus } from "@/lib/intel/tracker";
import type { IdeaRiskLevel, PublicIdea } from "@/lib/ideas";

const px = (v: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctFmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
const fmtDateTime = (ms: number) =>
  new Date(ms)
    .toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    .toUpperCase();

const LIFE_LABEL: Record<TrackedStatus, string> = {
  TRIGGERED: "TRIGGERED",
  ARMED: "ARMED",
  ACTIVE: "ACTIVE",
  TARGET_HIT: "TARGET HIT",
  INVALIDATED: "INVALIDATED",
  CLOSED: "CLOSED",
};

const RISK_LABEL: Record<IdeaRiskLevel, string> = {
  low: "LOW RISK",
  medium: "MED RISK",
  high: "HIGH RISK",
};

function Absent({ text = "not stated" }: { text?: string }) {
  return (
    <span className="if-abs">
      <span className="if-abs-g" aria-hidden="true">
        ∅
      </span>{" "}
      {text}
    </span>
  );
}

function LevelRow({ label, level, cls }: { label: string; level: TrackedLevel | null; cls: string }) {
  return (
    <div className="if-sh-lev">
      <span className="if-sh-lev-lab">{label}</span>
      {level == null ? (
        <Absent />
      ) : (
        <>
          <span className={`if-sh-lev-val ${cls}`}>{level.value != null ? px(level.value) : "—"}</span>
          <span className="if-sh-lev-txt" title={level.text}>
            {level.text}
          </span>
        </>
      )}
    </div>
  );
}

/** free-form level string (LIVE ideas) — verbatim, ∅ when empty */
function TextLevelRow({ label, text, cls }: { label: string; text: string; cls: string }) {
  return (
    <div className="if-sh-lev">
      <span className="if-sh-lev-lab">{label}</span>
      {text ? (
        <span className={`if-sh-lev-txt ${cls}`} title={text} style={{ whiteSpace: "normal" }}>
          {text}
        </span>
      ) : (
        <Absent />
      )}
    </div>
  );
}

export default function IdeaDetailPanel({
  live,
  card,
}: {
  /** the selected LIVE idea (new backend), when selection is a live row */
  live: PublicIdea | null;
  /** the selected tracked card (legacy pipeline), when selection is tracked */
  card: FeedCard | null;
}) {
  const title = live ? `${live.instrument} · LIVE` : card ? `${card.ticker} · ${LIFE_LABEL[card.status] ?? card.status}` : null;

  // tracked performance pieces (all from the feed's own pnl view — labeled by kind)
  const pnl = card?.pnl ?? null;
  const perfNum =
    pnl && pnl.kind !== "none" ? (
      <span className={`if-sh-perf-num ${pnl.pct >= 0 ? "if-pos" : "if-neg"}`}>
        {pctFmt(pnl.pct)}
        {pnl.kind === "since_first_mention" ? "°" : ""}
      </span>
    ) : null;

  return (
    <section className="ifm if-detail" aria-label="Idea detail">
      <div className="ifm-h">
        <span className="ifm-title">IDEA DETAIL</span>
        {title ? <span className="ifm-sub">{title}</span> : null}
      </div>
      <div className="ifm-body if-detail-body">
        {!live && !card ? (
          <Absent text="select a blotter row" />
        ) : live ? (
          <div className="if-detail-grid">
            <div className="if-detail-col">
              <div className="if-sh-meta">
                <span className={`if-risk if-risk-${live.riskLevel}`}>{RISK_LABEL[live.riskLevel]}</span> · CALLED{" "}
                {fmtDate(live.createdAt)}
              </div>
              <p className="if-sh-thesis">{live.thesis}</p>
            </div>
            <div className="if-detail-col">
              <div className="if-sh-sect-h">STATED LEVELS</div>
              <TextLevelRow label="ENTRY" text={live.entry} cls="if-lev-entry" />
              <TextLevelRow label="TARGET" text={live.target} cls="if-lev-target" />
              <TextLevelRow label="STOP" text="" cls="if-lev-stop" />
              <div className="if-sh-sect-h" style={{ marginTop: 14 }}>
                PERFORMANCE
              </div>
              <Absent text="not tracked yet — a live call has no measurement" />
              <div className="if-sh-sect-h" style={{ marginTop: 14 }}>
                STATUS HISTORY
              </div>
              <Absent text="no transitions — the call stands as posted" />
            </div>
          </div>
        ) : card ? (
          <div className="if-detail-grid">
            <div className="if-detail-col">
              <div className="if-sh-meta">
                FIRST MENTION {fmtDate(card.firstMentionAt)} · PUBLISHED {fmtDate(card.publishedAt)}
                {card.stale ? (
                  <span className="if-stale if-xp-stale">{card.evicted ? "ARCHIVED" : "STALE"}</span>
                ) : null}
              </div>
              <p className="if-sh-thesis">{card.thesis}</p>
              <div className="if-sh-sect-h" style={{ marginTop: 14 }}>
                STATED LEVELS
              </div>
              <LevelRow label="ENTRY" level={card.statedLevels.trigger} cls="if-lev-entry" />
              {card.statedLevels.targets.length === 0 ? (
                <LevelRow label="TARGET" level={null} cls="if-lev-target" />
              ) : (
                card.statedLevels.targets.map((t, i) => (
                  <LevelRow
                    key={i}
                    label={card.statedLevels.targets.length > 1 ? `TARGET ${i + 1}` : "TARGET"}
                    level={t}
                    cls="if-lev-target"
                  />
                ))
              )}
              <LevelRow label="STOP" level={card.statedLevels.invalidation} cls="if-lev-stop" />
            </div>
            <div className="if-detail-col">
              <div className="if-sh-sect-h">PERFORMANCE</div>
              {perfNum && pnl && pnl.kind !== "none" ? (
                <>
                  <div className="if-sh-perf">
                    {perfNum}
                    <span className="if-sh-perf-sub">
                      {pnl.kind === "since_called" ? "SINCE CALLED" : "SINCE FIRST MENTION"} · basis{" "}
                      {px(pnl.basis)}
                    </span>
                  </div>
                  {card.mfeMae ? (
                    <div className="if-sh-perf" style={{ marginTop: 6 }}>
                      <span className="if-sh-perf-sub">
                        MFE <span className="if-pos">{pctFmt(card.mfeMae.mfePct)}</span> · MAE{" "}
                        <span className="if-neg">{pctFmt(card.mfeMae.maePct)}</span>
                      </span>
                    </div>
                  ) : null}
                  {pnl.kind === "since_first_mention" ? (
                    <p className="if-sh-note">° no stated trigger — not trade P&L</p>
                  ) : null}
                </>
              ) : (
                <Absent
                  text={
                    pnl && pnl.kind === "none"
                      ? pnl.reason
                      : card.evicted
                        ? "live tracking ended"
                        : "no measurement yet"
                  }
                />
              )}
              {card.quote ? (
                <div className="if-sh-perf" style={{ marginTop: 8 }}>
                  <span className="if-sh-perf-sub">
                    LAST <span className="if-blast" style={{ marginLeft: 0 }}>{px(card.quote.price)}</span> ·{" "}
                    <span className={card.quote.chgPct >= 0 ? "if-pos" : "if-neg"}>
                      {pctFmt(card.quote.chgPct)}
                    </span>{" "}
                    TODAY
                  </span>
                </div>
              ) : null}
              <div className="if-sh-sect-h" style={{ marginTop: 14 }}>
                STATUS HISTORY
              </div>
              {card.statusHistory.length > 0 ? (
                <ul className="if-sh-hist if-detail-hist">
                  {card.statusHistory.map((h, i) => (
                    <li key={i}>
                      <span className="if-sh-hist-top">
                        <span>{LIFE_LABEL[h.state] ?? h.state}</span>
                        {h.price != null && <span>@ {px(h.price)}</span>}
                        <span className="if-sh-hist-at">{fmtDateTime(h.at)}</span>
                      </span>
                      <span className="if-sh-hist-reason">{h.reason}</span>
                    </li>
                  ))}
                </ul>
              ) : card.evicted ? (
                <Absent text="live tracking ended — last known state shown above" />
              ) : (
                <Absent text="no transitions observed yet" />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
