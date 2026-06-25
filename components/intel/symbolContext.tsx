"use client";

// One shared selected-symbol for the whole Intel workspace. The chart, the Creator
// Levels rail, the options chain, and the candidate panel all read/write THIS — there
// is no competing per-component symbol state. Setting the symbol anywhere moves
// everything together.

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type SymbolCtx = {
  symbol: string;
  setSymbol: (s: string) => void;
};

const Ctx = createContext<SymbolCtx | null>(null);

const clean = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9.\-^]/g, "").slice(0, 12);

export function SymbolProvider({ initial, children }: { initial?: string; children: React.ReactNode }) {
  const [symbol, setSym] = useState<string>(clean(initial || "SPY") || "SPY");
  const setSymbol = useCallback((s: string) => {
    const c = clean(s);
    if (c) setSym(c);
  }, []);
  const value = useMemo(() => ({ symbol, setSymbol }), [symbol, setSymbol]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSymbol(): SymbolCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSymbol must be used within a SymbolProvider");
  return c;
}
