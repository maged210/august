# Market Intel Redesign — DESKTOP Implementation Spec

**Source of truth:** `docs/design/Market Intel Redesign.dc.html` (1,083 lines, read in full).
**Scope:** structure, exact styles, and data shapes only. The design runtime (`sc-for` / `sc-if` / `{{ }}` bindings, `data-props`, `DCLogic`, `support.js`, `style-hover` attributes) is NOT ported — re-implement in React/Next.
**Canvas:** fixed frame `width:1560px; margin:0 auto`, preview `1560 × 1040`. Page body background `#050608`.

---

## 1. TOKENS

### 1.1 Design-prop knobs (declared defaults)

Declared in `data-props` (these are the LOCKED defaults; note the JS `renderVals()` fallbacks differ — `?? 'Minimal'`, `?? 'Ice'` — but the `data-props` defaults win and are authoritative):

| Knob | Options | **Default** | What it affects |
|---|---|---|---|
| `density` | `Comfortable` / `Standard` / `Blotter` | **`Standard`** | Blotter row vertical padding + left-rail section padding only. `dmap = { Comfortable:{padY:12, sec:15}, Standard:{padY:8, sec:12}, Blotter:{padY:5, sec:10} }` → `rowPad = padY+'px 16px'` (idea rows), `secPad = sec+'px 16px'` (left-rail `<section>`s). At Standard: `rowPad = "8px 16px"`, `secPad = "12px 16px"`. |
| `illumination` | `Flat` / `Minimal` / `Cinematic` | **`Cinematic`** | `imap = { Flat:{ambient:false, top:false, glow:false, strong:false}, Minimal:{ambient:false, top:true, glow:true, strong:false}, Cinematic:{ambient:true, top:true, glow:true, strong:true} }`. `ambient` gates the ambient gradient layer; `top` gates the header glow line; `glow` gates live-row wash + status-chip glow; `strong` picks the stronger ambient alpha, stronger status glow, and the two-part selection ring. |
| `accent` | `Ice` / `Cyan` / `Mono` | **`Cyan`** | `amap = { Ice:{acc:'#6aa0c8', rgb:'106,160,200'}, Cyan:{acc:'#5fb0ad', rgb:'95,176,173'}, Mono:{acc:'#8a929c', rgb:'138,146,156'} }` |
| `fearGreed` | int 0–100 | **`46`** (MOCK) | Drives gauge needle + F&G number/regime. Clamped: `Math.max(0, Math.min(100, Math.round(v)))`. |

### 1.2 Accent + derived ramp (at the locked default, Cyan)

Formulas (string-built in JS from `rgb`):

| Token | Formula | **Value at Cyan** (`rgb = 95,176,173`) |
|---|---|---|
| `acc` | `amap[accent].acc` | `#5fb0ad` |
| `accSoft06` | `rgba(rgb, 0.06)` | `rgba(95,176,173,0.06)` |
| `accSoft12` | `rgba(rgb, 0.12)` | `rgba(95,176,173,0.12)` |
| `accSoft25` | `rgba(rgb, 0.25)` | `rgba(95,176,173,0.25)` |
| `accSoft40` | `rgba(rgb, 0.42)` — **NOTE: named 40 but alpha is 0.42** | `rgba(95,176,173,0.42)` |

### 1.3 Illumination layers (gated by illumination=Cinematic, the locked default)

| Layer | Gate | Exact CSS |
|---|---|---|
| Ambient gradient | `im.ambient` (Cinematic only) | `position:absolute; top:0; left:0; right:0; height:240px; pointer-events:none; z-index:0;` with `background: radial-gradient(120% 100% at 80% -30%, rgba(95,176,173,0.16), transparent 60%)` — alpha is `0.16` when `strong` (Cinematic), `0.10` otherwise |
| Top glow line | `im.top` (Minimal + Cinematic) | inside Bar 2: `position:absolute; left:0; right:0; top:0; height:1px; background: linear-gradient(90deg, transparent, rgba(95,176,173,0.55), transparent)` |
| Selection ring | always on selected row; form depends on `strong` | Cinematic: `box-shadow: inset 0 0 0 1px rgba(95,176,173,0.55), 0 0 22px -8px rgba(95,176,173,0.6)`; non-strong: `inset 0 0 0 1px rgba(95,176,173,0.4)`. Applied as an absolutely-positioned overlay `position:absolute; inset:0; pointer-events:none;` |
| Live-row wash | `lf.live && im.glow` | overlay `background: rgba(116,176,138,0.045)` on TRIGGERED rows |
| Status-chip glow | `lf.live && im.glow` | `box-shadow: 0 0 16px -3px rgba(116,176,138,0.85)` when strong (Cinematic); `0 0 12px -4px rgba(116,176,138,0.7)` at Minimal; `none` otherwise |

### 1.4 P palette (semantic colors)

```js
const P = { bull:'#6fa085', bear:'#cd7e6d', amber:'#bfa05a', blue:'#6aa0c8',
            teal:'#5fb0ad', infv:'#9a8fb0', lo:'#646b73', live:'#74b08a' };
```

| Token | Hex | Used for |
|---|---|---|
| `P.bull` | `#6fa085` | bullish direction, TRIGGERED status, positive, LIVE data dot, gauge GREED segment |
| `P.bear` | `#cd7e6d` | bearish direction, INVALIDATED, errors (△ ANALYSIS FAILED), REC dot |
| `P.amber` | `#bfa05a` | ARMED status, NEUTRAL dir, TO-TRIGGER delta, SESSION WEEKEND, KEY UNSET |
| `P.blue` | `#6aa0c8` | ACTIVE status, DIRECT evidence, quoted glyphs, TAKE-PROFIT, Ice accent |
| `P.teal` | `#5fb0ad` | EXTRACTED evidence (equals the Cyan accent hex) |
| `P.infv` | `#9a8fb0` | INFERRED evidence, `~` glyphs, CANDIDATES chip |
| `P.lo` | `#646b73` | EXPIRED status, low-emphasis labels |
| `P.live` | `#74b08a` | live-price `◉` dot, live tape dot, TODAY group tick, EXTREME GREED, live row/chip glow rgb `116,176,138` |

Additional literal colors used only in specific spots: map-point negative `#c58575` (NOT `P.bear`); gauge segments `#b06a58 / #c68a5e / #ad9158 / #6fa085 / #74b08a`; F&G FEAR band `#c68a5e`; sector/options heat text `#c3e4d1 / #93c1a6 / #ecbcb0 / #d3a396`; heat rgb bases `111,158,131` (pos) and `197,133,117` (neg); sector legend gradient `linear-gradient(90deg,#b06a58,#4a4f55 50%,#5a9e79)`; option-ticket purple `#c9a3d6` and border `rgba(154,143,176,.5)`; option header label `#5f86a3`; trade-plan value tints `#c9e0d3` (entry) `#e7c2b8` (exit) `#bcd3e6` (tp); quoted value `#bcd3e6`, inferred value `#b3a9c4`, narrative value `#9fb6cc`; chart trig label `#8aa6c4`; entry rail value `#a9c1d4`; inspector field labels `#5f86a3` (ENTRY/CATALYST), `#7e858d` (TRIGGER), `#9c6457` (INVALIDATION), `#5f8a72` (TARGET); thumbnail gradient `linear-gradient(135deg,#16202b,#0c1116)`.

### 1.5 Stage / background / text / hairline colors

| Token | Value | Where |
|---|---|---|
| Page bg | `#050608` | `<body>` |
| Frame bg | `#08090b` | outer 1560px frame; also Bar 4 and overview band |
| Frame border | `1px solid rgba(255,255,255,.08)` | outer frame |
| Bar 1 bg | `#0a0c0f` | app nav; also group headers, options-intel container |
| Bar 2 bg | `linear-gradient(180deg,#0c0f13,#0a0c0f)` | title bar |
| Bar 3 bg / footer input bg | `#070809` | status bar, ASK AUGUST band, ADD SOURCES input |
| Tape label cell bg | `#0b0e12` | LIVE TAPE pill |
| Card bg | `#0b0d10` | overview cards, top-stocks/options cards, blotter column header |
| Legend/loading strip bg | `#090b0e` | board legend row + loading strip |
| Button bg (neutral) | `#0e1116` | SYNC/EXPORT/Add/A–Z/← IDEA buttons, inactive fkey chip |
| Panel inset bg | `#0a0c0f` | inspector stat strip, price chart, ask input, idea rows base |
| Hairlines | `rgba(255,255,255,.05)` `.045` `.06` `.07` `.08` `.09` `.1` `.12` `.13` `.14` | borders — quote exactly per element in §2 |
| Text: brightest | `#eef1f4` | live prices |
| Text: primary | `#e9ebee` | tickers, H1, needle |
| Text: title-bar chip | `#dfe3e7` | date chip, hero group label, catalyst ticker |
| Text: body | `#c4cad0` | thesis, source titles |
| Text: secondary | `#aeb4bb` / `#aab1b9` | setup col, buttons, brief paragraph |
| Text: muted | `#9aa1a9` | section headers |
| Text: dim | `#8b929a` / `#868d95` / `#7e858d` / `#7a818a` | tape px, sub-labels, fkey labels |
| Text: faint | `#6b727a` / `#646b73` / `#5a616a` | legend, counters |
| Text: ghost | `#565c63` | micro-labels |
| Text: disabled | `#4d535a` | absent "n/s" text, disclaimer |
| Text: absent glyph | `#3a4047` | `∅` glyph, "—" |
| Text: empty-state glyph | `#33393f` | big `∅` |
| Misc | `#cdd3d9` (tape sym, NOW value), `#c7ccd2` (sector name, map label), `#cdb892` (amber values), `#9ec3ab` (green DATA value), `#e3edf6` (accent-button text), `#e7c2b8` (retry button text), `#454b52` (tape divider) |

### 1.6 Fonts

Google Fonts import: `IBM Plex Mono` ital,wght `0,400;0,500;0,600;0,700;1,400` + `Hanken Grotesk` ital,wght `0,400;0,500;0,600;0,700;1,400`.

- **Mono stack:** `'IBM Plex Mono',monospace` — all chrome, labels, numbers, chips.
- **Sans stack:** `'Hanken Grotesk',sans-serif` — body copy (thesis, brief paragraph, source titles, empty-state copy, absent cells in italic). Body has `-webkit-font-smoothing:antialiased`.

Every font-size / letter-spacing / weight in use (mono unless noted):

| px | Uses (weight, letter-spacing) |
|---|---|
| 6.5px | evidence-chip glyph |
| 7px | tape divider is 8px — 7px used for: stat-strip labels (ls .1em), heat legends (`HQ · US`, `C/P SKEW`, `click → plan/ticket` ls .06em), evidence chips (600, ls .05–.07em), dir glyph `▲▼◆` inside 9.5px spans, chart H/L labels (ls .04em), live badge dot |
| 7.5px | FEAR/GREED axis (ls .1em), sort button (ls .08em), thumbnail `SU` (ls .1em), ACTIVE/ANALYZED mini-chips (ls .1em), section micro-headers `TRADE PLAN` / `PRICE ACTION` / `LEVELS…` / `LIVE · REAL-TIME` / `Δ → TRIGGER` (ls .12–.14em), chart trig label (ls .03em), non-US footnote (ls .04em), top-options ev chip (600, ls .06em), "stated in transcript" (ls .05em) |
| 8px | fkey key chip (600), status-bar items (ls .04em/.1em), column headers (ls .1em), group sub (ls .06em), 60s chip / catalystNote (ls .05–.08em), `AT THE OPEN` (ls .14em), open-rail statuses (ls .06em), tape divider (ls .16em), video meta, `PREVIEW STATE` (ls .14em), option group labels (ls .13em), top-stocks life chip (600, ls .04em), inspector field labels (500, ls .11em), `CONF` label (ls .13em), chart sub (ls .03em) |
| 8.5px | tape LIVE TAPE label (ls .14em), count chips in brief (ls .06em), legend items (ls .04em), blotter meta (ls .08em), row status chip (600, ls .04em), TF col, conf %, boardBtns (ls .08em), inspector breadcrumbs (ls .06em), Δ note footers (ls .02em), disclaimer (ls .03em, lh 1.6), live badge on chart, skeleton n/a |
| 9px | LIVE chip (ls .12em), counts chips (see 9.5px), card headers `MARKET SENTIMENT` etc (ls .16em), sector name (ls .06em), group label (600, ls .16em), setup col (ls .01em), posture chips (500, ls .1em), evidence "SOURCE" chip, top-stocks rank/dir, options struct col, `OPTIONS INTEL` sub (ls .04em), srcLine (ls .02em), no-trigger pill (ls .05em), `▶` glyph |
| 9.5px | ws tabs (ls .1em), status chips `2 TRIGGERED/ARMED/ACTIVE` + date meta (ls .04–.12em), section headers left rail (500, ls .16em), `TRADE BLOTTER` is 10.5px, dir col (ls .02em), add-sources placeholder (lh 1.6), Add button (ls .06em), loading strip (ls .14em), error timestamp (ls .04em), ask-august label (500, ls .16em), tape inst tail |
| 10px | SYNC/BRIEF/EXPORT buttons (ls .05em), open-rail ticker, absent cells (sans italic), ref-level cells, `REF LEVEL` line (ls .04em), inspector loading label (10px, ls .14em) |
| 10.5px | tape quote row, trigger/invalid cells, `TRADE BLOTTER` (500, ls .18em), Hanken open-rail text, empty/error buttons (ls .06em), inspector conf %, stat-strip values, Ask button |
| 11px | ticker in options rows (600), LIVE col price, `—` placeholder, option `t` (600), plan absent (sans italic), `›` glyphs, caret |
| 11.5px | source/video titles (sans, 500, lh 1.3), plan cell values, ask placeholder text, inspector empty copy (sans) |
| 12px | AUGUST wordmark (600, ls .22em), row ticker (600, ls .02em), F&G regime (ls .12em), empty-state title (ls .18em/.16em), inspector cell values, sector pct is 14px, plan values (option ticket), levels plain cells (sans, lh 1.4), brief paragraph (sans, lh 1.5) |
| 12.5px | options-heat tag |
| 13px | ask prompt `›`, thesis (sans, lh 1.5), empty-state copy (sans, lh 1.55) |
| 14px | sector pct |
| 15px | H1 `MARKET INTEL` (600, ls .2em) |
| 16px | inspector Δ value |
| 17px | inspector live price |
| 21px | inspector ticker (600, ls .04em) |
| 22–32px | error `△` 26px/22px, empty `∅` 30px/24px, F&G value 32px (600) |

**Weights used:** 400 (default), 500, 600 only. Italic only for Hanken Grotesk absent-cells.

### 1.7 Radii

| Radius | Uses |
|---|---|
| `2px` | virtually everything: buttons, chips, cards' inner boxes, inputs, skeleton bars, heat tiles, conf-bar (`1px` on sector legend swatch) |
| `3px` | overview cards, top-stocks/top-options cards |
| `50%` | all dots |
| `1px` | sector legend gradient swatch |

### 1.8 Keyframes + scrollbar (global CSS, verbatim)

```css
@keyframes augPulse { 0%,100%{ opacity:1; } 50%{ opacity:.3; } }
@keyframes augShimmer { 0%,100%{ opacity:.28; } 50%{ opacity:.6; } }
@keyframes augTape { from{ transform:translateX(0); } to{ transform:translateX(-50%); } }
::-webkit-scrollbar{ width:9px; height:9px; }
::-webkit-scrollbar-thumb{ background:rgba(255,255,255,.08); }
::-webkit-scrollbar-track{ background:transparent; }
```

---

## 2. LAYOUT TREE

Outer frame: `div` `width:1560px; margin:0 auto; position:relative; background:#08090b; border:1px solid rgba(255,255,255,.08);`
→ child 0 (Cinematic only): ambient gradient layer (§1.3)
→ child 1: content wrapper `position:relative; z-index:1;` containing, top to bottom:

### 2.1 BAR 1 — App nav + function keys (h 33px)

`display:flex; align-items:center; justify-content:space-between; gap:16px; padding:0 16px; height:33px; border-bottom:1px solid rgba(255,255,255,.07); background:#0a0c0f;`

Left cluster (`flex; gap:13px`):
- **AUGUST wordmark**: `inline-flex; gap:7px; mono 12px 600 ls .22em color #e9ebee` with orb dot `9px×9px; border-radius:50%; background:radial-gradient(circle at 35% 30%, {acc}, #0a0c0f 75%); box-shadow:0 0 8px -1px {accSoft40};`
- divider `width:1px; height:15px; background:rgba(255,255,255,.1);`
- **workspace tabs** (`flex; align-items:stretch; gap:1px; height:33px`): each `inline-flex; align-items:center; mono 9.5px ls .1em; padding:0 11px; border-bottom:2px solid {w.underline}; background:{w.bg}; color:{w.color}`. Tabs: `INTEL` (active: color `#e9ebee`, underline `acc`, bg `accSoft06`), `MARKETS`, `ORB`, `SCREENER`, `JOURNAL` (inactive: color `#6b727a`, underline `transparent`, bg `transparent`).

Right cluster (`flex; gap:9px`): **fkeys** — each `inline-flex; gap:5px; mono 9px ls .05em color #7a818a` label preceded by key chip `mono 8px 600; border-radius:2px; padding:1px 4px; color:{keyColor}; background:{keyBg}; border:1px solid {keyBorder}`. Keys: `F1 BOARD` (active: keyColor `acc`, keyBg `accSoft12`, keyBorder `accSoft40`), `F2 BRIEF`, `F3 SOURCES`, `F4 OPTIONS`, `F5 ASK`, `F6 SYNC` (inactive: `#8b929a` / `#0e1116` / `rgba(255,255,255,0.1)`).

### 2.2 BAR 2 — Title + counts + actions (h 42px)

`position:relative; display:flex; align-items:center; justify-content:space-between; gap:18px; padding:0 16px; height:42px; border-bottom:1px solid rgba(255,255,255,.08); background:linear-gradient(180deg,#0c0f13,#0a0c0f);`
- Top glow line overlay (Minimal/Cinematic), see §1.3.

Left (`flex; gap:12px`):
- `<h1>` `MARKET INTEL` — `mono 15px 600 ls .2em #e9ebee; white-space:nowrap; margin:0`.
- **LIVE chip**: `inline-flex; gap:6px; mono 9px ls .12em color #6fa085; padding:2px 7px; border:1px solid rgba(111,160,133,.32); border-radius:2px;` + dot `5px; #6fa085; animation:augPulse 2s ease-in-out infinite`.
- Date + desk meta: `inline-flex; gap:8px; mono 9.5px ls .04em #565c63` containing date chip `color #dfe3e7; ls .08em; padding:2px 7px; border:1px solid rgba(255,255,255,.14); border-radius:2px;` text **`SAT · JUN 27 2026`** (MOCK) then **`DESK: MOMENTUM · 6 TRACKED`** (MOCK).

Right (`flex; gap:8px`):
- **`2 TRIGGERED`** chip: `mono 9.5px ls .08em #6fa085; padding:3px 9px; border:1px solid rgba(111,160,133,.3); background:rgba(111,160,133,.08); border-radius:2px;` + pulsing 5px dot (2s). (MOCK count)
- **`2 ARMED`**: `#bfa05a; border:1px solid rgba(191,160,90,.3);` same padding/radius, no bg, no dot. (MOCK)
- **`2 ACTIVE`**: `#6aa0c8; border:1px solid rgba(106,160,200,.3);` (MOCK)
- divider `1px × 17px rgba(255,255,255,.1); margin:0 2px`
- **SYNC** button: `mono 10px ls .05em #aab1b9; background:#0e1116; border:1px solid rgba(255,255,255,.1); border-radius:2px; padding:6px 11px; cursor:pointer;`
- **BRIEF** button (accent): `color #e3edf6; background:{accSoft12}; border:1px solid {accSoft40};` same metrics.
- **EXPORT** button: same as SYNC.

### 2.3 BAR 3 — Operational status (h 25px)

`display:flex; align-items:center; padding:0 16px; height:25px; border-bottom:1px solid rgba(255,255,255,.06); background:#070809; overflow:hidden;`

Each status item: `inline-flex; gap:6px; padding:0 13px; border-right:1px solid rgba(255,255,255,.05); mono 9px ls .04em; white-space:nowrap;` = optional dot (`5px; background:{st.dot}` + optional glow `box-shadow:0 0 6px -1px {dot};`) + label (`#565c63; ls .1em`) + value (`color:{st.valColor}`).

The 8 items (ALL MOCK values):

| label | val | dot | glow | valColor |
|---|---|---|---|---|
| SESSION | WEEKEND | `#bfa05a` | no | `#cdb892` |
| DATA | LIVE | `#6fa085` | yes | `#9ec3ab` |
| FEED | WS·CONNECTED | `#6fa085` | no | `#aab1b9` |
| LATENCY | 42ms | `#6fa085` | no | `#aab1b9` |
| KEY | YT_API UNSET | `#bfa05a` | no | `#cdb892` |
| LAST SYNC | 1821m | — | — | `#aab1b9` |
| BRIEF | 475m | — | — | `#aab1b9` |
| NOW | 17:05:49 ET | — | — | `#cdd3d9` |

Right-aligned **REC** indicator: `margin-left:auto; inline-flex; gap:6px; padding-left:13px; mono 9px ls .08em #7a818a` + dot `5px; #cd7e6d; animation:augPulse 1.4s ease-in-out infinite`.

### 2.4 BAR 4 — Ticker tape (h 30px)

`display:flex; align-items:stretch; height:30px; border-bottom:1px solid rgba(255,255,255,.07); background:#08090b; overflow:hidden;`
- **LIVE TAPE pill** (fixed left): `inline-flex; gap:6px; flex-shrink:0; padding:0 14px; border-right:1px solid rgba(255,255,255,.09); background:#0b0e12; mono 8.5px ls .14em #7e858d` + dot `5px; #74b08a; box-shadow:0 0 6px -1px #74b08a; animation:augPulse 2.2s ease-in-out infinite`.
- Scroll region: `flex:1; overflow:hidden; position:relative;` containing track `display:flex; align-items:center; width:max-content; height:30px; animation:augTape 64s linear infinite;` with hover rule `animation-play-state:paused` (design runtime used `style-hover=` — implement as CSS `:hover`). Tape content is rendered **twice back-to-back** for a seamless −50% loop.
- Tape item, divider type: `inline-flex; padding:0 16px; mono 8px ls .16em #454b52` — label `WATCHLIST`.
- Tape item, quote type: `inline-flex; gap:7px; padding:0 15px; border-right:1px solid rgba(255,255,255,.045); mono 10.5px; white-space:nowrap` = sym (`#cdd3d9` 500) + px (`#8b929a`) + tail: instrument tail `9.5px color {col}` (e.g. `▲+0.34%`), watchlist tail `8px ls .06em color {lifeC}` (e.g. `TRIG`).

### 2.5 Market overview band

`border-bottom:1px solid rgba(255,255,255,.07); background:#08090b; padding:14px 16px 13px;`
Inner grid: **`display:grid; grid-template-columns:284px 1fr 1fr 328px; gap:12px; align-items:stretch;`**

All four cards share the shell: `background:#0b0d10; border:1px solid rgba(255,255,255,.07); border-radius:3px; padding:12px 13px; display:flex; flex-direction:column;`

**(a) MARKET SENTIMENT (284px)**
- Header `mono 9px ls .16em #9aa1a9`.
- Centered SVG `viewBox="0 0 200 118"`, `width:196px; height:auto`, `margin-top:8px`. Semicircle gauge: 5 arc segments, `stroke-width:13; stroke-linecap:butt; opacity:0.85; fill:none`. Geometry: `cx=100, cy=104, r=82`; segments span degrees `180→144→108→72→36→0.01` with colors **`#b06a58, #c68a5e, #ad9158, #6fa085, #74b08a`**. Needle: line from `(cx,cy)` to point at angle `180 − 1.8·fgVal` at radius `r−8 = 74`, `stroke:#e9ebee; stroke-width:2.4; stroke-linecap:round`; hub `circle r=5 fill #e9ebee`.
- Value row (`flex; baseline; center; gap:10px; margin-top:2px`): value `mono 32px 600 lh 1 color {fng.c}` (**`46`** MOCK) + regime `mono 12px ls .12em color {fng.c}` (**`NEUTRAL`** at 46).
- Axis row: `flex; space-between; margin-top:7px; mono 7.5px ls .1em #565c63` — `FEAR` / `GREED`.
- F&G bands: `≤24 EXTREME FEAR #cd7e6d · ≤44 FEAR #c68a5e · ≤55 NEUTRAL #bfa05a · ≤74 GREED #6fa085 · else EXTREME GREED #74b08a`. (`fng.border = hexA(c,0.42)` and `fng.bg = hexA(c,0.09)` are computed but unused in the markup.)

**(b) SECTOR HEAT MAP (1fr)**
- Header row (`flex; gap:8px; margin-bottom:9px`): title `mono 9px ls .16em #9aa1a9` + **sort button** `mono 7.5px ls .08em #8b929a; background:#0e1116; border:1px solid rgba(255,255,255,.1); border-radius:2px; padding:2px 7px;` label `▾ MOVE` ⇄ `A–Z` + spacer hairline `height:1px; flex:1; background:rgba(255,255,255,.05)` + legend `mono 7px #565c63`: `−` + swatch `42px×6px; border-radius:1px; background:linear-gradient(90deg,#b06a58,#4a4f55 50%,#5a9e79)` + `+`.
- Tiles: `flex:1; display:grid; grid-template-columns:repeat(4,1fr); grid-auto-rows:1fr; gap:4px;` — 11 tiles (MOCK sectors). Tile: `background:{s.bg}; border:1px solid {s.border}; border-radius:2px; padding:8px 10px; min-width:0; flex column; justify-content:center; gap:2px;` name `mono 9px ls .06em #c7ccd2`, pct `mono 14px color {s.c}`.
- Heat formula: `t = min(1, |pct| / maxAbs)`; base rgb `111,158,131` (pos) / `197,133,117` (neg); `bg = rgba(base, 0.10 + t*0.44)`; `border = rgba(base, 0.22 + t*0.40)`; text `pos: t>0.55 ? #c3e4d1 : #93c1a6`, `neg: t>0.55 ? #ecbcb0 : #d3a396`.

**(c) OPTIONS HEAT MAP (1fr)**
- Header: title + hairline + note `mono 7px ls .06em #565c63`: **`C/P SKEW · illustrative`** (design self-labels this MOCK).
- Tiles: `grid-template-columns:repeat(3,1fr); grid-auto-rows:1fr; gap:4px;` — 6 tiles. Tile: same shell as sectors; ticker `mono 11px 600 #e9ebee`, tag `mono 12.5px color {o.c}` (e.g. `C 72%`).
- Skew formula: `bull = call ≥ 50; dom = bull?call:100−call; t = min(1,(dom−50)/40)`; same bg/border/text formulas as sectors.

**(d) MAP THE STOCKS (328px)**
- Header: title + hairline + `mono 7px #565c63` `HQ · US`.
- Body `flex:1; display:flex; align-items:center; min-height:118px;` — three exclusive states:
  - Ready: SVG `viewBox="0 0 300 185"`, `width:100%; height:auto; display:block`. State paths: `fill:rgba(106,160,200,0.055); stroke:rgba(138,166,196,0.28); stroke-width:0.5; stroke-linejoin:round`. Per point: outer circle `r = 3 + min(5,|pct|)` `fill {d.c}; opacity:0.35`, inner circle `r 2.4 fill {d.c}`, label `<text>` `mono 8px fill #c7ccd2; text-anchor:middle` at `y = py − r − 4`. Point color: `pct>=0 ? '#6fa085' : '#c58575'`.
  - Pending (verbatim): `LOADING MAP…` — `width:100%; text-align:center; mono 8.5px ls .14em #565c63`.
  - Error (verbatim): `MAP OFFLINE` — `width:100%; text-align:center; mono 8.5px ls .1em #565c63`.
- Footnote: `mono 7.5px ls .04em #565c63; margin-top:4px` — **`2 non-US · BABA CN · SHOP CA`** with tickers in `#8b929a` (MOCK).
- The design loads geometry at runtime from CDN: `d3-geo@3`, `topojson-client@3`, `us-atlas@3/states-10m.json`, `geoAlbersUsa().fitExtent([[6,6],[294,179]], fc)`. The 4 HQ points are hardcoded: `AAPL [-122.03,37.32] −3.90 · UBER [-122.42,37.77] +3.10 · TEM [-87.63,41.88] +6.05 · WEN [-83.11,40.10] −1.20` (ALL MOCK).

**Catalysts slim line** (below grid, `flex; gap:9px; margin-top:11px`):
- Label `CATALYSTS` `mono 9px ls .16em #7e858d; flex-shrink:0`.
- Chip per catalyst: `inline-flex; gap:6px; mono 9.5px; padding:3px 9px; border:1px solid rgba(255,255,255,.1); border-radius:2px; white-space:nowrap` = ticker (`#dfe3e7` 600) + date (`#868d95`) + tag (`8.5px ls .08em color {c.tagC}`). MOCK: `WEN · Mon Jun 30 · BMO(#6aa0c8)`, `UBER · Wed Jul 02 · AMC(#bfa05a)`.
- Right note `margin-left:auto; mono 8px ls .05em #565c63`: **`2 of 6 watchlist · <7 sessions · illustrative`** (MOCK, self-labeled).

### 2.6 MAIN GRID

**`display:grid; grid-template-columns:252px minmax(0,1fr) 384px;`** — three columns: LEFT RAIL (252px, `border-right:1px solid rgba(255,255,255,.07); min-width:0`), BOARD (fluid, `min-width:0; border-right:1px solid rgba(255,255,255,.07)`), INSPECTOR (384px, `min-width:0`).

#### 2.6.1 LEFT RAIL — four stacked `<section>`s, each `padding:{secPad}` (Standard: `12px 16px`), first three with `border-bottom:1px solid rgba(255,255,255,.07)`.

**TONIGHT'S BRIEF**
- Header row: title `mono 9.5px 500 ls .16em #9aa1a9` + `60s` chip `mono 8px ls .08em #565c63; padding:2px 6px; border:1px solid rgba(255,255,255,.1); border-radius:2px`.
- Paragraph (MOCK): `Hanken 12px lh 1.5 #aeb4bb; margin:0 0 11px` — “Selectively bullish, one bearish setup on watch. Momentum tape — nothing triggers until price confirms.”
- Count chips (`flex; wrap; gap:4px; margin-bottom:12px`), `mono 8.5px ls .06em; padding:2px 6px; border-radius:2px`: `2 TRIG` (`#6fa085; border rgba(111,160,133,.3); bg rgba(111,160,133,.07)`), `2 ARM` (`#bfa05a; border rgba(191,160,90,.3)`), `2 ACT` (`#6aa0c8; border rgba(106,160,200,.3)`), `5B·1S` (`#7a818a; border rgba(255,255,255,.08)`). ALL MOCK.
- `AT THE OPEN` label `mono 8px ls .14em #5a616a; margin-bottom:7px`, then 3 rows (`grid; grid-template-columns:38px 1fr auto; gap:7px; align-items:center; padding:5px 0; border-top:1px solid rgba(255,255,255,.06)`): ticker `mono 10px #cdd3d9` + condition `Hanken 10.5px #7a818a` with level in `mono #a9c1d4` + status `mono 8px ls .06em`. MOCK rows: `TEM clears $52.50 → CLEARED (#6fa085)`, `SHOP clears $114.50 → −2.58% (#bfa05a)`, `AAPL holds $293 → BROKEN (#cd7e6d)`.

**SOURCE MONITOR**
- Header: title + count `1 · WS` (`mono 8.5px #565c63`, MOCK).
- Card row (`flex; gap:9px; align-items:flex-start`): thumb `44px×30px; border-radius:2px; background:linear-gradient(135deg,#16202b,#0c1116); border:1px solid rgba(255,255,255,.1);` centered `SU` `mono 7.5px ls .1em #6aa0c8`; body: title `Hanken 11.5px 500 #c4cad0 lh 1.3; ellipsis` — “Tomorrow Is About to Be the Bi…” (MOCK); meta row `flex; gap:6px; margin-top:4px`: `video` (`mono 8px ls .06em #646b73`), `ACTIVE` chip (`mono 7.5px ls .1em #6fa085; padding:1px 5px; border:1px solid rgba(111,160,133,.35); border-radius:2px`), `1821m` (`mono 8px #565c63`). ALL MOCK.

**VIDEO LIBRARY** — same structure; count `1`; thumb glyph `▶` `#6aa0c8 9px`; meta: `StockedUp` + `ANALYZED` chip (same style as ACTIVE) + `6·0`. ALL MOCK.

**ADD SOURCES** (no border-bottom)
- Title, then input shell `border:1px solid rgba(255,255,255,.1); border-radius:2px; background:#070809; padding:8px 9px;` with placeholder `mono 9.5px lh 1.6 #565c63`: `Paste URL · @handle · video` (the `@handle` and `video` words in `{acc}`).
- Button `Add ⌃⏎`: `margin-top:8px; mono 9.5px ls .06em #aab1b9; background:#0e1116; border:1px solid rgba(255,255,255,.12); border-radius:2px; padding:6px 13px;`.

#### 2.6.2 BOARD (center column)

**Board header** (`flex; space-between; gap:12px; padding:10px 16px 9px`):
- Left (`flex; baseline; gap:10px`): `TRADE BLOTTER` `mono 10.5px 500 ls .18em #9aa1a9` + meta `mono 8.5px ls .08em #565c63`: **`6 IDEAS · ▾ URGENCY · AUTO-REFRESH 30s`** (MOCK count; auto-refresh label is design copy).
- Right: `PREVIEW STATE` label `mono 8px ls .14em #4d535a` + segmented control `flex; border:1px solid rgba(255,255,255,.1); border-radius:2px; overflow:hidden` with 4 buttons `LIVE / LOADING / EMPTY / ERROR`: `mono 8.5px ls .08em; border:none; border-right:1px solid rgba(255,255,255,.08); padding:5px 9px;` active: `color #e3edf6; background {accSoft12}`; inactive: `color #6b727a; background transparent`. **This segmented control is a design-harness state switcher — do NOT ship it; states must come from real app state.**

**Board LIVE state** contains, in order:

1. **Legend row**: `flex; gap:14px; wrap; padding:6px 16px; border-top/bottom:1px solid rgba(255,255,255,.06); background:#090b0e;` items `mono 8.5px ls .04em #6b727a` with colored glyphs: `◉ live market` (`#74b08a`), `❝ quoted from transcript` (`#6aa0c8`), `∅ not stated` (`#4d535a`), divider `1px×10px rgba(255,255,255,.1)`, `▮ direct` (`#6aa0c8`), `◇ extracted` (`#5fb0ad`), `~ inferred` (`#9a8fb0`).

2. **Column header**: `display:grid; grid-template-columns:60px 44px 40px 54px 62px 76px 78px 64px 74px 62px 56px 58px minmax(64px,1fr); gap:6px; align-items:center; padding:6px 16px; border-bottom:1px solid rgba(255,255,255,.08); background:#0b0d10;` — 13 headers `mono 8px ls .1em #565c63`: `STATUS · TICKER · DIR · TF · SETUP · TRIGGER · INVALID · TARGET · LIVE · Δ→TRIG · SPARK · CONF · EVID`.

3. **Horizon groups** (3): group header `flex; gap:9px; padding:7px 16px; background:#0a0c0f; border-top:1px solid rgba(255,255,255,.05); border-bottom:1px solid rgba(255,255,255,.07);` = tick dot `6px background {g.tickColor}` (+ glow `box-shadow:0 0 7px -1px {tick};` for the hero group) + label `mono 9px 600 ls .16em color {g.labelColor}` + sub `mono 8px ls .06em #565c63` + hairline `flex:1` + count `mono 8.5px ls .06em #6b727a` (`{count} IDEA(S)`).
   Groups: `TODAY · TOP IDEAS` (sub `next session · highest urgency`, tick `#74b08a`, hero → label `#dfe3e7`, glow on) / `SHORT-TERM · SWING` (`days to weeks`, `#6aa0c8`, label `#9aa1a9`) / `LONG-TERM` (`position · months+`, `#7a818a`).

4. **Idea rows** — wrapper `position:relative; cursor:pointer` with 4 stacked layers:
   - left accent bar: `position:absolute; left:0; top:0; bottom:0; width:{accentW}; background:{lifeC};` — `accentW = 3px` if selected or live(TRIGGERED), else `2px`.
   - live wash overlay: `inset:0; background:rgba(116,176,138,0.045)` (live + glow illum only).
   - selection wash: `inset:0; background:{accSoft06}` when selected.
   - selection ring overlay when selected (§1.3).
   - content: same 13-col grid as header, `padding:{rowPad}` (Standard `8px 16px`), `border-bottom:1px solid rgba(255,255,255,.05)`. Cells:
     1. **STATUS chip**: `inline-flex; gap:4px; width:fit-content; mono 8.5px 600 ls .04em; color {lifeC}; padding:2px 6px; border:1px solid {lifeC}; border-radius:2px; background:{statusBg}; box-shadow:{statusShadow};` + 4px dot; text `lifeShort` (`TRIG/ARMED/ACTIVE/INVAL/EXP`). `statusBg = rgba(116,176,138,0.12)` when live else transparent.
     2. **TICKER**: `mono 12px 600 ls .02em #e9ebee`.
     3. **DIR**: `inline-flex; gap:3px; mono 9.5px ls .02em color {dirC}` + glyph span `7px` (`▲`/`▼`/`◆`), text `BULL/BEAR/NEUT`.
     4. **TF**: `mono 8.5px ls .02em #8b929a; ellipsis` (`NEXT SESSION`, `SWING`, `LONG TERM`).
     5. **SETUP**: `mono 9px ls .01em #aeb4bb; ellipsis`.
     6. **TRIGGER** / 7. **INVALID**: evidence-cell renderer (§3.4) inside `min-width:0` div.
     8. **TARGET**: always the ABSENT renderer (hardcoded — the design never has targets).
     9. **LIVE**: `mono 11px` = `◉` (`#74b08a 8.5px; animation:augPulse 2.4s ease-in-out infinite`) + price `#eef1f4`.
     10. **Δ→TRIG**: if levels: `mono 10.5px color {delta.c}` value; else `—` `mono 11px #3a4047`.
     11. **SPARK**: SVG `viewBox="0 0 52 20" preserveAspectRatio="none"; width:52px; height:20px; overflow:visible` — path `stroke {spark.color}; stroke-width:1.2; stroke-linejoin/linecap:round; vector-effect:non-scaling-stroke; fill:none` + end dot `r 1.6`.
     12. **CONF**: bar `30px×3px; background:rgba(255,255,255,.08); border-radius:2px; overflow:hidden` with fill `width:{conf}%; background:{acc}` + text `mono 8.5px #8b929a`.
     13. **EVID chip**: `inline-flex; gap:3px; width:fit-content; mono 7px 600 ls .05em; color {ev.c}; padding:1px 5px; border:1px solid {ev.c}; background:{ev.bg}; border-radius:2px` + glyph `6.5px`. (Always `DIRECT` in this file — mock.)

5. **OPTIONS INTEL** (collapsible card): `margin:12px 16px 4px; border:1px solid rgba(255,255,255,.07); border-radius:2px; background:#0a0c0f; overflow:hidden;`
   - Toggle button (full-width, transparent): caret `#646b73 11px width 11px` (`▾` open / `▸` closed) + `OPTIONS INTEL` `mono 9.5px 500 ls .14em #8b929a` + sub `mono 9px ls .04em #565c63`: `creator option plays · AUGUST candidates — secondary` + right chips: `1 PLAY` (`mono 8px ls .06em #5f86a3; padding:2px 6px; border:1px solid rgba(106,160,200,.25); border-radius:2px`) and `3 CANDIDATES` (`#9a8fb0; border:1px dashed rgba(154,143,176,.35)`). Counts MOCK.
   - Open body: `border-top:1px solid rgba(255,255,255,.06); padding:10px 13px 12px;`
     - Column header grid **`54px 150px 48px 112px minmax(0,1fr) 100px; gap:9px`**, labels `mono 8px ls .1em #565c63`: `TICKER · STRUCTURE · DIR · REF LEVEL · SIZING / EXPIRY · EVIDENCE`.
     - Section divider `CREATOR PLAYS` (`mono 8px ls .13em #5f86a3`) + hairline + `stated in transcript` (`mono 7.5px ls .05em #565c63`); rows (same grid, `padding:6px 4px; border-top:1px solid rgba(255,255,255,.05)`): ticker `mono 11px 600 #e9ebee`, struct `mono 9px #aeb4bb ellipsis`, dir `mono 9.5px {dirC}` + 7px glyph, ref = evidence cell (10px variant), sizing `mono 10px #aeb4bb`, evidence chip (border style can be `dashed` for INFERRED: `border:1px {ev.border} {ev.c}`).
     - Section divider `AUGUST CANDIDATES` (`#9a8fb0`) + `AUGUST-generated · not creator-stated`; candidate rows identical except sizing column shows the absent renderer with text **`∅ not sized`**.
     - Footer note `margin-top:10px; mono 8.5px lh 1.5 ls .02em #565c63`: `~`(`#9a8fb0`) ` AUGUST suggests the structure and references the quoted equity trigger — never the strike or size. ` `∅ not sized`(`#4d535a`) ` until you set it.`

6. **TOP STOCKS / TOP OPTIONS**: `display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:14px 16px 8px; border-top:1px solid rgba(255,255,255,.06);` — two cards `background:#0b0d10; border:1px solid rgba(255,255,255,.07); border-radius:3px; padding:12px 13px;`
   - **TOP STOCKS TODAY**: header (title 9px ls .16em + hairline + `click → plan` 7px ls .06em #565c63). Rows: `grid; grid-template-columns:14px 60px 40px 1fr auto 12px; gap:9px; padding:6px 5px; border-top:1px solid rgba(255,255,255,.05); cursor:pointer;` hover `background:rgba(255,255,255,0.03)`. Cells: rank `mono 9px #565c63`, life chip (`mono 8px 600 ls .04em {lifeC}` + 4px dot, no border), ticker `mono 12px 600 #e9ebee`, dir (`9px {dirC}` + 7px glyph), live price `mono 11px #eef1f4 right`, `›` `mono 11px #565c63 right`. Top 5 by rank.
   - **TOP OPTIONS TODAY**: header note `click → ticket`. Rows: `grid-template-columns:52px 1fr auto 12px; gap:9px; padding:7px 5px;` = ticker, struct (`mono 9px #aeb4bb ellipsis`), evidence chip (`mono 7.5px 600 ls .06em; padding:1px 5px; border:1px {evBorder} {evC}; background:{evBg}`), `›`.

**Board LOADING state** (verbatim design):
- Strip: `flex; gap:9px; padding:8px 16px; border-top/bottom:1px solid rgba(255,255,255,.06); background:#090b0e;` = dot `5px {acc}; animation:augPulse 1s ease-in-out infinite` + text `mono 9.5px ls .14em #8b929a`: **`SYNCING SOURCES · EXTRACTING IDEAS…`**
- 6 skeleton rows on the same 13-col grid, `padding:11px 16px; border-bottom:1px solid rgba(255,255,255,.05)`. Bars: `height:13px/12px/10px`, widths `auto/34/28/46/50/58/60/52/58/48/44/50/46px`, `background:rgba(255,255,255,.07)` (first two and 9th) or `.06`, `border-radius:2px`, `animation:augShimmer 1.4s ease-in-out {delay}s infinite` with delays `0, .07, .12, .17, .22, .27, .32, .37, .42, .47, .52, .57, .62`.

**Board EMPTY state** (verbatim): `padding:64px 22px; text-align:center; border-top:1px solid rgba(255,255,255,.06);`
- `∅` `mono 30px #33393f; margin-bottom:14px`
- **`NO IDEAS ON THE BOARD`** `mono 12px ls .18em #8b929a; margin-bottom:9px`
- Copy `Hanken 13px lh 1.55 #646b73; max-width:42ch; margin:0 auto 18px`: **“No trade ideas have been extracted yet. Add a source or generate tonight's brief to populate the blotter.”**
- Buttons (centered, gap 8px): **`ADD SOURCE`** accent (`mono 10.5px ls .06em #e3edf6; background {accSoft12}; border:1px solid {accSoft40}; padding:8px 15px`) + **`GENERATE BRIEF`** neutral (`#aab1b9; background:#0e1116; border:1px solid rgba(255,255,255,.12)`).

**Board ERROR state** (verbatim): `padding:56px 22px; text-align:center; border-top:1px solid rgba(205,126,109,.18); background:rgba(205,126,109,.03);`
- `△` `mono 26px #cd7e6d; margin-bottom:14px`
- **`ANALYSIS FAILED`** `mono 12px ls .16em #cd7e6d; margin-bottom:9px`
- Copy `Hanken 13px lh 1.55 #8b929a; max-width:46ch; margin:0 auto 8px`: **“Could not reach the source. `YOUTUBE_API_KEY` is not set — channel auto-discovery and live status are disabled.”** (`YOUTUBE_API_KEY` styled `mono font-size:.86em color #bfa05a`)
- **`ERR · SOURCE_UNREACHABLE · 17:05:12 ET`** `mono 9.5px ls .04em #565c63; margin-bottom:18px` (MOCK timestamp)
- **`RETRY SYNC`** button: `mono 10.5px ls .06em #e7c2b8; background:rgba(205,126,109,.1); border:1px solid rgba(205,126,109,.4); border-radius:2px; padding:8px 15px;`

#### 2.6.3 INSPECTOR (384px right column)

Header: `flex; space-between; padding:10px 16px 9px; border-bottom:1px solid rgba(255,255,255,.06);` = `INSPECTOR` `mono 9.5px 500 ls .16em #9aa1a9` + breadcrumb: idea mode `mono 8.5px ls .06em #565c63`: `▸ {t} · {setup} · {rowNo}/6` (the `/6` denominator is MOCK/hardcoded); option mode `#c9a3d6`: `▸ {t} · OPTION TICKET`.

**Idea mode** (`padding:14px 16px 16px`):
1. Title row: ticker `mono 21px 600 ls .04em #e9ebee` + status chip `inline-flex; gap:6px; mono 9px 600 ls .12em {lifeC}; padding:3px 8px; border:1px solid {lifeC}; border-radius:2px; background:{statusBg}; box-shadow:{statusShadow}` + 5px dot; right block: `LIVE · REAL-TIME` `mono 7.5px ls .14em #565c63` over price `mono 17px #eef1f4` with `◉` `#74b08a 11px; augPulse 2.4s`.
2. **Stat strip**: `flex; align-items:stretch; margin-top:11px; border:1px solid rgba(255,255,255,.07); border-radius:2px; background:#0a0c0f; overflow:hidden;` — 5 cells `flex:1; min-width:0; padding:6px 9px; border-right:1px solid rgba(255,255,255,.05)`: label `mono 7px ls .1em #565c63; margin-bottom:2px` / value `mono 10.5px {color}; nowrap ellipsis`. Cells: `DIR` (dir color), `TIMEFRAME` (`NEXT`/`LONG`/`SWING`, `#aab1b9`), `CONF` (`70%`), `RANK` (`6.05`), `EVID` (`DIRECT`, `#6aa0c8`).
3. **Posture chips** (`flex wrap gap 6px margin-top 11px`): direction chip `mono 9px 500 ls .1em; padding:3px 8px; border:1px solid {dirC}; color {dirC}; border-radius:2px` (`BULLISH` etc.) + evidence chip `{ev.c}` bordered w/ bg, text `{label} SOURCE` and 8px glyph.
4. **Thesis**: `Hanken 13px lh 1.5 #c4cad0; margin:12px 0 0`.
5. **TRADE PLAN** label `mono 7.5px ls .12em #565c63; margin:14px 0 7px` + grid `1fr 1fr 1fr; gap:7px`:
   - ENTRY box: `border:1px solid rgba(111,160,133,.28); background:rgba(111,160,133,.05); border-radius:2px; padding:8px 10px;` label `mono 7.5px ls .12em #6fa085`, value `mono 11.5px #c9e0d3` or absent `Hanken italic 11px #4d535a` `∅ n/s`.
   - EXIT / STOP box: `rgba(205,126,109,.28)/.05`, label `#cd7e6d`, value `#e7c2b8`.
   - TAKE-PROFIT box: `rgba(106,160,200,.28)/.05`, label `#6aa0c8`, value `#bcd3e6`; absent variant text: **`∅ n/s — thesis-driven`**.
6. **PRICE ACTION** header row (`flex; align-items:flex-end; space-between; margin:15px 0 0`): left `PRICE ACTION` `7.5px ls .12em #565c63` + sub `mono 8px ls .03em #6b727a; margin-top:2px`: **`5D · 15m · illustrative`** (design self-labels the series MOCK). Right: if levels — `Δ → TRIGGER` `7.5px ls .14em #565c63` over `mono 16px {delta.c}` value + `7.5px ls .08em` label (`PAST TRIGGER`/`TO TRIGGER`); if no levels — pill `inline-flex; gap:6px; mono 9px ls .05em #646b73; padding:5px 9px; border:1px dashed rgba(255,255,255,.13); border-radius:2px`: `~`(`#9a8fb0`)`NO TRIGGER · THESIS-DRIVEN`.
7. **Chart**: container `position:relative; margin-top:8px; border:1px solid rgba(255,255,255,.07); border-radius:2px; background:#0a0c0f; overflow:hidden;` SVG `viewBox="0 0 352 92" preserveAspectRatio="none"; width:100%; height:92px`:
   - 3 gridlines at y `23/46/69`, `stroke:rgba(255,255,255,0.035); stroke-width:1`.
   - area path `fill: hexA(line, 0.10)`; trigger line (if levels) `stroke:rgba(106,160,200,0.55); stroke-width:1; stroke-dasharray:3 3; vector-effect:non-scaling-stroke`; price line `stroke {line}; stroke-width:1.5; round joins/caps; non-scaling-stroke`; live marker: ring `r 6; fill:none; stroke {line}; stroke-width:1; opacity:0.35` + dot `r 3.2 fill {line}`.
   - Overlays: `H {hi}` top-left / `L {lo}` bottom-left `mono 7px ls .04em #646b73; background:rgba(10,12,15,0.72); padding:0 2px;`; trigger label centered at `top:{trigY}px` `mono 7.5px ls .03em #8aa6c4; background:rgba(10,12,15,0.85); padding:0 3px`: `❝ TRIG {trigF}`; live badge right at `top:{liveY}px`: `inline-flex; gap:4px; mono 8.5px #eef1f4; background:rgba(10,12,15,0.9); padding:1px 5px; border:1px solid rgba(255,255,255,.12); border-radius:2px` with `◉` `#74b08a 7px`.
8. **LEVELS · EACH TAGGED BY EVIDENCE** label `7.5px ls .12em #565c63; margin:16px 0 0` + grid `1fr 1fr; gap:12px 14px; margin-top:9px; padding-top:12px; border-top:1px solid rgba(255,255,255,.06)`. Each field: label row (`flex; gap:6px; margin-bottom:4px`): label `mono 8px 500 ls .11em {labelColor}` + optional evidence chip `mono 7px 600 ls .07em; padding:1px 5px; border:1px {ev.border} {ev.c}; background {ev.bg}`. Cell uses one of three renderers (§3.4): absent → `Hanken italic 11.5px #4d535a` **`∅ Not stated by source`**; glyphed → `mono 12px` glyph(10px) + value; plain → `Hanken 12px lh 1.4 {valColor}`. Fields: ENTRY(`#5f86a3`), TRIGGER(`#7e858d`), INVALIDATION(`#9c6457`), TARGET(`#5f8a72`), CATALYST(`#5f86a3`).
9. Footer row (`flex; space-between; margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,.06)`): `CONF` `mono 8px ls .13em #646b73` + bar `70px×4px` (fill `{acc}` at `{conf}%`) + `{conf}%` `mono 10.5px #9aa1a9`; right `▸ {srcLine}` `mono 9px ls .02em {acc}` (e.g. `▸ StockedUp @ 10:35 · rank 6.05`).

**Option mode** (`padding:14px 16px 16px`):
- Title row: ticker 21px + `OPTION` chip `mono 9px 600 ls .12em #c9a3d6; padding:3px 8px; border:1px solid rgba(154,143,176,.5); border-radius:2px` + **`← IDEA`** back button `mono 8.5px ls .06em #8b929a; background:#0e1116; border:1px solid rgba(255,255,255,.1); border-radius:2px; padding:4px 9px`.
- Chips row: dir chip (with 8px glyph), struct chip (`border rgba(255,255,255,.12) #aeb4bb`), evidence chip (`padding:3px 8px`).
- `REF LEVEL` line `flex; gap:8px; margin-top:13px; mono 10px ls .04em #7e858d` with `❝ {ref}` in `#8aa6c4`.
- TRADE PLAN grid — same three boxes as idea mode but `padding:9px 10px`, values `mono 12px`, always populated (from mock `topOptRaw`).
- Footer note `margin-top:14px; mono 8.5px lh 1.55 ls .02em #565c63`: `~`(`#9a8fb0`) ` AUGUST frames entry / exit / take-profit off the quoted equity level — it never invents the strike or contract size. Illustrative.`

**Inspector LOADING** (verbatim): `padding:60px 16px; center` — pulsing dot `6px {acc}; augPulse 1s` + **`AWAITING ANALYSIS`** `mono 10px ls .14em #6b727a; margin-top:12px` + 3 shimmer bars (`height:10px; rgba(255,255,255,.06); radius 2px; augShimmer 1.4s` delays `0/.2s/.4s`, widths `100%/70%/84%`).
**Inspector EMPTY** (verbatim): `∅` `mono 24px #33393f` + **`NOTHING SELECTED`** `mono 10px ls .14em #6b727a` + copy `Hanken 11.5px #565c63; max-width:30ch`: **“Populate the board, then select a row to inspect its thesis and evidence.”**
**Inspector ERROR** (verbatim): `△` `mono 22px #cd7e6d` + **`INSPECTOR UNAVAILABLE`** `mono 10px ls .14em #cd7e6d` + copy `Hanken 11.5px #646b73; max-width:32ch`: **“Idea data could not be loaded. Retry the sync to restore the board.”**

### 2.7 ASK AUGUST command line

`border-top:1px solid rgba(255,255,255,.08); background:#070809; padding:10px 16px; display:flex; align-items:center; gap:13px;`
- Label `ASK AUGUST` `mono 9.5px 500 ls .16em #9aa1a9; flex-shrink:0`.
- Input shell: `flex:1; flex; gap:9px; border:1px solid {accSoft25}; border-radius:2px; background:#0a0c0f; padding:8px 12px;` = prompt `›` `mono 13px {acc}` + placeholder text `mono 11.5px #565c63; flex:1` (MOCK: “what did the source say about QQQ, and which ideas have no stated invalidation?”) + block caret `7px×14px; background {acc}; opacity:.7; animation:augPulse 1.2s steps(2) infinite`.
- **Ask** button: `mono 10.5px ls .06em #e3edf6; background {accSoft12}; border:1px solid {accSoft40}; border-radius:2px; padding:8px 17px; flex-shrink:0`.

### 2.8 Disclaimer footer

`padding:8px 16px; border-top:1px solid rgba(255,255,255,.06); background:#08090b;` — `<p>` `margin:0; mono 8.5px lh 1.6 ls .03em #4d535a; text-align:center`, verbatim: **“AUGUST Market Intel is decision-support / research over creator commentary. It never trades and never invents prices, levels, or tickers. Not financial advice.”**

---

## 3. DATA SHAPES

Everything below is what the templates bind. Fields marked **MOCK** are hardcoded/derived from hardcoded data in this file.

### 3.1 Chrome

```ts
wsTab      = { label:string, color:string, underline:string, bg:string }        // 5 tabs, INTEL active — tab list itself is design content
fkey       = { k:string, label:string, keyColor:string, keyBg:string, keyBorder:string } // 6 keys, F1 active
statusItem = { label:string, val:string, valColor:string, hasDot:boolean, dot:string|null, dotGlow:string } // dotGlow is a CSS string 'box-shadow:0 0 6px -1px {dot};' — 8 items, ALL values MOCK
tapeItem   = { isDiv?:true, label?:string }                                     // divider ('WATCHLIST')
           | { isQuote:true, isInst?:true, isWatch?:true, sym:string, px:string, tail:string, col:string }
// macro tails: '▲+0.34%' etc. colored P.bull/P.bear; watch tails: lifeShort colored lifeC. 10 macro quotes MOCK; 6 watch entries derived from MOCK ideas.
```

### 3.2 Overview band

```ts
fng    = { value:number/*0-100, from fearGreed prop, default 46 MOCK*/, regime:string, c:string,
           border:string/*hexA(c,0.42) UNUSED*/, bg:string/*hexA(c,0.09) UNUSED*/ }
gauge  = { segs:{d:string/*SVG arc*/, color:string}[]/*5 fixed segments*/, cx:100, cy:104, nx:number, ny:number }
sector = { name:string, pct:string/*'+0.86%'*/, c:string, bg:string, border:string }  // 11 rows, MOCK percentages
optionHeat = { t:string, tag:string/*'C 72%'|'P 66%'*/, c:string, bg:string, border:string } // 6 rows, MOCK skews
usStates: string[]        // SVG path d strings — loaded at runtime from us-atlas CDN in the design
mapPt  = { t:string, x:number, y:number, r:number/*3+min(5,|pct|)*/, ty:number/*y-r-4*/, c:'#6fa085'|'#c58575' } // 4 points, MOCK
mapReady:boolean; mapPending:boolean; mapErr:boolean   // mutually exclusive
catalyst = { t:string, date:string, tag:'BMO'|'AMC', tagC:string } // 2 rows MOCK; catalystNote:string MOCK
sectorSortLabel: '▾ MOVE' | 'A–Z'; toggleSectorSort(): void
```

### 3.3 Idea (blotter row + inspector). Raw record (this file hardcodes 6 — MOCK):

```ts
rawIdea = { t:string, dir:'BULL'|'BEAR'|'NEUTRAL', tf:'NEXT SESSION'|'SWING'|'LONG TERM',
  life:'TRIGGERED'|'ARMED'|'ACTIVE'|'INVALIDATED'|'EXPIRED', setup:string, thesis:string,
  entry:string|null, trig:number|null,
  invalKind:'inferred'|'narrative'|'absent', invalText:string|null, invalShort:string|null,
  catalyst:string, live:number, conf:number/*%*/, src:string, time:string/*'10:35'*/, rank:string/*'6.05'*/ }
```

Derived per idea (all computed in `renderVals()`):

```ts
idea = rawIdea & {
  idx:number, rowNo:number, selected:boolean, onSelect():void,
  dirLabel:'BULLISH'|…, dirShort:'BULL'|'BEAR'|'NEUT', dirC:string, dirGlyph:'▲'|'▼'|'◆',
  lifeC:string, lifeShort:'TRIG'|'ARMED'|'ACTIVE'|'INVAL'|'EXP', isLive:boolean,
  accentW:'2px'|'3px', statusBg:string, statusShadow:string, rowLiveWash:string, rowSelBg:string, rowPad:string,
  liveF:string/*'$54.87' via toLocaleString 2dp*/, trigF:string|null,
  hasLevels:boolean, noLevels:boolean,
  delta: null | { val:string/*'+4.51%'*/, label:'PAST TRIGGER'|'TO TRIGGER', c:string/*bull|amber*/ },
  rail:  null | { live:number, trig:number, c:string, fillL:number, fillW:number } /*0-100 %, computed but NOT bound anywhere in this desktop markup*/,
  cTrig: Cell, cInval: Cell,                    // §3.4
  confW:string/*'70%'*/,
  srcLine:string/*'StockedUp @ 10:35 · rank 6.05'*/, srcShort:string,
  evHdr: EvChip,                                 // ALWAYS evChip('DIRECT') — MOCK
  insFields: InsField[5], stats: Stat[5],
  spark: { path:string, color:string, dotX:number, dotY:number },       // seeded-random series — MOCK
  chart?: { linePath:string, areaPath:string, line:string, fill:string, // hexA(line,0.10)
            trigY:number, trigTop:string, liveX:number, liveY:number, liveTop:string,
            hi:string, lo:string }               // built only for the selected idea; seeded-random — MOCK
}
Stat     = { label:string, val:string, color:string }
InsField = { label:string, labelColor:string, hasEv:boolean, ev:EvChip|null, cell:Cell }
plan     = { entry|exit|tp: { has:boolean, no:boolean, text?:string } }
// plan.entry falls back to 'Break {trigF}' when entry null but levels exist; plan.tp is ALWAYS absent in this file.
```

**Delta math:** `favored = bull ? live≥trig : live≤trig`. If favored: `val = signed ((live−trig)/trig·100).toFixed(2)+'%'`, label `PAST TRIGGER`, color `P.bull`. Else `val = '+' + |bull ? (trig−live)/live : (live−trig)/live|·100 toFixed(2)+'%'`, label `TO TRIGGER`, color `P.amber`.
**Price format:** `'$' + Number(n).toLocaleString('en-US',{minimumFractionDigits:2, maximumFractionDigits:2})`.

**Groups:**
```ts
group = { label:string, sub:string, items:idea[], count:number, unit:'IDEA'|'IDEAS',
          labelColor:string/*hero '#dfe3e7' else '#9aa1a9'*/, tickColor:string,
          dotGlow:string/*'box-shadow:0 0 7px -1px {tick};' or ''*/ }
// Partitioned by tf: NEXT SESSION → TODAY (hero, glow) / SWING → SHORT-TERM / LONG TERM → LONG-TERM
```

### 3.4 Evidence system (chips + cell renderers)

**Chips** (`EV` table — quote exactly):

| Kind | label | color `c` | glyph | border style | bg |
|---|---|---|---|---|---|
| DIRECT | `DIRECT` | `#6aa0c8` (P.blue) | `▮` (U+25AE) | `solid` | `rgba(106,160,200,0.14)` |
| EXTRACTED | `EXTRACTED` | `#5fb0ad` (P.teal) | `◇` (U+25C7) | `solid` | `transparent` |
| INFERRED | `INFERRED` | `#9a8fb0` (P.infv) | `~` | `dashed` | `transparent` |

Chip CSS (blotter EVID column variant): `inline-flex; align-items:center; gap:3px; width:fit-content; mono 7px 600 ls .05em; color {c}; padding:1px 5px; border:1px {borderStyle} {c}; background:{bg}; border-radius:2px; white-space:nowrap` with glyph at `6.5px`. Inspector-levels variant: `ls .07em`; options-row variant: `gap:4px; ls .06em`; posture-chip variant: `9px 500 ls .1em; padding:3px 8px` + text suffix ` SOURCE`.

**Cell renderers** (shape `Cell = { absent:boolean, glyphed:boolean, plain:boolean, text?, glyph?, glyphColor?, valColor?, deco? }`):

| Factory | When it applies | glyph | glyphColor | valColor | text-decoration |
|---|---|---|---|---|---|
| `mkQuoted(t)` | numeric level quoted verbatim from transcript (trigger prices, quoted ref levels) | `❝` (U+275D) | `#6aa0c8` | `#bcd3e6` | `underline dotted` (+ `text-underline-offset:2px`) |
| `mkInferred(t)` | level AUGUST inferred, not stated (e.g. invalidation derived from trigger) | `~` | `#9a8fb0` | `#b3a9c4` | `none` |
| `mkNarr(t)` | qualitative statement quoted from transcript (narrative invalidation, `deep ITM`) | `❝` | `#6aa0c8` | `#9fb6cc` | `none` |
| `mkPlain(t,c?)` | free text (entry description, catalyst, invalidation prose in inspector) | — | — | `c ?? '#c4cad0'` | — |
| `ABSENT` | nothing stated | renders as: `Hanken italic` `∅`(`#3a4047`, non-italic) + text `#4d535a`. Text variants: blotter `n/s` (10px), options sizing `not sized` (10px), inspector levels `Not stated by source` (11.5px), plan boxes `n/s` / `n/s — thesis-driven` (11px) | | | |

Glyphed cell markup (blotter, 10.5px): `mono 10.5px` → glyph span `{glyphColor}` at `8.5px` + space + value span `{valColor}; text-decoration:{deco}; text-underline-offset:2px`. Options rows use 10px/8.5px; inspector levels use 12px/10px.

**Mapping used in this file:** TRIGGER → `mkQuoted(fmt(trig))` + `DIRECT` chip; INVALIDATION → inferred kind: `mkInferred(invalShort)` cell in blotter, `mkPlain(invalText,'#b3a9c4')` + `INFERRED` chip in inspector; narrative kind: `mkNarr(invalShort)` in blotter, `mkPlain(invalText)` + `DIRECT` chip in inspector; ENTRY → `mkPlain(entry)` + `DIRECT`; TARGET → `ABSENT` always; CATALYST → `mkPlain(catalyst)` + `DIRECT`.

### 3.5 Options intel / top lists

```ts
optionRow = { t:string, struct:string, dirC:string, dirGlyph:string, dirShort:string,
              ref:Cell/*mkQuoted|mkNarr|ABSENT*/, sizeAbsent:boolean, sizeText:string|null, ev:EvChip }
// optionPlays: 1 MOCK row (BABA, DIRECT). optionCandidates: 3 MOCK rows (TEM/AAPL/SHOP, INFERRED, unsized).
optionsOpen:boolean; toggleOptions():void; optionsCaret:'▾'|'▸'

topStock  = { n:number, t, lifeShort, lifeC, dirShort, dirC, dirGlyph, liveF,
              deltaTxt:string/*delta.val or '—'*/, deltaC:string/*delta.c or '#3a4047'*/, onSelect():void }
              // deltaTxt/deltaC computed but NOT bound in the desktop markup
topOption = { i:number, t, struct, dirC, dirGlyph, dirShort, ref:string,
              evLabel, evC, evGlyph, evBorder, evBg, entry:string, exit:string, tp:string, onOpen():void }
              // 3 MOCK rows incl. ticket values (entry/exit/tp) — flagged mock
selOpt: topOption      // drives option-mode inspector
boardBtns = { label:'LIVE'|'LOADING'|'EMPTY'|'ERROR', on():void, txtColor:string, bg:string }[]  // preview harness only
skeleton = [0,1,2,3,4,5]
boardLive/boardLoading/boardEmpty/boardError: boolean  // from state.boardState
inspIdea = boardLive && inspectorMode==='idea'; inspOption = boardLive && inspectorMode==='option'
```

### 3.6 Seeded series generators (MOCK — do not port as-is)

Sparklines and the inspector chart are **deterministic fake random walks**: FNV-1a hash of ticker → `mulberry32` PRNG → 46-step walk, rescaled so amplitude = `live × 0.05 × 2` and the last point equals `live`. Spark color = `rail.c` (bull/amber by favored) when levels exist, else dir color. Real implementation must use actual intraday series (5D·15m per the design label).

---

## 4. STATES (designed treatments, verbatim copy)

| Surface | State | Treatment |
|---|---|---|
| Board | `boardLive` | full blotter (legend, headers, groups, rows, options intel, top lists) |
| Board | `boardLoading` | `SYNCING SOURCES · EXTRACTING IDEAS…` strip + 6 staggered shimmer skeleton rows (§2.6.2) |
| Board | `boardEmpty` | `∅` / `NO IDEAS ON THE BOARD` / “No trade ideas have been extracted yet. Add a source or generate tonight's brief to populate the blotter.” / `ADD SOURCE` + `GENERATE BRIEF` buttons |
| Board | `boardError` | `△` / `ANALYSIS FAILED` / “Could not reach the source. YOUTUBE_API_KEY is not set — channel auto-discovery and live status are disabled.” / `ERR · SOURCE_UNREACHABLE · 17:05:12 ET` / `RETRY SYNC` — tinted container `border-top rgba(205,126,109,.18); background rgba(205,126,109,.03)` |
| Inspector | loading | pulsing accent dot + `AWAITING ANALYSIS` + 3 shimmer bars |
| Inspector | empty | `∅` / `NOTHING SELECTED` / “Populate the board, then select a row to inspect its thesis and evidence.” |
| Inspector | error | `△` / `INSPECTOR UNAVAILABLE` / “Idea data could not be loaded. Retry the sync to restore the board.” |
| Map | `mapPending` | `LOADING MAP…` centered `mono 8.5px ls .14em #565c63` |
| Map | `mapErr` | `MAP OFFLINE` centered `mono 8.5px ls .1em #565c63` |
| Gauge | — | **No no-data state designed.** Gauge always renders from the `fearGreed` prop (default 46). A live implementation needs its own empty/error treatment. |
| Trade plan cells | absent | `∅ n/s` (entry/exit) / `∅ n/s — thesis-driven` (take-profit) |
| Δ→TRIG (no levels) | — | dashed pill `~ NO TRIGGER · THESIS-DRIVEN` |
| Row cells absent | — | `∅ n/s`; options sizing `∅ not sized`; inspector level `∅ Not stated by source` |

Inspector loading/empty/error track the board's preview state in this design (`inspIdea/inspOption` require `boardLive`); in the real app they should track selection + data availability.

---

## 5. BEHAVIOR

- **Row selection:** click any idea row → `selectedIdx = idx`, `inspectorMode = 'idea'`. Selected row gets: accent bar widened to 3px, `accSoft06` wash overlay, and the selection ring box-shadow (Cinematic two-part form, §1.3). Selection also changes the inspector breadcrumb and rebuilds the chart for that idea. Default selection: index 0 (TEM).
- **Top stocks click** → same `onSelect` (selects idea, inspector shows the trade plan). **Top options click** → `inspectorMode='option'`, `selectedOption=i` (option ticket). **← IDEA** button → `inspectorMode='idea'`.
- **OPTIONS INTEL toggle:** button flips `optionsOpen`; caret `▾` open / `▸` closed. Default open.
- **Sector sort toggle:** button flips `sectorSort` between `'move'` (desc by pct, label `▾ MOVE`) and `'name'` (A–Z, label `A–Z`). Default `'move'`.
- **PREVIEW STATE segmented control:** design-harness only — switches `boardState` among live/loading/empty/error. Do not ship as UI; keep as the state contract.
- **fkeys bar semantics:** F1–F6 map to `BOARD / BRIEF / SOURCES / OPTIONS / ASK / SYNC`; F1 rendered active (accent chip). No handlers exist in the design — intended as keyboard shortcuts to focus/trigger those areas.
- **Workspace tabs semantics:** app-level nav (`INTEL` active with 2px accent underline + accSoft06 fill; others inert placeholders — `MARKETS/ORB/SCREENER/JOURNAL` reference other AUGUST surfaces).
- **Tape:** duplicated content, `animation:augTape 64s linear infinite` (translateX 0 → −50%); pauses on hover (`animation-play-state:paused`).
- **Animations (exact):**
  - `augPulse` (opacity 1→.3→1): LIVE chip dot 2s; TRIGGERED-count dot 2s; REC dot 1.4s; LIVE TAPE dot 2.2s; row/inspector live `◉` 2.4s; loading dots 1s; ask caret `1.2s steps(2)`. All `ease-in-out infinite` except the caret's `steps(2)`.
  - `augShimmer` (opacity .28→.6→.28): all skeleton bars, `1.4s ease-in-out {stagger}s infinite` (staggers listed in §2.6.2 / §4).
  - `augTape`: 64s linear infinite.
- **Hover affordances:** top-stocks/top-options rows `background:rgba(255,255,255,0.03)` on hover; tape pause. (The design's `style-hover` attribute — implement as CSS.)
- **Interactive-but-static in the design (needs real wiring):** SYNC / BRIEF / EXPORT / Add ⌃⏎ / ADD SOURCE / GENERATE BRIEF / RETRY SYNC / Ask buttons have no handlers.

---

## 6. MOCK DATA INVENTORY

Everything below is hardcoded/derived-from-hardcoded in the design file and must **NOT** ship as live values:

1. **The 6 ideas** (`raw` array): TEM / AAPL / SHOP / WEN / UBER / BABA — every field: theses, entries, triggers (`52.50 / 293 / 114.50`), invalidations, catalysts, live prices (`54.87 / 275.15 / 111.62 / 7.33 / 72.25 / 95.07`), conf (70/70/70/65/60/70), src `StockedUp`, times, ranks.
2. **All sparkline + inspector-chart series** — seeded fake random walks (hash+mulberry32), labeled `5D · 15m · illustrative` in the UI itself.
3. **Fixed counts everywhere:** `6 TRACKED`, `6 IDEAS`, `2 TRIGGERED / 2 ARMED / 2 ACTIVE`, brief chips `2 TRIG / 2 ARM / 2 ACT / 5B·1S`, `1 PLAY / 3 CANDIDATES`, inspector `{rowNo}/6`, `1 · WS`, video-library `1` and `6·0`, `2 of 6 watchlist`.
4. **Header meta:** `SAT · JUN 27 2026`, `DESK: MOMENTUM`, `▾ URGENCY · AUTO-REFRESH 30s`.
5. **Status bar values (all 8):** `WEEKEND`, `LIVE`, `WS·CONNECTED`, `42ms`, `YT_API UNSET`, `1821m`, `475m`, `17:05:49 ET` — and the `REC` indicator.
6. **Ticker tape macro quotes (10):** SPX 5,477.90 +0.34% · NDX 19,890.4 +0.62% · DJI 39,164 −0.12% · RUT 2,022.8 +0.41% · VIX 12.84 −3.10% · DXY 105.62 −0.08% · US10Y 4.252% +1.8bp · WTI 81.46 +0.94% · GOLD 2,331.5 −0.30% · BTC 61,240 +1.42%.
7. **Fear & Greed value 46** (`fearGreed` prop default) and therefore the `NEUTRAL` regime + needle position.
8. **Sector heat percentages (11):** TECH +0.86 · COMM +0.62 · DISC +0.41 · FINL +0.22 · INDU +0.14 · MATL +0.05 · REIT −0.08 · HLTH −0.19 · STPL −0.27 · UTIL −0.38 · ENGY −0.52.
9. **Options heat skews (6):** TEM 72 / AAPL 34 / SHOP 58 / WEN 64 / UBER 61 / BABA 69 — UI self-labels `C/P SKEW · illustrative`.
10. **The 4 map points** (tickers, HQ lon/lat, pct): AAPL (−122.03, 37.32, −3.90) · UBER (−122.42, 37.77, +3.10) · TEM (−87.63, 41.88, +6.05) · WEN (−83.11, 40.10, −1.20); plus footnote `2 non-US · BABA CN · SHOP CA`. Also the runtime CDN loads (d3-geo/topojson/us-atlas) — the artifact of the design harness; a real build should bundle geometry.
11. **Catalysts:** WEN Mon Jun 30 BMO · UBER Wed Jul 02 AMC; note `2 of 6 watchlist · <7 sessions · illustrative`.
12. **Tonight's Brief:** summary paragraph, `60s` chip, and all three AT-THE-OPEN rows (TEM CLEARED / SHOP −2.58% / AAPL BROKEN).
13. **Source monitor + video library cards:** title “Tomorrow Is About to Be the Bi…”, `SU` thumb, `video / ACTIVE / 1821m`, `StockedUp / ANALYZED / 6·0`.
14. **Options intel rows:** 1 creator play (BABA long calls, `deep ITM`, `$3.38M · >12mo expiry`, DIRECT) + 3 candidates (TEM/AAPL/SHOP with quoted refs, INFERRED, unsized).
15. **Top options ticket values:** TEM (Break $52.50 / $50.80 / $58.00) · BABA ($3.38M placed / China risk / Open-ended) · AAPL (Break $293 / $298.20 / $275.00) — **these exit/tp numbers appear nowhere else and are pure design invention.**
16. **Evidence assignments:** blotter EVID column is hardcoded `DIRECT` for every row; inspector stat strip `EVID: DIRECT`; ENTRY/CATALYST chips always `DIRECT`. Real data must drive chip kind per field. The `EXTRACTED` chip kind is defined and shown in the legend but never used on any row in this file.
17. **Ask-August placeholder query** text.
18. **Error-state specifics:** `YOUTUBE_API_KEY` message and `ERR · SOURCE_UNREACHABLE · 17:05:12 ET` timestamp (treat as template: `ERR · {code} · {time} ET`).
19. **PREVIEW STATE segmented control** — design harness, not product UI.
20. **Inactive nav placeholders:** workspace tabs `MARKETS/ORB/SCREENER/JOURNAL` and fkeys F2–F6 have no behavior.
21. **`rank` values** (`6.05 / 4.97 / 4.90 / 5.05`) and the top-stocks ordering derived from them.
22. **`TOP STOCKS TODAY` list** (top 5 of the 6 mock ideas) and `TOP OPTIONS TODAY` list (3 mock rows).

Computed-but-unbound fields safe to drop or wire later: `idea.rail`, `topStock.deltaTxt/deltaC`, `fng.border/bg`, `idea.srcShort`.
