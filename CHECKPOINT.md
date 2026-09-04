# Checkpoint — Constellation

Updated 2026-09-03 (second checkpoint). The app is complete and working on dummy
data. Since the first checkpoint it also carries **epic due dates**, a filterable
and searchable galaxy map, and simplified top-level navigation. The Jira
connection is still deliberately **not** started.

Read this file plus `README.md` (user-facing) and you should be able to pick the
work up cold. §9 lists exactly what changed since the first checkpoint.

---

## 1. Big picture goal

A **fun and accurate way to track complex, multi-level projects** for a team that
lives in Jira. Existing Jira views (boards, roadmaps, dependency reports) are
accurate but joyless, and they don't answer "how far along is this project and
what is holding it up?" at a glance.

The idea: render each project as a **constellation**.

- **L0** (epic / project) = the **sun** at the centre.
- **L1** (tickets) = stars orbiting the sun, 30% of its size.
- **L2** (sub-tickets) = smaller stars orbiting their L1 parent, 20%.
- **L3** = supported now (14%), even though the team doesn't use it yet.
- Stars are **dark until their work is done**, then they light up.
- Lines between stars carry the relationship (parent → child, blocked by).
- Clicking a star opens a summary + status of that ticket.
- Multiple projects run at once, so there's a **galaxy map** of all constellations.

Data eventually comes from Jira via a personal token, discovering projects by
label. **This phase: validate the design on dummy data first.**

Target audience is the team and its stakeholders: it should be legible in a
standup on a shared screen, and rewarding enough that people open it voluntarily.

---

## 2. Guiding principles (established through the iterations)

These are the rules the current design follows. Break them only deliberately.

1. **Colour = your effect on everyone else.**
   Red never means "this ticket is stuck". Red means *other work is waiting on
   this one*. This turned out to be the single most useful signal on the map.
   Being lit at all still separates done from not-started: `unlit` sits at 0.10
   and must stay near there, or that reading collapses.
2. **Brightness ranks attention; the halo carries the state.** This started as
   "light = progress" and was deliberately changed. **Blockers are now the
   brightest stars on the map** (0.88) because they are the project's pain and
   should be findable from across the room; done work sits lower (0.70) but
   carries the widest, softest halo. So a **hot, urgent point means deal with
   me**, and a **broad gentle glow means finished**. Two channels, brightness
   and spread, instead of one.
3. **The sun is the reward.** It stays a banked, dark ember fire while any work
   remains, and ignites only when 100% of the constellation is done. Completion
   has to feel like an event, not a progress bar reaching the end.
4. **Gold is held back for completion.** Same reasoning one level up: the
   progress bar is **blue** (the in-progress star colour) while work remains and
   only turns gold at 100%. Anything permanently gold cheapens the ignition.
5. **Restraint over glare.** An early version blew out into a wall of light when
   several done stars sat together. The blockers are loud on purpose, but their
   halos stay narrower than `lit`'s so the loudness is *brightness, not bloom* —
   keep that gap if you push them further. All these numbers were tuned by eye against
   the live map; re-tune them the same way, not by reasoning about the values,
   and check `vault-rotation` — 30 done stars in one place — before believing a
   change is safe.
6. **Near-black background.** `#010207`, with nebulae at ~0.1–0.16 alpha. The
   stars are the content; the background must not compete.
7. **Unlit ≠ invisible.** Not-started work has to be findable: unlit stars are a
   lit-from-the-sun grey body with a bright rim and a very faint halo.
8. **Stable positions.** All randomness is seeded from ticket keys
   (`lib/rng.ts`). A star sits in the same place on every reload, so the map
   becomes something the team can *learn*. Never introduce `Math.random()`.
9. **Airy over dense; never hide information.** When labels collided, the fix was
   to space the map out and let labels choose a side — *not* to drop labels. An
   explicit instruction from the user; keep it.
10. **Paths must look intentional.** Links may not overlap "for no reason".
    Structure is enforced by the layout (see §4), not patched in the renderer.
11. **Status is entered only at the leaves.** Everything above is a roll-up. An
    epic cannot claim to be done while a sub-task under it is open.
12. **Shipped work stops being measured.** Completed constellations are excluded
    from the galaxy headline totals, and a delivered project shows "delivered"
    rather than its due date — it can never read as late. Finished work should
    not dilute the numbers that describe what is left to do.
13. **One naming scheme in the UI.** The legend's left column is what the ticket
    *is*; the right column is how to spot it. No mixing star types ("red dwarf")
    with state labels ("lit").
14. **One seam for data.** The UI only ever sees the domain model. Swapping dummy
    data for Jira must touch exactly one file.

---

## 3. What exists and how to run it

```bash
cd project-constellation
npm install
npm run dev          # http://localhost:5173
npm run build        # static SPA into dist/ ; tsc -b runs first
```

Stack: **Vite 8 + React 19 + TypeScript**, canvas 2D rendering, **no graph or
animation libraries**.

Route lives in the URL hash: `#/tax-engine`. Empty hash = galaxy map.

### Screens

- **Galaxy map** (landing): a card per epic with a live animated miniature of its
  constellation, % lit, star count, active count, blocking count and due date. A
  completed epic's card is gold-bordered and its miniature shows the ignition.
  Above the grid: a summary line, a search box and quick-filter chips (§4.6).
- **Constellation view**: full-bleed canvas, stats overlay top-left (title, due
  date, progress, counts), search + Fit + label-density toggle top-right, legend
  bottom-left, ticket panel right.

### Navigation

The topbar is **brand · `← Galaxy map` (only inside a constellation) · source
label**. There is deliberately **no per-constellation tab list** — it does not
scale past a handful of epics. You reach a constellation by finding its card on
the galaxy map (search + filters), and you come back via the backlink, the brand,
or the browser's back button.

### Controls

Drag = pan · wheel = zoom at cursor · click star = open panel · double-click =
centre on it · `f` fit · `l` cycle label density (auto/all/minimal) · `b` jump to
next blocking ticket · `Esc` deselect. Panel relations are clickable and fly the
camera to that ticket.

---

## 4. Architecture and the algorithms that matter

```
src/
  model/types.ts     Domain model + derived helpers (progressOf, dueOf, …)
  model/dummy.ts     Deterministic fake galaxy (5 epics, ~200 tickets)
  model/derive.ts    Leaf → parent status roll-up
  model/source.ts    THE SEAM: GalaxySource { label, load() }
  lib/rng.ts         mulberry32 + FNV hash + rngFor(key)
  engine/layout.ts   Ticket tree → star positions (radial tidy tree)
  engine/theme.ts    Visual language: Visual → palette; link colours; UI colours
  engine/camera.ts   Camera maths, fit/focus, hit testing
  engine/renderer.ts Canvas painter (background, sunlight, links, stars, labels)
  components/ConstellationCanvas.tsx  Canvas host: rAF loop, pan/zoom, hover, select
  components/ConstellationScene.tsx   One constellation + overlays + panel
  components/GalaxyMap.tsx            Landing grid + summary, filters, search
  components/TicketPanel.tsx          Ticket detail
  components/Legend.tsx               Legend
  App.tsx                             Load, hash routing, layout memoisation,
                                      galaxy filter/search state
```

### 4.1 Domain model (`model/types.ts`)

```ts
Status = 'todo' | 'in_progress' | 'blocked' | 'done'
Level  = 0 | 1 | 2 | 3
Ticket { key, title, level, status, issueType, parent, blockedBy[], assignee?,
         storyPoints?, sprint?, dueDate?, updated, description, labels[] }
Constellation { id, epic: Ticket, tickets: Ticket[] }   // tickets = flat L1+
Galaxy { constellations[], sourceLabel, fetchedAt }
```

`progressOf(c)` → `{ done, total, ratio, inProgress, blocking, complete }`.
`blocking` counts *unfinished tickets that others are blocked by* — i.e. exactly
the red stars. `complete` drives the ignition.

### 4.2 Due dates (`model/types.ts`)

`Ticket.dueDate` is optional and Jira-shaped (`fields.duedate`, a plain
`YYYY-MM-DD` calendar day). Any ticket may carry one, but **the UI only reads the
L0 epic's** — that is the constellation's deadline. The panel will display a
`Due` row for whatever ticket you open if it has one.

```ts
DueState = 'clear' | 'soon' | 'overdue' | 'met'
DueInfo  = { date, days, state }        // days is negative once past
NEAR_DUE_DAYS = 14
dueOf(c, complete, now = new Date()): DueInfo | null
formatDue(d): string
```

- `complete` is a **parameter, not derived**, so callers that already ran
  `progressOf` don't walk the ticket list twice.
- **`met` beats `overdue`.** A finished constellation is never late, whatever the
  date says, and `formatDue` returns bare `"delivered"` — the date is dropped
  because nobody cares what the deadline was once it shipped.
- Colours: `clear` dim grey, `soon` amber `#ffb648`, `overdue` red, `met` green.
  Overdue red is the one place red does *not* mean "others are waiting on you";
  it is UI chrome only and never touches a star.
- `dueOf` compares against **real `now`**, which is correct for Jira but means
  the fixed dummy dates decay over time (see §5).

### 4.3 Status roll-up (`model/derive.ts`)

Applied in `source.load()`, so it holds for any source:

- leaf → its own status (this is what Jira will supply);
- all children done → `done`;
- any child `in_progress` or `done` → `in_progress`;
- else any child `blocked` → `blocked`;
- else `todo`.

Memoised, immutable (returns new tickets, so optional fields like `dueDate`
survive the spread). `dummy.ts` deliberately does **not** roll up any more — it
only generates leaf statuses.

### 4.4 Layout — radial tidy tree (`engine/layout.ts`)

This is the piece that fixed "paths overlap for no reason". There is **no
force relaxation any more**; structure is guaranteed by construction.

- Every subtree owns an **angular wedge**, sized proportionally to its leaf
  count (`weightOf`). Descendants are placed strictly inside that wedge, so
  parent→child lines from different subtrees **cannot cross**.
- Deeper levels use 86% of the parent's wedge (`usable`), leaving a gutter
  between neighbouring subtrees.
- **Sibling order** (`orderSiblings`): union-find groups siblings connected by
  `blockedBy`, largest group first, each group ordered topologically (Kahn) from
  blocker → blocked. Result: dependency chains are angular neighbours, so most
  dependency arcs are short and follow the ring instead of crossing the map.
- **Tiering**: within a wedge, children alternate `i % 2` between the base ring
  and 24% further out, which doubles the room available for labels.
- Constants: `SUN_RADIUS = 46`; radius ratios `{1: 0.3, 2: 0.2, 3: 0.14}`;
  `RING_GAP = {1: 300, 2: 200, 3: 125}`; `ARC_PER_LEAF = 86`.
  The first ring is pushed out so the *outermost* ring still has room:
  `ring1 = clamp(260, totalLeaves * 86 * 0.62 / 2π − (200+125)/2, 1500)`.
- Small seeded jitter (±0.07 radial, ±12% of the slot angularly) keeps it
  organic rather than mechanical.
- `StarNode.blocks` counts dependents — the renderer's red state reads it.
- Output: `{ nodes, byKey, links, extent }`. `extent` is used for camera fitting
  and for sizing the ignition wash.

### 4.5 Rendering (`engine/renderer.ts`)

Frame order: background (nebulae + 900 parallaxed twinkling stars) → **sunlight
wash** (only when complete) → links (children first, dependencies on top) →
stars → labels. **Due dates are not rendered on the canvas** — they live only in
the surrounding UI chrome.

**Visual state** (`visualOf`) — this is the semantic core:

| Visual | When | Look |
| --- | --- | --- |
| `lit` | status done | gold, softer core but the widest halo, small diffraction spikes |
| `blocking` | not done, `blocks > 0`, not started | red, steady, brightest core on the map, tight halo |
| `blocking_active` | not done, `blocks > 0`, in progress | as `blocking`, breathing red ↔ amber ~2s |
| `igniting` | in progress, blocks nothing | blue flicker, tight halo |
| `unlit` | otherwise | grey body, bright rim, faint halo |

A palette entry may carry `pulseTo`, a second colour the star cycles towards on
the *same wave* as its brightness (`pulseWave` → `brightness` + `mixHex`), so a
pulse can carry a direction instead of just blinking. Only `blocking_active`
uses it: it breathes towards **amber**, which already means "blocker in progress"
on the dependency arcs, so the star reads as on its way out of red. It must never
breathe towards the done gold — that colour is the reward (principle 3).

`pulseSkew` is the exponent applied to that colour mix, and it is not
decoration. At `1` the two colours split the cycle evenly, and the second colour
still wins the star: it is the more luminous of the pair *and* it lands on the
bright half of the pulse, while the base colour only ever appears at the dim
end. The first version shipped without it and read as a yellow star. At `4` the
mix averages ~0.27 and spends ~26% of the cycle past halfway, so the star is red
with an amber flash at the crest — which is the intended reading: **red is the
state, amber is only the hint that it is moving.** Lower it for more amber.

**Dependency arcs** take the colour of the **blocker's** status: red (not
started) → amber (in progress) → green (done). Dashes animate blocker → blocked;
speed increases as the path clears. Geometry: the control point is pushed
radially outward to just past the average orbit of the two endpoints
(`dependsControlPoint`), giving an arc that hugs the ring; each edge gets a
stable "lane" offset (`laneOf`, hashed) so parallel arcs don't lie on top of each
other. Both endpoints are trimmed to the star's edge (`trim`).

**Sun** — `flamePath()` is a sum-of-sines wobbling outline (not a circle);
inside it, clipped, four hot cells and four cooler spots drift to make it churn.
`warm = 0.2 + progress*0.45` only warms the embers. `ignition(st)` is 0 unless
`complete`, then smoothsteps 0→1 over `(time − 0.4)/2.2` seconds — so opening a
finished constellation plays the ignition. `drawSunlight()` adds the wash sized
to `layout.extent`, 30 slowly-rotating soft rays, and three expanding light
rings.

**Labels** (`planLabels`) — every label is drawn, none dropped. Each star tries 8
compass anchors and picks the lowest cost: `3× overlap with already-placed
labels + 2× overlap with star discs + 140×(1 − outwardness) + 90 if centred`.
Sun and focused stars are placed first. Auto density only hides text that would
be unreadably small (`L3 < 0.75`, `L2 < 0.45`, `L1 < 0.22` camera scale).

### 4.6 Galaxy map (`components/GalaxyMap.tsx`)

- Each constellation is reduced once, in a `useMemo`, to a `Row = {c, p, due}`;
  everything below reads that. Note the memo also freezes `new Date()` for the
  session, which is fine and keeps the chips stable.
- **Headline totals exclude completed constellations** (principle 12). It reads
  `N constellations in flight · done/total stars lit · X blocking · Y overdue ·
  Z shipped`, with a small note saying completed ones are left out — the
  exclusion is deliberate, so it should not look like a bug.
- **Quick filters**: `all | blocking | soon | overdue | complete`, single-select.
  Each chip shows its count, is disabled at zero, and clicking the active chip
  returns to `all`. Add a new one by extending `GalaxyFilter`, the `FILTERS`
  array and the `matches()` switch — three places, all in this file.
- **Search** matches epic title, epic key and the constellation id (the hash
  slug), so `tax`, `TAXENG` and `tax-engine` all work.
- Filter and query state lives in **`App.tsx`, not here**: the map unmounts while
  you are inside a constellation, and coming back to a reset filter is annoying.
- When nothing matches, an empty state offers a "Clear filters" button rather
  than leaving a blank page.

### 4.7 Canvas host (`components/ConstellationCanvas.tsx`)

- Single `requestAnimationFrame` loop; React state never drives a frame. Props
  are mirrored into a ref (`stateRef`) each render.
- Camera lives in a ref; `targetRef` + 0.16 lerp gives smooth fit/focus flights.
- Hover is tracked in a ref and only lifts to React when the key changes.
- Focus dimming: hovering/selecting builds a set of {self, parent, children,
  blockers, dependents}; everything else drops to 0.22 alpha.
- DPR-aware sizing via `ResizeObserver`; `interactive={false}` for previews.
- `cameraRequest: {kind: 'fit'|'focus', key?, nonce}` — bump `nonce` to re-fire.

---

## 5. Dummy data (`model/dummy.ts`)

Five epics, fully deterministic (seeded by epic id). Per-epic knobs:
`completion` (status mix), `friction` (how often things end up blocked) and
`dueInDays` (offset from `BASE`, omit for no deadline).

| id | key prefix | shape | due | why it exists |
| --- | --- | --- | --- | --- |
| `unified-checkout` | AETCOE-124xxx | 10 workstreams, L2, 44 tickets, 18% lit | +47 → clear | the everyday case |
| `tax-engine` | TAXENG-84xx | 41 tickets, 61% lit | +9 → soon | a healthy mid-flight project |
| `merchant-onboarding` | ONBRD-21xx | **L3 present**, 64 tickets, 9% lit, high friction | −6 → overdue | proves depth + a blocked mess |
| `vault-rotation` | VAULT-31xx | 30 tickets, **100% done** | −20 → met | the ignition / "wow" demo; also proves done beats late |
| `observability` | OBSRV-77x | 24 tickets, 67% lit | none | proves the deadline is optional |

Everything is dated relative to `BASE = 2026-09-03T09:00:00Z`.

Totals: **203 stars, 85 lit, 33 blocking** across the galaxy; the headline shows
the in-flight subset, **173 stars, 55 lit, 33 blocking, 1 overdue, 1 shipped**.
If those numbers change without you touching `dummy.ts`, something in the seeding
or the roll-up drifted.

⚠️ **The due dates decay.** They are fixed, but `dueOf` compares against real
`now`, so as real time passes `tax-engine` will slide from "soon" into "overdue"
and `unified-checkout` into "soon". That is correct behaviour for Jira and wrong
only for the fixture — if the demo stops showing one of each state, re-anchor
`BASE` and the `dueInDays` values rather than "fixing" `dueOf`.

Rules the generator respects: a ticket is never `done` while a blocker is open;
L1s occasionally depend on an earlier L1; L2s usually queue behind the previous
sibling. Parent statuses are **not** set here (see §4.3).

---

## 6. Decisions made (and why) — don't relitigate blindly

- **Canvas 2D, no D3/vis library.** Full control of the glow/ignition look, and
  ~200 animated stars stay at 60fps. Cost: hit testing and labels are hand-rolled.
- **Per-constellation tabs were removed** from the topbar: the list grows with
  the number of epics and would not survive a real Jira label. Search + filters
  on the galaxy map replace them. Don't add them back.
- **Layout computed once per epic** in `App.tsx` `useMemo`, cached in a Map.
  Never recompute per frame.
- **Force relaxation was removed** in favour of the tidy tree. If you reintroduce
  any physics, keep the wedge constraint or the crossings come back.
- **Label hiding was tried and rejected** by the user. Anchors + spacing instead.
- **Rotating cross spikes on the sun were rejected** ("looks like a cross") —
  replaced by the churning fireball. Keep spikes tiny and only on done stars.
- **`blocked` status still exists in the model** but is no longer a distinct
  star colour; the coloured dependency path carries that meaning. The panel
  still shows the true Jira status.
- **Due dates stay out of the canvas.** They are a project-level fact, not a
  property of a star, and the renderer's colour vocabulary is already fully
  spoken for.

---

## 7. Known gaps / next steps

**Immediate next phase — Jira.** All of it goes behind `GalaxySource` in
`model/source.ts`; nothing else changes.

1. A browser can't call Jira directly (CORS, and the PAT must not ship in the
   bundle) → add a thin local proxy (Vite middleware or a small Node server)
   holding the token in an env var and exposing `GET /api/galaxy`.
2. Discover epics: `jql=labels = "constellation" AND issuetype = Epic`.
3. Pull each tree: either `parent = <epicKey>` recursively, or one query per epic
   on an epic-specific label (single round trip, depth-agnostic, covers L3 free).
4. Map: `fields.status.statusCategory.key` → todo/in_progress/done;
   `fields.issuelinks` with `type.inward === "is blocked by"` → `blockedBy[]`;
   `fields.parent.key` → `parent`; **`fields.duedate` → `dueDate`** (already a
   plain `YYYY-MM-DD`, so it maps straight across); story points are usually
   `customfield_10016` (verify on your instance).
5. Pass the result through `deriveGalaxy()` — never trust parent statuses.

**Deployment — Docker (planned, not built).** The intent is to run this in a
container so the URL can be bookmarked and checked over time. Two things it must
get right or the bookmark dies anyway: a restart policy
(`restart: unless-stopped`), and Docker Desktop set to start at login on macOS.
Serve the built `dist/` rather than the dev server.

**Open questions for the team**

- Label vs. `parent` traversal for discovery (label is simpler but relies on
  people applying it).
- Which Jira states count as `blocked` — only leaves need the mapping.
- Is 14 days (`NEAR_DUE_DAYS`) the right "due soon" window for the team's
  cadence? It was a default, not a decision.
- Should a near/overdue deadline show up on the **constellation canvas** at all,
  or is the overlay enough?
- Refresh model: load-only, or poll every N minutes with a "last synced" stamp
  (`Galaxy.fetchedAt` and `sourceLabel` already exist for this).

**Deliberately not built yet**

- No tests (the visual layer is validated by screenshotting in a browser).
- No persistence, no per-user settings, no deep-link to a single ticket
  (route is per-constellation only). Galaxy filter/search state is in memory
  only — it is not in the URL, so it can't be bookmarked or shared.
- Galaxy previews all animate continuously — fine for ~5 cards, would need
  pausing off-screen if the list grows large.
- No mobile layout beyond a `max-width: 900px` fallback that hides the legend.
  The new galaxy header wraps but has not been checked at that width.
- Level is taken from the ticket tree depth; L3 is rendered but the team doesn't
  use it yet.

---

## 8. Working notes for the next session

- Dev server may already be running on a non-default port (`--port 5199` has been
  used across sessions). `npm run dev` is otherwise 5173.
- When screenshotting through Playwright to check a change, navigate with a
  cache-busting query (`http://localhost:5199/?v=9#/unified-checkout`) — a
  hash-only change does not reload the page and you will screenshot stale code.
- Playwright MCP can only write inside the project root, so screenshots land in
  `.playwright-mcp/` (now gitignored). Clean up after yourself.
- `npx tsc -b` is the fast correctness check; `npm run build` runs it too.
  `npx oxlint` currently emits two **pre-existing** warnings
  (`ConstellationScene` set-state-in-effect, `ConstellationCanvas` ref-in-render).
  They are not regressions — don't be alarmed, and don't "fix" them casually.
- Visual constants worth knowing: background `#010207`, accent/gold `#ffc247`,
  blue `#37a8ff`, red `#ff5c4e`, green `#52e0a4`, due-soon amber `#ffb648`.
  Camera scale is clamped to `[0.12, 4]`; `fitCamera` uses a 90px margin; focus
  flights go to 1.25 (0.8 for the sun).

---

## 9. What changed since the first checkpoint

All of it is UI + model; the renderer, layout, camera and RNG were not touched.

**Due dates**
- `Ticket.dueDate?` added; `DueState`, `DueInfo`, `NEAR_DUE_DAYS`, `dueOf()` and
  `formatDue()` added to `model/types.ts` (§4.2).
- `dummy.ts`: `BASE` extracted, `dueInDays` per epic spec, four of five epics
  given a deadline covering clear / soon / overdue / met, one left without.
- Shown on the galaxy card stats row, in the constellation stats overlay under
  the title, and as a `Due` row in `TicketPanel` for any ticket that has one.

**Galaxy map**
- Headline totals now exclude completed constellations, and gained `overdue` and
  `shipped` counts plus an explanatory note.
- Quick-filter chips with counts, and a constellation search box.
- Empty state with a "Clear filters" action.
- Filter/query state lifted into `App.tsx` so it survives a trip into a
  constellation and back.

**Navigation**
- Per-constellation tabs deleted from the topbar (`.tabs` CSS removed).
- `← Galaxy map` backlink shown in the topbar while inside a constellation;
  `.source-label` now right-aligns itself with `margin-left: auto`.

**Progress bar**
- Blue while incomplete, gold only at 100% (`.progress-bar.complete`), on both
  the galaxy cards and the constellation overlay.

**Star palette** — tuned live with the user; these are the signed-off values.
- Final intensities: `igniting` 0.52 → **0.66**, `blocking` 0.40 → **0.88**,
  `blocking_active` 0.46 → **0.88**, `lit` 0.82 → **0.70**. Note `lit` ended up
  *lower* than it started — see principle 2; the blockers took the top slot on
  purpose. `unlit` stays at 0.10 and must.
- `glowSize` / `glowAlpha` added to `StarPalette`. Final state of the map, in
  units of star radius:

  | | halo | halo alpha | core alpha |
  | --- | --- | --- | --- |
  | `igniting` | 2.42r | 0.14 | 0.76 |
  | `blocking` | 3.10r | 0.22 | 0.85 |
  | `blocking_active` | 3.27r | 0.24 | 0.85 |
  | `lit` | 3.99r | 0.21 | 0.78 |

  The blockers are the brightest thing on the map in both core and halo; `lit`
  keeps the widest halo but the softest one. That ordering is the design — if a
  future change puts `lit` back on top of the blockers, it has broken
  principle 2, not fixed it.
- `blocking_active` now breathes red ↔ amber via the new `pulseTo` mechanism
  (§4.5) instead of pulsing red at constant hue, `pulseRate` 0.85 → **3**
  (~7.4s per breath → ~2.1s; at 0.85 people simply did not notice it), and
  `pulseSkew: 4` because the first cut of that pulse read as a yellow star
  rather than a red one.

**Verification status:** the galaxy map, the due-date states and the Overdue
filter were confirmed by screenshot; the blue progress bar and green "delivered"
were confirmed by the user. The palette values above were tuned over two rounds
of live feedback from the user rather than by screenshot — "bright enough" and
"fast enough to notice" are calls only a human watching the map can make.
