# SPEC — Market Intel MOBILE (phone layout)

Source of truth: `docs/design/Market Intel Mobile.dc.html` (390×844 phone frame).
Desktop counterpart: `docs/design/Market Intel Redesign.dc.html` (1560px) — referenced here ONLY for diffs.

The `.dc.html` file uses a design runtime (`sc-for` / `sc-if` / `{{ }}` bindings, `data-props`, `DCLogic`, `support.js`) that is **not** ported. This spec extracts structure, exact styles, and data shapes. All `{{ }}` values below are resolved to their default-prop output (accent = **Cyan**, illumination = **Cinematic**) and quoted exactly.

---

## 1. Viewport / breakpoint assumptions

| Assumption | Value | Notes |
|---|---|---|
| Authored frame | `width:390px; min-height:844px` (`$preview: 390×844`, iPhone 12–15 class) | Design is a fixed-width mock; implement fluid width. |
| Frame chrome | `background:#07080a; border-left:1px solid rgba(255,255,255,.06); border-right:1px solid rgba(255,255,255,.06); overflow:hidden` | Side borders are mock-frame chrome; drop in the real app (full-bleed). |
| Page `body` | `background:#040506; font-family:'Hanken Grotesk',sans-serif; -webkit-font-smoothing:antialiased` | Desktop body is `#050608` — mobile is one step darker. |
| Repo breakpoint | `<700px` | Repo convention (existing `/intel` hides `.bl-left` under 700px). The design itself declares no media queries — it is a single fixed 390px artboard. |
| Fonts | `IBM Plex Mono` (400/500/600/700 + italic 400), `Hanken Grotesk` (400/500/600/700 + italic 400) via Google Fonts | Same as desktop. |
| Scrollbars | `::-webkit-scrollbar{ display:none; }` and `*{ scrollbar-width:none; }` | ALL scrollbars hidden on mobile. Desktop shows 9px styled scrollbars. |
| Device chrome in mock | iOS status bar (17:05 / signal / 5G / battery) and home indicator bar are **drawn in the design** | Decorative device chrome — do **NOT** ship. Real PWA gets these from the OS. See §12. |

### Keyframes (verbatim)

```css
@keyframes augPulse { 0%,100%{ opacity:1; } 50%{ opacity:.3; } }
@keyframes augTape { from{ transform:translateX(0); } to{ transform:translateX(-50%); } }
```

(Desktop additionally has `augShimmer` for its loading skeleton — the mobile file does not include it.)

---

## 2. Token tables

### 2.1 Semantic palette `P` (identical constants to desktop's idea logic, but note mobile chips use these brighter greens/ambers directly — see §10 diffs)

| Token | Hex | Used for |
|---|---|---|
| `P.bull` | `#6fbf93` | bullish, TRIGGERED, up-tape, LIVE pill |
| `P.bear` | `#cd7e6d` | bearish, BROKEN, down-tape |
| `P.amber` | `#c79a52` | ARMED, WEEKEND tag, "to trig" delta, system alert |
| `P.blue` | `#6aa0c8` | ACTIVE, DIRECT evidence, trigger lines, quotes |
| `P.teal` | `#5fb0ad` | EXTRACTED evidence (== Cyan accent) |
| `P.infv` | `#9a8fb0` | INFERRED evidence, CAND chip |
| `P.lo` | `#646b73` | (defined; unused in mobile markup) |

### 2.2 Accent system (prop `accent`, default `Cyan`)

| Accent | `acc` | rgb triplet |
|---|---|---|
| Ice | `#6aa0c8` | `106,160,200` |
| **Cyan (default)** | `#5fb0ad` | `95,176,173` |
| Mono | `#8a929c` | `138,146,156` |

Derived (Cyan defaults, exact):

| Token | Value |
|---|---|
| `accSoft12` | `rgba(95,176,173,0.12)` (defined; unused in mobile markup) |
| `accSoft25` | `rgba(95,176,173,0.25)` |
| `accSoft40` | `rgba(95,176,173,0.42)` ← note: name says 40, alpha is **0.42** |
| `ambientGrad` | `radial-gradient(120% 80% at 82% -16%, rgba(95,176,173,0.16), transparent 62%)` |

### 2.3 Illumination system (prop `illumination`, default `Cinematic`)

| Mode | ambient | glow |
|---|---|---|
| Flat | off | off |
| Minimal | off | on |
| **Cinematic (default)** | on | on |

- `ambient` on → an absolutely-positioned overlay at frame top: `top:0; left:0; right:0; height:320px; background:{ambientGrad}; pointer-events:none; z-index:0` (desktop's is `height:240px`).
- `glow` on → live-idea status pill gets `box-shadow:0 0 12px -4px rgba(111,191,147,0.7)`.

### 2.4 Text greys (recurring exact values)

| Hex | Role |
|---|---|
| `#f0f2f4` | brightest — clock, H1, ticker, live-badge text |
| `#f4f6f8` | live price on idea card |
| `#e9ebee` | stat-tile numbers, alert tickers |
| `#cdd3d9` | tape symbols, gate tickers |
| `#c4cad0` | alert body text, thesis, plain cells |
| `#b4bac1` | brief paragraph |
| `#aeb4bb` | setup text, system-alert body |
| `#9aa1a9` | section headers (TONIGHT'S BRIEF, ALERTS, ASK AUGUST, CONF %) |
| `#8b929a` | tape prices, OPTIONS INTEL label |
| `#7e858d` | TAPE label, TRIGGER field label |
| `#7a818a` | tf chip, gate descriptions |
| `#6b727a` | inactive segment text |
| `#5f6770` | "~ thesis-driven", chart H/L labels, inactive tab bar, CONF label, carets |
| `#5a616a` | dateline, READ·60s chip, PRICE·5D label, LEVELS label |
| `#565c63` | timestamps, chevron, inactive segment count, Ask placeholder |
| `#4d535a` | "Not stated" italic |
| `#42474e` | disclaimer |
| `#3a4047` | `∅` glyph |

---

## 3. Mobile layout tree (top → bottom, single column)

```
phone frame (390px, #07080a)
├─ ambient gradient overlay (Cinematic only, z-0)
└─ content wrapper (position:relative; z-index:1)
   ├─ STICKY TOP (sticky top:0, z-10)                      ← status bar + app header
   ├─ CONDENSED TAPE (30px marquee)
   ├─ SUMMARY CAROUSEL (horizontal scroll-snap, 3 cards)   ← Brief · Alerts · At-the-Open gates
   ├─ carousel dots (3)
   ├─ STICKY SEGMENTED HORIZON CONTROL (sticky top:92px, z-9)  ALL/TODAY/SWING/LONG
   ├─ IDEA CARDS (vertical accordion list, one expanded at a time)
   ├─ OPTIONS INTEL (collapsed one-line entry strip)
   ├─ ASK AUGUST (fake input affordance)
   ├─ disclaimer paragraph
   ├─ BOTTOM TAB BAR (sticky bottom:0, z-10)  INTEL·MARKETS·SOURCES·ASK
   └─ home-indicator strip (mock device chrome)
```

What stacks / collapses / carousels vs desktop:

- **Carousel**: desktop's left-rail TONIGHT'S BRIEF (+status counts) and AT THE OPEN become swipeable snap cards; a mobile-only ALERTS card is inserted between them.
- **Accordion**: desktop's TRADE BLOTTER table rows become full-width expandable idea cards (tap to expand; desktop's right-rail INSPECTOR content — thesis, price chart, evidence-tagged levels, confidence — is folded *into* the expanded card).
- **Collapsed strip**: OPTIONS INTEL keeps only its summary header row (count chips); the expanded plays/candidates table has **no mobile design**.
- **Tab bar**: desktop BAR 1 workspace tabs become the bottom tab bar.
- No drawer exists in this design; nothing slides in from an edge.

---

## 4. Section specs (exact styles)

### 4.1 Sticky top block

Wrapper: `position:sticky; top:0; z-index:10; background:rgba(7,8,10,0.86); backdrop-filter:blur(14px); border-bottom:1px solid rgba(255,255,255,.06)`.

**Row A — mock iOS status bar** (`padding:10px 22px 3px`, DO NOT SHIP, see §12): clock `IBM Plex Mono 13px/600, letter-spacing:.01em, #f0f2f4` = `17:05`; signal bars 4×(`width:3px`, heights `4/6/8/10px`, `#f0f2f4`, `border-radius:1px`, gap `1.6px`); `5G` mono 10px `#f0f2f4`; battery `23px × 11.5px, border:1px solid rgba(255,255,255,.5), border-radius:3px, padding:1.5px`, fill `#6fbf93 border-radius:1px`, nub `1.5px × 4px rgba(255,255,255,.5)`.

**Row B — app header** (`padding:7px 18px 13px`, `justify-content:space-between`):

- Orb: `30×30px; border-radius:9px; background:radial-gradient(circle at 34% 28%, #5fb0ad, #0c0f14 78%); box-shadow:0 0 16px -3px rgba(95,176,173,0.42), inset 0 1px 0 rgba(255,255,255,.15)`; inner dot `7×7px; border-radius:50%; background:rgba(255,255,255,.92); box-shadow:0 0 6px rgba(255,255,255,.6)`.
- H1 `MARKET INTEL`: `IBM Plex Mono 15px/600; letter-spacing:.14em; color:#f0f2f4; white-space:nowrap`.
- LIVE pill: mono `8px; letter-spacing:.1em; color:#6fbf93; padding:2px 6px; border:1px solid rgba(111,191,147,.32); border-radius:20px; background:rgba(111,191,147,.06)`; dot `4×4px #6fbf93; box-shadow:0 0 5px #6fbf93; animation:augPulse 2s ease-in-out infinite`.
- Dateline: mono `8.5px; letter-spacing:.05em; color:#5a616a; margin-top:3px` — text `SAT JUN 27 · WEEKEND · sync 1821m` with `WEEKEND` in `#c79a52`. **[MOCK]**
- Refresh button: `34×34px; border-radius:11px; background:linear-gradient(180deg,#13171d,#0d1014); border:1px solid rgba(255,255,255,.09); box-shadow:0 2px 8px -3px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.05)`; icon = 16×16 svg circular arrow, `stroke:#5fb0ad; strokeWidth:1.5` + accent arrowhead. (No behavior wired in design.)

### 4.2 Condensed tape (30px)

Container: `display:flex; align-items:stretch; height:30px; border-bottom:1px solid rgba(255,255,255,.06); background:#070809; overflow:hidden`.

- Label cell: `TAPE` — mono `8px; letter-spacing:.12em; color:#7e858d; padding:0 13px; border-right:1px solid rgba(255,255,255,.08); z-index:2; background:#070809`; green dot `4×4px #6fbf93; box-shadow:0 0 6px -1px #6fbf93` (NOT animated, unlike desktop).
- Marquee: content duplicated ×2, `width:max-content; height:30px; animation:augTape 50s linear infinite`. **No hover-pause on mobile** (desktop has `style-hover="animation-play-state:paused"` at 64s).
- Item: `gap:6px; padding:0 13px; IBM Plex Mono 10px; white-space:nowrap` — sym `#cdd3d9/500`, px `#8b929a`, tail `9px` in `ti.col` (`#6fbf93` up / `#cd7e6d` down; watch items use lifecycle color).
- Right edge fade: `position:absolute; right:0; top:0; bottom:0; width:32px; background:linear-gradient(90deg, transparent, #070809); pointer-events:none`.

Tape data shape = 6 macro quotes `{sym, px, tail:'▲+0.34%', col}` **[MOCK]** followed by the 6 tracked ideas `{sym:ticker, px:liveF, tail:lifeShort(TRIG/ARMED/ACTIVE), col:lifeC}`. No divider labels (desktop tape has `INSTRUMENTS`/`WATCHLIST`-style `isDiv` cells; mobile does not).

### 4.3 Summary carousel

Track: `display:flex; gap:11px; overflow-x:auto; scroll-snap-type:x mandatory; padding:15px 16px 4px; -webkit-overflow-scrolling:touch`.

Shared card shell: `flex:0 0 86%; min-width:0; scroll-snap-align:center; border-radius:16px; background:linear-gradient(180deg,#0d1014,#0a0c10); border:1px solid rgba(255,255,255,.07); box-shadow:0 10px 30px -18px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.035)`. Card 1 padding `15px 16px 15px`; cards 2–3 padding `14px 16px`.

Section-header type (all three cards): `IBM Plex Mono 9.5px/500; letter-spacing:.18em; color:#9aa1a9`.

**Card 1 — TONIGHT'S BRIEF**
- Right chip `READ · 60s`: mono `8px; letter-spacing:.08em; color:#5a616a; padding:3px 8px; border:1px solid rgba(255,255,255,.1); border-radius:20px`.
- Paragraph: `Hanken Grotesk 14px; line-height:1.5; color:#b4bac1` — *"Selectively bullish, one bearish setup on watch. Momentum tape — nothing triggers until price confirms."* **[MOCK]**
- Stat tiles (3, `flex:1; padding:9px 11px; border-radius:12px`): value mono `15px #e9ebee` beside `5×5px` dot; label mono `8px; letter-spacing:.08em; margin-top:3px`.

| Tile | bg | border | dot | label color | value/label |
|---|---|---|---|---|---|
| TRIGGERED | `rgba(111,191,147,0.05)` | `1px solid rgba(111,191,147,.2)` | `#6fbf93` | `#7a8a80` | `2 / TRIGGERED` **[MOCK]** |
| ARMED | `rgba(199,154,82,0.05)` | `1px solid rgba(199,154,82,.2)` | `#c79a52` | `#8a8270` | `2 / ARMED` **[MOCK]** |
| ACTIVE | `rgba(106,160,200,0.05)` | `1px solid rgba(106,160,200,.2)` | `#6aa0c8` | `#72808a` | `2 / ACTIVE` **[MOCK]** |

**Card 2 — ALERTS** (mobile-only card; no desktop equivalent)
- Badge `3 NEW`: mono `8px; letter-spacing:.06em; color:#08110b; background:#6fbf93; padding:2px 7px; border-radius:20px`. **[MOCK]**
- Rows: `gap:9px; padding:7px 0`, rows 2+ get `border-top:1px solid rgba(255,255,255,.05)`. Dot `5×5px; margin-top:4px` (rows 1–2 add `box-shadow:0 0 5px <color>`). Body `Hanken 12.5px; line-height:1.35; color:#c4cad0`, ticker inline `IBM Plex Mono .92em #e9ebee`. Meta `mono 8px; letter-spacing:.04em; color:#565c63; margin-top:2px`.
- All 4 rows **[MOCK]** verbatim:
  1. `#6fbf93` dot — **TEM** `triggered — cleared $52.50` / `6h ago · NEXT SESSION`
  2. `#cd7e6d` dot — **AAPL** `broke $293 — breakdown live` / `6h ago · NEXT SESSION`
  3. `#6aa0c8` dot — **WEN** `squeeze building — short-cover watch` / `9h ago · SWING`
  4. `#c79a52` dot — system row, body `#aeb4bb`, ticker style `mono .9em #c79a52` — **YT_API** `key unset — live status limited` / `system · 30h ago` ← this is the design's own **degraded/system-status treatment**: system problems surface as an amber alert row, not a banner.

**Card 3 — AT THE OPEN (gates)**
- Rows `display:flex; align-items:center; gap:8px; padding:8px 0`, rows 2+ `border-top:1px solid rgba(255,255,255,.05)`: ticker mono `11px #cdd3d9; width:42px`; description `Hanken 11.5px #7a818a; flex:1` with price span `IBM Plex Mono #a9c1d4`; status mono `8.5px; letter-spacing:.06em` right-aligned.
- Rows **[MOCK]**: `TEM clears $52.50 → CLEARED` (`#6fbf93`) · `SHOP clears $114.50 → −2.58%` (`#c79a52`) · `AAPL holds $293 → BROKEN` (`#cd7e6d`).

**Carousel dots** (`margin-top:10px; gap:6px`, centered): active = `16×4px; border-radius:2px; background:#5fb0ad`; inactive ×2 = `4×4px; border-radius:50%; background:rgba(255,255,255,.2)`. **Static in the design** (always shows first active) — implementation must bind to scroll position.

### 4.4 Sticky segmented horizon control

Wrapper: `position:sticky; top:92px; z-index:9; padding:14px 16px 11px; background:linear-gradient(180deg, rgba(7,8,10,0.96) 70%, rgba(7,8,10,0))`.
⚠️ `top:92px` equals the mock sticky-header height *including the fake status bar*. Recompute for the real header height (or measure at runtime).

Track: `display:flex; gap:4px; padding:4px; background:#0a0c10; border:1px solid rgba(255,255,255,.07); border-radius:13px`.

Buttons (4): `flex:1; gap:5px; IBM Plex Mono 10px/500; letter-spacing:.05em; border-radius:10px; padding:8px 4px`; trailing count `font-size:8px`.

| State | color | background | border | box-shadow | count color |
|---|---|---|---|---|---|
| active | `#f0f2f4` | `linear-gradient(180deg,#171c23,#11151b)` | `1px solid rgba(255,255,255,0.09)` | `0 2px 8px -3px rgba(0,0,0,0.7)` | `#5fb0ad` (acc) |
| inactive | `#6b727a` | `transparent` | `1px solid transparent` | `none` | `#565c63` |

Segments & filter mapping: `ALL→null`, `TODAY→'NEXT SESSION'`, `SWING→'SWING'`, `LONG→'LONG TERM'`; count = ideas matching tf. Default selected: **TODAY** (`state.horizon='today'`).

### 4.5 Idea cards (accordion)

List: `padding:4px 16px 6px; display:flex; flex-direction:column; gap:11px`.

Card shell: `position:relative; border:1px solid <cardBorder>; border-radius:16px; background:linear-gradient(180deg,#0c0f13,#0a0c0f); overflow:hidden; transition:border-color .2s ease, box-shadow .2s ease, transform .12s ease`; pressed state (`style-active`): `transform:scale(0.99)`.

| State | cardBorder | cardShadow |
|---|---|---|
| expanded | `rgba(95,176,173,0.25)` (accSoft25) | `0 14px 36px -16px rgba(95,176,173,0.42), inset 0 1px 0 rgba(255,255,255,.04)` |
| collapsed | `rgba(255,255,255,.08)` | `0 8px 22px -16px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.03)` |

- Left lifecycle rail: `position:absolute; left:0; top:0; bottom:0; width:3px; background:<lifeC>`.
- Live (TRIGGERED) wash overlay: `position:absolute; inset:0; background:linear-gradient(120deg, rgba(116,176,138,0.05), transparent 55%); pointer-events:none`.

Lifecycle map: `TRIGGERED → #6fbf93, short TRIG, live:true` · `ARMED → #c79a52, ARMED` · `ACTIVE → #6aa0c8, ACTIVE`. Direction: `BULL → ▲ #6fbf93` · `BEAR → ▼ #cd7e6d`.

**Collapsed header** (`padding:14px 15px 13px 17px`, whole card is the tap target):

Row 1: status pill mono `8.5px/600; letter-spacing:.06em; color:<lifeC>; padding:3px 8px; border:1px solid <lifeC @ 0.5 alpha>; border-radius:20px; background:` `rgba(111,191,147,0.12)` if live else `transparent`; glow (Cinematic/Minimal): `box-shadow:0 0 12px -4px rgba(111,191,147,0.7)`; inner dot `4×4px <lifeC>`. Ticker mono `19px/600; letter-spacing:.01em; #f0f2f4`. Direction `mono 10px <dirC>` with glyph at `8px`. Right: live price mono `18px/500; #f4f6f8; letter-spacing:.01em`; under it mono `10.5px; margin-top:2px` → either delta `<delta.val> <shortLabel>` (shortLabel `9px; opacity:.7`) or `~ thesis-driven` in `#5f6770`.

Delta logic (derived from mock trig/live): favored side → green `#6fbf93`, `(+x.xx)% past`; not yet → amber `#c79a52`, `+x.xx% to trig`. `railc` (spark/chart color) = `#6fbf93` favored / `#c79a52` not; no-levels ideas use dir color.

Row 2 (`margin-top:11px`): setup mono `10px #aeb4bb`; tf chip mono `8.5px; letter-spacing:.04em; color:#7a818a; padding:2px 7px; border:1px solid rgba(255,255,255,.1); border-radius:20px`. Right: sparkline svg `viewBox="0 0 52 22"`, rendered `width:112px; height:30px; overflow:visible` — area fill = line color @ `0.13` alpha, line `strokeWidth:1.4` (`vectorEffect:non-scaling-stroke`), end dot `r:1.9`. Chevron mono `12px #565c63`: `▸` collapsed / `▾` expanded.

**Expanded body** (`padding:0 17px 16px; border-top:1px solid rgba(255,255,255,.055)`):

1. Thesis: `Hanken 13.5px; line-height:1.52; color:#c4cad0; margin:13px 0 0`.
2. Chart header (`margin:14px 0 0`): left `PRICE · 5D · illustrative` mono `8px; letter-spacing:.12em; #5a616a` (the design labels its own chart data illustrative — keep the honesty label only if the shipped series is real 5-day data, otherwise the series must be replaced); right (levels only) `Δ→TRIG +x.xx%` mono `9px <delta.c>`.
3. Chart panel: `margin-top:8px; border:1px solid rgba(255,255,255,.06); border-radius:11px; background:#090b0e; overflow:hidden`; svg `viewBox="0 0 352 92"; width:100%; height:92px`:
   - 3 gridlines at y `23/46/69`: `stroke:rgba(255,255,255,0.03); strokeWidth:1`
   - area fill = line color @ `0.11` alpha
   - trigger line (levels only): `stroke:rgba(106,160,200,0.5); strokeWidth:1; strokeDasharray:3 3`
   - price line `strokeWidth:1.6`; live point = outer ring `r:6; strokeWidth:1; opacity:0.3` + dot `r:3.2`
   - overlays: `H $xx.xx` top-left / `L $xx.xx` bottom-left mono `7px #5f6770; background:rgba(9,11,14,0.7); padding:0 2px`; trigger tag centered `❝ TRIG $xx.xx` mono `7.5px #8aa6c4; background:rgba(9,11,14,0.85); padding:0 3px`; live badge right `◉ $xx.xx` mono `8.5px #f0f2f4; background:rgba(9,11,14,0.92); padding:1px 5px; border:1px solid rgba(255,255,255,.12); border-radius:5px` with `◉` in `#74b08a` at `7px`.
4. `LEVELS · TAGGED BY EVIDENCE` mono `7.5px; letter-spacing:.12em; #5a616a; margin:15px 0 0`.
5. Fields grid: `grid-template-columns:1fr 1fr; gap:12px 12px; margin-top:10px`. Field label mono `8px/500; letter-spacing:.1em` in per-field color: ENTRY `#5f86a3` · TRIGGER `#7e858d` · INVALIDATION `#9c6457` · TARGET `#5f8a72` · CATALYST `#5f86a3`. Evidence chip beside label: mono `7px/600; letter-spacing:.06em; padding:1px 5px; border-radius:20px; border:1px <solid|dashed> <c>`:

   | Chip | color | glyph | border | bg |
   |---|---|---|---|---|
   | DIRECT | `#6aa0c8` | `▮` | solid | `rgba(106,160,200,0.14)` |
   | EXTRACTED | `#5fb0ad` | `◇` | solid | `transparent` |
   | INFERRED | `#9a8fb0` | `~` | dashed | `transparent` |

   Cell variants (verbatim treatments):
   - **absent**: `Hanken italic 12px #4d535a` → `∅ Not stated` (`∅` non-italic `#3a4047`) — this is the design's designed *empty-field* state.
   - **quoted** (glyphed): mono `12.5px`; glyph `❝` at `10px #6aa0c8`; value `#bcd3e6; text-decoration:underline dotted; text-underline-offset:2px`.
   - **plain**: `Hanken 12.5px; line-height:1.4; color:#c4cad0` (inferred invalidation text uses `#b3a9c4`).
6. Footer (`margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,.055)`): `CONF` mono `8px; letter-spacing:.1em; #5f6770`; bar `60×4px; background:rgba(255,255,255,.08); border-radius:3px` with fill `width:{conf}%; background:linear-gradient(90deg, rgba(95,176,173,0.42), #5fb0ad)`; value mono `10.5px #9aa1a9` `70%`; right source link mono `9px #5fb0ad` `▸ StockedUp @ 10:35` **[MOCK]** (no destination wired).

### 4.6 OPTIONS INTEL (collapsed strip)

`margin:5px 16px 0; padding:12px 15px; border:1px solid rgba(255,255,255,.07); border-radius:14px; background:#0a0c0f; display:flex; align-items:center; gap:9px`:
caret `▸ 11px #5f6770`; label mono `9.5px/500; letter-spacing:.12em; #8b929a`; right chips: `1 PLAY` mono `8px #5f86a3; padding:3px 7px; border:1px solid rgba(106,160,200,.25); border-radius:20px` and `3 CAND` mono `8px #9a8fb0; border:1px dashed rgba(154,143,176,.35); border-radius:20px`. **[MOCK counts]**
No `onClick` and no expanded state exist in the mobile design — implementation must invent the open behavior (sheet/accordion) or leave it as a teaser.

### 4.7 ASK AUGUST

`margin:16px 16px 0`. Label mono `9.5px/500; letter-spacing:.16em; #9aa1a9; margin-bottom:10px`.
Input row (non-functional visual): `border:1px solid rgba(95,176,173,0.25); border-radius:14px; background:linear-gradient(180deg,#0c0f13,#0a0c0f); padding:13px 14px; box-shadow:inset 0 1px 0 rgba(255,255,255,.03)`; prompt `›` mono `15px #5fb0ad`; placeholder mono `12px #565c63` = `which ideas have no invalidation?` **[MOCK placeholder]**; block cursor `7×15px; background:#5fb0ad; opacity:.7; animation:augPulse 1.2s steps(2) infinite`.

### 4.8 Disclaimer

`padding:15px 20px 18px`; text mono `8px; line-height:1.6; letter-spacing:.03em; color:#42474e; text-align:center` — verbatim: *"Decision-support over creator commentary. Never trades; never invents prices, levels or tickers. Not financial advice."*

### 4.9 Bottom tab bar + home indicator

Bar: `position:sticky; bottom:0; z-index:10; display:flex; align-items:stretch; padding:8px 14px 6px; background:rgba(7,8,10,0.9); backdrop-filter:blur(16px); border-top:1px solid rgba(255,255,255,.07)`.
Items (4, each `flex:1; flex-direction:column; align-items:center; gap:5px; padding:5px 0`): 22×22 svg icon + mono label `8px; letter-spacing:.06em`. Active (INTEL) icon fill + label = `#5fb0ad` (acc); inactive = `#5f6770`. Tabs: `INTEL` (list icon) · `MARKETS` (line-chart icon) · `SOURCES` (video icon) · `ASK` (4-point star icon). No navigation wired.
Home indicator (mock chrome, don't ship): centered `128×4px; border-radius:3px; background:rgba(255,255,255,.22)` in a strip `padding:5px 0 9px; background:#07080a`.

---

## 5. States & interaction model (as designed)

| State | Default | Behavior |
|---|---|---|
| `expandedIdx` | `0` (first idea open) | Tap a card toggles it; opening one collapses the other (single-expand accordion); tapping the open card closes it (`-1` = all closed is valid). |
| `horizon` | `'today'` | Segmented control filters the idea list by timeframe; counts always computed over all ideas. |
| Card press | — | `:active → transform:scale(0.99)` with `transform .12s ease`. |
| Carousel | free scroll | `scroll-snap-type:x mandatory`, cards snap to center. Dots are static (must be wired). |
| Tape | always animating | 50s loop, content duplicated 2×, no pause affordance. |

**Not designed on mobile (gaps implementation must fill or omit):** loading skeletons, sync-in-progress, board error, empty idea list (e.g. a horizon with 0 ideas shows nothing — no designed empty message), inspector states, pull-to-refresh feedback, options-intel expansion, tab navigation targets.

---

## 6. Designed empty/loading/error treatments (verbatim)

Present **in the mobile file**:

| Treatment | Verbatim | Where |
|---|---|---|
| Absent level field | `∅ Not stated` (italic grey, `∅` in `#3a4047`) | expanded idea fields |
| Idea without levels | `~ thesis-driven` (`#5f6770`) | collapsed card, right column |
| Degraded system status | `YT_API key unset — live status limited` / `system · 30h ago` (amber `#c79a52` row) | ALERTS card |
| Honesty label on seeded chart | `PRICE · 5D · illustrative` | expanded chart header |

Desktop-only treatments (available for adaptation, **not present in the mobile design**): `LOADING MAP…`, `MAP OFFLINE`, `SYNCING SOURCES · EXTRACTING IDEAS…` + shimmer skeleton, `ANALYSIS FAILED`, `AWAITING ANALYSIS`, `NOTHING SELECTED`, `INSPECTOR UNAVAILABLE`, blotter absent-cell shorthand `∅ n/s`. The map/inspector ones have no mobile home (those sections don't exist on phone); if mobile needs loading/error states, restyle the desktop SYNCING line + shimmer into the card idiom — that is an implementation decision, not in the locked design.

---

## 7. Touch affordances & sizes

| Control | Designed size | 44px rule |
|---|---|---|
| Idea card header | full width × ~64px | OK — entire card is the target |
| Bottom tab items | ~90px × ~47px each | OK |
| Refresh button | `34×34px` | **Below 44** — keep visual 34px but extend hit area to ≥44px |
| Segmented buttons | full quarter-width × ~29px (8px v-padding) | **Below 44 in height** — extend tappable area |
| Carousel cards | 86% width (~335px) swipe targets | OK |
| Options-intel strip | full width × ~42px | borderline; pad hit area |
| Ask August row | full width × ~46px | OK |
| Source link `▸ StockedUp @ 10:35` | text-size 9px | **tiny** — needs padded hit area if it becomes a link |

Repo convention (existing `/intel` work): 44px minimum mobile touch targets — apply it via transparent padding/pseudo-elements without changing the drawn sizes.

Mobile-only touch details in the code: `-webkit-overflow-scrolling:touch` on the carousel; `scroll-snap-align:center`; `:active` scale on cards; all scrollbars hidden.

---

## 8. Desktop sections OMITTED on phone

- BAR 1: AUGUST wordmark, workspace tabs, function-key hints (F-keys) — replaced by bottom tab bar.
- BAR 3: operational status strip (`FEED / QUOTES / …` + `REC` pulse).
- Entire MARKET OVERVIEW band: MARKET SENTIMENT gauge (F&G value), SECTOR HEAT MAP (+sort toggle, −/+ legend), OPTIONS HEAT MAP (`C/P SKEW · illustrative`), MAP THE STOCKS (US map, 4 points, `LOADING MAP…`/`MAP OFFLINE`, `2 non-US · BABA CN · SHOP CA`), CATALYSTS chip line.
- Left rail: SOURCE MONITOR, VIDEO LIBRARY, ADD SOURCES (`Paste URL · @handle · video`, `Add ⌃⏎`).
- TRADE BLOTTER: column-header table, evidence legend strip, group headers, PREVIEW STATE switcher, loading skeleton, error/empty boards.
- TOP STOCKS TODAY / TOP OPTIONS TODAY panels.
- INSPECTOR right rail (its content is folded into the expanded idea card instead; the dense stat strip, posture chips and transcript-quote block from the desktop inspector have **no mobile representation**).
- OPTIONS INTEL expanded table (creator plays / AUGUST candidates rows + `∅ not sized` note).
- ASK AUGUST full command line (reduced to a fake input above the tab bar).

## 9. Desktop sections FOLDED on phone

| Desktop | Mobile fold |
|---|---|
| Left-rail TONIGHT'S BRIEF + BAR-2 count chips | Carousel card 1 (brief text + 3 stat tiles) |
| Left-rail AT THE OPEN rows | Carousel card 3 |
| (no desktop equivalent) | Carousel card 2 ALERTS — **mobile-only surface** |
| Blotter row + Inspector detail | Idea card (collapsed row) + expanded accordion body |
| BAR 4 LIVE TAPE (with divider labels, hover pause) | 30px TAPE (merged quotes+watchlist, no dividers, no pause) |
| OPTIONS INTEL collapsible section | one-line collapsed strip only |
| BAR-1 workspace tabs | bottom tab bar INTEL/MARKETS/SOURCES/ASK |
| ASK AUGUST command bar | static input affordance |

## 10. Style deltas vs desktop (same element, different values)

| Element | Desktop | Mobile |
|---|---|---|
| body bg | `#050608` | `#040506` |
| frame bg / border | `#08090b` / `rgba(255,255,255,.08)` | `#07080a` / `rgba(255,255,255,.06)` L/R only |
| ambient overlay height | `240px` | `320px` |
| corner radius language | `2px`–`3px` (terminal) | `16px` cards, `20px` pills, `10–14px` controls (soft/handheld) |
| H1 letter-spacing / color | `.2em` / `#e9ebee` | `.14em` / `#f0f2f4` |
| LIVE chip | `9px`, `#6fa085`, `border-radius:2px`, border `rgba(111,160,133,.32)` | `8px`, `#6fbf93`, `border-radius:20px`, border `rgba(111,191,147,.32)`, bg `rgba(111,191,147,.06)` |
| status-count greens/ambers | `#6fa085` / `#bfa05a` | `#6fbf93` / `#c79a52` (brighter set used throughout) |
| tape | 64s, hover-pause, label `LIVE TAPE 8.5px ls .14em` bg `#0b0e12`, animated dot `#74b08a`, item `10.5px` with `border-right:rgba(255,255,255,.045)`, divider labels | 50s, no pause, label `TAPE 8px ls .12em` bg `#070809`, static dot `#6fbf93`, item `10px` no border, no dividers, +32px right fade |
| sparkline | `52×20px`, stroke `1.2`, dot `r:1.6`, line only | `112×30px` (viewBox `52×22`), stroke `1.4`, dot `r:1.9`, + area fill @ `0.13` |
| status pill | `border-radius:2px; border:1px solid <lifeC>` (full alpha), font `8.5px ls .04em`, `padding:2px 6px` | `border-radius:20px; border:1px solid <lifeC @ .5>`, font `8.5px ls .06em`, `padding:3px 8px` |
| evidence chip | `border-radius:2px`, gap 4px | `border-radius:20px`, gap 3px (same colors/glyphs) |
| conf bar | `30×3px`, flat `acc` fill | `60×4px`, gradient `accSoft40→acc` fill |
| absent cell | `∅ n/s` (`10px`) | `∅ Not stated` (`12px`) |
| brief paragraph | `12px #aeb4bb` | `14px #b4bac1` |
| AT THE OPEN rows | grid `38px 1fr auto`, fonts `10/10.5/8px`, `padding:5px 0` | flex with `width:42px`, fonts `11/11.5/8.5px`, `padding:8px 0` |
| ticker size in row | `12px` | `19px` |
| live price | `11px` with pulsing `◉` prefix | `18px` plain (pulse `◉` only inside expanded chart badge) |
| scrollbars | 9px, thumb `rgba(255,255,255,.08)` | hidden entirely |
| detail chart | inspector `viewBox 0 0 352 148` (per desktop inspector) | in-card `viewBox 0 0 352 92`, `height:92px` |

---

## 11. Data shapes (for wiring to real feeds)

```ts
// per idea (raw mock shape in the design script)
{ t:string, dir:'BULL'|'BEAR', tf:'NEXT SESSION'|'SWING'|'LONG TERM',
  life:'TRIGGERED'|'ARMED'|'ACTIVE', setup:string, thesis:string,
  entry:string|null, trig:number|null,
  invalKind:'inferred'|'narrative'|'absent', invalText:string|null,
  catalyst:string, live:number, conf:number, src:string, time:string }
```

Derived per card: `hasLevels = trig != null`; delta favored/needed as §4.5; fields grid rows fixed order ENTRY, TRIGGER, INVALIDATION, TARGET, CATALYST; evidence mapping in mock: entry→DIRECT, trigger→DIRECT (quoted), invalidation inferred→INFERRED / narrative→DIRECT, target→always absent, catalyst→DIRECT.
Money format: `'$' + toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2})`.
Tape item: `{ sym, px:string(preformatted), tail:string, col }`.

---

## 12. MOCK DATA INVENTORY — must NOT ship as live

**Device chrome (delete, don't port):**
- iOS status bar: `17:05`, signal bars, `5G`, battery graphic.
- Home-indicator bar at the bottom.

**Hardcoded content:**
- Dateline `SAT JUN 27 · WEEKEND · sync 1821m` (all three parts must be computed).
- Brief paragraph text and `READ · 60s` estimate.
- Stat-tile counts `2 TRIGGERED / 2 ARMED / 2 ACTIVE`.
- `3 NEW` alerts badge and all 4 alert rows (TEM/AAPL/WEN texts, `6h ago`, `9h ago`, `30h ago`, and the `YT_API key unset` system row).
- All 3 AT THE OPEN gate rows (TEM $52.50 CLEARED, SHOP $114.50 −2.58%, AAPL $293 BROKEN).
- Segment counts (derived from the 6 mock ideas).
- All 6 ideas: TEM, AAPL, SHOP, WEN, UBER, BABA — every ticker, thesis, entry/trigger/invalidation/catalyst string, live price (54.87 / 275.15 / 111.62 / 7.33 / 72.25 / 95.07), confidence (70/70/70/65/60/70), source `StockedUp` and times (`10:35`, `7:41`, `9:28`, `11:11`).
- TARGET field: always `∅ Not stated` in the mock — real data may have targets.
- Tape macro quotes: `SPX 5,477.90 +0.34% · NDX 19,890 +0.62% · VIX 12.84 −3.10% · BTC 61,240 +1.42% · US10Y 4.252% +1.8bp · GOLD 2,331 −0.30%`.
- Sparkline + detail chart series: **procedurally seeded fakes** (FNV-1a hash of ticker → mulberry32 PRNG, 46 points, ±5% amplitude around live). The design labels them `PRICE · 5D · illustrative`. Replace with real intraday/5d series; drop or keep the label per data honesty.
- Chart `H` / `L` overlay values (max/min of the fake series).
- Δ→TRIG percentages (derived from mock live/trig).
- OPTIONS INTEL chips `1 PLAY` / `3 CAND`.
- ASK AUGUST placeholder `which ideas have no invalidation?` and the fake blinking cursor (real input replaces both).
- Carousel dots: hardcoded first-active; must bind to scroll.
- LIVE pill: always-on in the mock; must reflect real feed state.
- `▸ StockedUp @ 10:35` source footer link (no target wired).
- Battery-fill green, `5G`, clock — chrome, see above.

**Mock interactions (visual only, must be built):** refresh button (no handler), tab bar (no navigation), options-intel strip (no expansion), Ask August (not an input), carousel dots (not synced), alerts rows (not tappable).
