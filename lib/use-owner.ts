"use client";

// PUBLIC-LANGUAGE P3 — one shared answer to "is this the owner's session?".
// Visitors resolve false without ever hitting /api/intel/role (no session →
// no second fetch). The flag only widens what renders; nothing public keys
// security off it — the server routes stay the authority.

import { useEffect, useState } from "react";

export function useOwner(): boolean {
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { user?: { email?: string } } | null) => {
        if (cancelled || !j?.user?.email) return;
        return fetch("/api/intel/role", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((ro: { owner?: boolean } | null) => {
            if (!cancelled && ro?.owner) setOwner(true);
          });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return owner;
}
