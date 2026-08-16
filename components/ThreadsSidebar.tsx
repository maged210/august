"use client";

// The chat view's LEFT threads sidebar (UX2-T1) — the Claude-style IA:
// + NEW CHAT on top, then the saved conversations (title · age), the active
// one highlighted. One component, one data path: GET /api/threads (the same
// store the landing's RECENT THREADS used), 60s poll with the house
// document.hidden guard, refreshed shortly after an exchange completes.
//
// Desktop (≥1100px): a fixed left sidebar, collapsible to a thin vertical
// "THREADS" edge tab (persisted — the page owns the state, layout.tsx applies
// it pre-paint via data-threads). Below 1100px it is a slide-over drawer.
// Chat view only — the page unmounts it on the terminal.

import { useCallback, useEffect, useRef, useState } from "react";
import { relativeTime } from "@/lib/ideas";

type ThreadRow = { id: string; title: string; updatedAt: number; label?: string };

type Props = {
  /** drawer state — meaningful below 1100px */
  open: boolean;
  onClose: () => void;
  /** desktop collapse (folds to the THREADS edge tab) */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** the conversation currently on screen (null = home / unsaved) */
  activeThreadId: string | null;
  onOpenThread: (id: string) => void;
  onNewChat: () => void;
  /** bumps when an exchange completes — schedules a refresh */
  refreshKey: number;
};

export default function ThreadsSidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapsed,
  activeThreadId,
  onOpenThread,
  onNewChat,
  refreshKey,
}: Props) {
  const [threads, setThreads] = useState<ThreadRow[] | null>(null); // null = loading
  // re-render the age labels without refetching
  const [, setTick] = useState(0);
  const swipeX = useRef<number | null>(null);
  // B3 — pending deletes: id → undo deadline; the DELETE fires when it lapses
  const [pendingDel, setPendingDel] = useState<Record<string, number>>({});
  const delTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const beginDelete = (id: string) => {
    setPendingDel((p) => ({ ...p, [id]: Date.now() + 6000 }));
    const timer = setTimeout(() => {
      delTimers.current.delete(id);
      void fetch(`/api/threads/${encodeURIComponent(id)}`, { method: "DELETE" })
        .catch(() => {})
        .finally(() => {
          setPendingDel((p) => { const { [id]: _, ...rest } = p; return rest; });
          setThreads((t) => (t ? t.filter((r) => r.id !== id) : t));
        });
      // deleting the ACTIVE conversation returns home (B3)
      if (id === activeThreadId) onNewChat();
    }, 6000);
    delTimers.current.set(id, timer);
  };
  const undoDelete = (id: string) => {
    const timer = delTimers.current.get(id);
    if (timer) clearTimeout(timer);
    delTimers.current.delete(id);
    setPendingDel((p) => { const { [id]: _, ...rest } = p; return rest; });
  };
  // R1 A2 — pending deletes die with the component: navigating away must not
  // fire a DELETE the user can no longer undo
  useEffect(() => {
    const timers = delTimers.current;
    return () => { for (const t of timers.values()) clearTimeout(t); timers.clear(); };
  }, []);

  const pull = useCallback(() => {
    fetch("/api/threads?limit=30", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { threads?: ThreadRow[] }) => {
        const rows = Array.isArray(j.threads)
          ? j.threads.filter((t) => t && typeof t.id === "string" && typeof t.title === "string")
          : [];
        setThreads(rows);
      })
      .catch(() => setThreads((prev) => prev ?? []));
  }, []);

  useEffect(() => {
    pull();
    const id = window.setInterval(() => {
      if (!document.hidden) pull();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [pull]);

  // a completed exchange persists fire-and-forget — refresh shortly after
  useEffect(() => {
    if (refreshKey === 0) return;
    const id = window.setTimeout(pull, 1500);
    return () => window.clearTimeout(id);
  }, [refreshKey, pull]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const rows = threads ?? [];

  return (
    <>
      {open ? <div className="ts-scrim" onClick={onClose} aria-hidden /> : null}
      {/* collapsed desktop sidebar → the way back in */}
      {collapsed ? (
        <button
          type="button"
          className="ts-tab"
          onClick={onToggleCollapsed}
          aria-label="Open the threads sidebar"
        >
          THREADS
        </button>
      ) : null}
      <aside
        className={`threads-sb${open ? " open" : ""}`}
        aria-label="Conversations"
        // M3 — swipe the left-hand sheet leftwards to dismiss (phone/tablet)
        onTouchStart={(e) => {
          swipeX.current = e.touches[0].clientX;
        }}
        onTouchEnd={(e) => {
          if (swipeX.current != null && swipeX.current - e.changedTouches[0].clientX > 70) {
            onClose();
          }
          swipeX.current = null;
        }}
      >
        <div className="ts-head">
          <button
            type="button"
            className="ts-new"
            onClick={() => {
              onNewChat();
              onClose();
            }}
          >
            <span aria-hidden="true">+</span> NEW CHAT
          </button>
          <button
            type="button"
            className="ts-collapse"
            onClick={onToggleCollapsed}
            aria-label="Collapse the threads sidebar"
            title="Collapse"
          >
            «
          </button>
          <button type="button" className="ts-close" onClick={onClose} aria-label="Close threads">
            ✕
          </button>
        </div>
        <div className="ts-label">THREADS</div>
        <div className="ts-body">
          {threads === null ? (
            <div className="ts-empty">loading…</div>
          ) : rows.length === 0 ? (
            <div className="ts-empty">
              no saved threads yet
              <span className="ts-empty-sub">conversations land here</span>
            </div>
          ) : (
            rows.map((t) =>
              pendingDel[t.id] ? (
                <div key={t.id} className="ts-thread ts-pending" role="status">
                  <span className="ts-title">deleted</span>
                  <button type="button" className="ts-undo" onClick={() => undoDelete(t.id)}>
                    UNDO
                  </button>
                </div>
              ) : (
                <div key={t.id} className={`ts-row${t.id === activeThreadId ? " on" : ""}`}>
                  <button
                    type="button"
                    className={`ts-thread${t.id === activeThreadId ? " on" : ""}`}
                    aria-current={t.id === activeThreadId ? "true" : undefined}
                    onClick={() => {
                      onOpenThread(t.id);
                      onClose();
                    }}
                  >
                    <span className="ts-title">{t.title}</span>
                    <span className="ts-age">
                      {t.label ?? (Number.isFinite(t.updatedAt) ? relativeTime(t.updatedAt) : "")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ts-del"
                    aria-label={`Delete thread: ${t.title}`}
                    title="Delete (6s undo)"
                    onClick={() => beginDelete(t.id)}
                  >
                    ⋯
                  </button>
                </div>
              ),
            )
          )}
        </div>
      </aside>
    </>
  );
}
