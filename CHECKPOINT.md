# Checkpoint — Constellation

Updated 2026-09-14 (fourth checkpoint). **The Jira connection is built.** The app
no longer runs on dummy data: it reads real epics from Jira through a small
server-side adapter, and the fixture has moved *behind* that adapter as a
`CONSTELLATION_SOURCE=dummy` debug mode. Blocked leaves also gained an orbiting
**debris belt** (§9), the third visual channel after brightness and halo spread.

Read this file plus `README.md` (user-facing) and you should be able to pick the
work up cold. §9 lists exactly what changed, §10 is the state of play, and §11 is
the Jira adapter in detail.

> ⚠️ **Two things to check before trusting anything below.** The adapter has only
> ever run against a **stub Jira** (§9) — no real credentials have been used, so
> every field mapping is verified in shape but not against your instance. And the
> dummy due dates have now **expired** (§5): the "due soon" demo state is dead and
> two constellations read overdue.

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

Data comes from Jira via an API token, discovering epics by label (§11). The
design was validated on dummy data first; that fixture still exists as a debug
mode.

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
14. **One seam for data.** The UI only ever sees the domain model. All of Jira's
    shape stays in `server/`; the client has one code path whatever the source.
15. **A ticket's own state and its effect on others are different channels.**
    Colour is reserved for effect on others (principle 1), so "this ticket is
    itself stuck" could not be a colour. It became an orbiting belt of debris —
    a third channel, orthogonal to brightness and halo spread, that composes with
    whatever the star already is (§9). Grey, deliberately: a red belt around a
    red blocking star merges into one blob and costs both readings.

---

## 3. What exists and how to run it

```bash
cd project-constellation
npm install
cp .env.example .env # JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN
npm run dev          # http://localhost:5173 — API is Vite middleware
npm run build        # dist/ (browser) + dist-server/ (API); tsc -b runs first

CONSTELLATION_SOURCE=dummy npm run dev   # no Jira needed

docker compose up -d # or `podman compose` — two containers, serves on :8080 (§7)
```

Stack: **Vite 8 + React 19 + TypeScript**, canvas 2D rendering, **no graph or
animation libraries**, and **zero runtime dependencies on the server** — the
bundled adapter imports only `node:http`. It is no longer a pure static SPA: the
browser cannot call Jira directly (§11), so a small API ships beside it.

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
  model/source.ts    THE SEAM: GalaxySource — fetches /api/galaxy
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
  App.tsx                             Load/error/empty states, hash routing,
                                      layout memoisation, filter/search,
                                      refresh + diagnostics banner

server/              THE JIRA ADAPTER — never reaches the browser (§11)
  config.ts          Env parsing, validation, base-URL normalisation
  jira.ts            REST client: auth, pagination, endpoint fallback, errors
  galaxy.ts          Jira JSON → domain model
  cache.ts           TTL + single-flight
  handler.ts         The one route, shared by dev middleware and production
  main.ts            node:http entry (production only)
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
only generates leaf statuses, and neither does the Jira adapter: every source
hands over raw leaves and the client rolls up.

**This ordering was deliberately left alone.** Hoisting `blocked` to the top was
considered and rejected: `visualOf` treats anything that is not done and not
in_progress as `unlit`, so a workstream 80% finished with one blocked descendant
would have gone grey and read as *not started*. With the current order a parent is
only `blocked` when no child is `in_progress` **and** none is `done` — i.e.
nothing under it has started — which is exactly when `unlit` is honest.

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

⚠️ **The fixture now lives behind the API**, not in the browser bundle:
`CONSTELLATION_SOURCE=dummy` makes `/api/galaxy` serve it. It was kept
deliberately — `vault-rotation` is the only 100%-complete constellation in
existence and therefore the only way to exercise the sun's ignition, and
`merchant-onboarding` is the worst case for render load. Switching is an env var
and a restart, not a rebuild.

⚠️ **The due dates decay, and the deadline has now passed.** The offsets are
fixed but `dueOf` compares against real `now`, which is correct for Jira and
wrong for a fixture. As of 2026-09-10 the fixture reads:

| id | resolves to | days out | state |
| --- | --- | --- | --- |
| `unified-checkout` | 2026-10-20 | +40 | clear |
| `tax-engine` | 2026-09-12 | **+2** | soon |
| `merchant-onboarding` | 2026-08-28 | −13 | overdue |
| `vault-rotation` | 2026-08-14 | −27 | met |

**This has now happened.** `tax-engine` tipped into overdue on 2026-09-12, so as
of 2026-09-14 the fixture reads **2 overdue** and the "Due soon" chip shows 0 and
disables itself — confirmed on screen. The feature is fine; the fixture is out of
date. Fix by re-anchoring `BASE` to today and keeping the offsets — do **not**
"fix" `dueOf` to compare against `fetchedAt`, which would be wrong the moment real
Jira data arrives.

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
- **The server returns the domain model, not raw Jira.** The alternative — a
  pass-through proxy with the mapping on the client — would put `customfield_*`,
  `statusCategory` and ADF parsing in the bundle for no gain.
- **Not a general Jira proxy.** One read-only route, one shape. A route that
  forwarded arbitrary Jira paths would hand anyone who can reach the app the full
  power of the token, including writes.
- **`CONSTELLATION_SOURCE` is a server-side switch**, so the client has exactly
  one code path. The alternative (client picks its source) would need the mode
  shipped into the bundle or a second round trip.
- **Dummy data stayed.** Deleting it would leave no way to exercise the ignition
  or the render worst case until Jira happens to supply a finished epic.
- **The belt is not a `Visual`.** It reads `ticket.status` directly, so
  `visualOf`, the `Visual` union and the signed-off `STAR_PALETTE` are untouched
  and it composes with whatever the star already is.

---

## 7. Known gaps / next steps

**Jira — built.** See §11 for the adapter in detail. In summary: `server/` holds
the token and does the mapping, nginx proxies `/api/` to it, and `model/source.ts`
fetches `/api/galaxy`. Configuration is runtime env (`.env`), never build-time.

**Deployment — Docker (built).** `docker compose up -d` builds and serves on
`:8080`; see the README's "Deploy it" section for the operator-facing detail.
Files: `Dockerfile`, `docker-compose.yml`, `docker/nginx.conf`, `.dockerignore`,
`.env.example`. **Two services now**: `constellation` (nginx, the only published
port) and `constellation-api` (the adapter, no published port).

Notes for whoever touches it next:

- Two-stage build: `node:24-alpine` compiles, `nginx:1-alpine` serves. The final
  image is ~70 MB and carries no source or toolchain. `npm run build` runs
  `tsc -b` first, so **a type error fails the image build** — that is deliberate.
- **The target host runs Docker; local dev here runs Podman.** Keep it working on
  both: image names are fully qualified (Podman prompts on short names, Docker
  does not) and nothing engine-specific is used.
- The health check is in `docker-compose.yml`, *not* the Dockerfile. Podman
  builds OCI-format images and drops a Dockerfile `HEALTHCHECK` with only a
  warning, so putting it there would mean it silently existed on AWS only.
- `restart: unless-stopped` is load-bearing: it is what makes the bookmarked URL
  survive a host reboot.
- Cache policy is split in `nginx.conf`: fingerprinted `/assets/` are
  `immutable` for a year, `index.html` is `no-cache`. Do not cache `index.html`
  — a stale copy points at asset filenames that no longer exist and the page
  comes up blank after a redeploy.
- Verified on Podman 5.8.1: image builds, container reports `healthy`,
  `index.html` `no-cache`, assets `immutable` + gzipped, unknown paths fall back
  to `index.html`, missing assets 404.

**Settled since the third checkpoint**

- *Discovery*: level-wise `parent in (...)` walk, not a per-epic label. No
  process discipline required below the epic.
- *Blocked*: comes from issue links, never from a status — that is how the team
  works. A `blocked` **status** also exists and is configurable, but it means
  only "this ticket is stuck", not "others are waiting".
- *Refresh*: manual button plus a `synced HH:MM` stamp off `Galaxy.fetchedAt`.

**Open questions for the team**

- **Which link types?** `Blocks` exists in the instance; **there is no `Depends`
  link type** — 22 types are configured and none is called that. If a second type
  is in use it goes by another name, and if its outward phrase reads "depends on"
  it must go in `JIRA_DEPENDS_LINK_TYPES` or every arrow it produces is reversed.
- Is 14 days (`NEAR_DUE_DAYS`) the right "due soon" window for the team's
  cadence? It was a default, not a decision.
- Should a near/overdue deadline show up on the **constellation canvas** at all,
  or is the overlay enough?
- Polling instead of the manual refresh, if this ends up on a wall screen.
- `TicketPanel`'s `blocked` badge/dot are **red** (`.badge-blocked`,
  `.dot-blocked`) while the map now says grey debris. Pre-existing, but the belt
  makes it an inconsistency against principle 13. Move them to the belt grey?

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
- **`npm run diagnose`** is the first thing to run on any "why is it empty"
  question — it reuses `server/config.ts`, so what it prints is what the app
  sends, not a re-implementation that can disagree.
- **Testing the adapter without credentials.** A ~120-line stub Jira (a
  `node:http` server that answers `POST /rest/api/3/search/jql` from a fixture)
  is how every field mapping in §11 was verified: point `JIRA_BASE_URL` at it and
  run `node dist-server/main.js`. It covered the level-wise walk, both link
  directions, a reversed link type, a cross-epic link, ADF descriptions, story
  points, L4 clamping, an unmapped status and 401 handling. **It was not
  committed** — it lived in a scratch directory — so it needs rewriting if the
  adapter is iterated on without a live instance. Worth committing next time.
- The api runs standalone: `CONSTELLATION_SOURCE=dummy PORT=8199 node
  dist-server/main.js`, then `curl localhost:8199/api/galaxy`. Faster than the
  browser for checking a mapping change.
- Visual constants worth knowing: background `#010207`, accent/gold `#ffc247`,
  blue `#37a8ff`, red `#ff5c4e`, green `#52e0a4`, due-soon amber `#ffb648`.
  Camera scale is clamped to `[0.12, 4]`; `fitCamera` uses a 90px margin; focus
  flights go to 1.25 (0.8 for the sun).

---

## 9. What changed in the fourth checkpoint

Layout, camera and RNG were untouched except for one bug fix (below). The
renderer gained one new draw pass and changed nothing about the existing ones.

**The Jira adapter — the headline.** New `server/` directory, detailed in §11.
`model/source.ts` is now a single `apiSource` hitting `/api/galaxy`; `dummySource`
is gone from the client and the fixture is served by the API instead.

**Blocked belts** (`engine/theme.ts` `BELT`, `engine/renderer.ts` `drawBelt` /
`drawBelts`, `Legend.tsx`, `.legend-star-blocked`).
- Leaves only. A parent's status is a roll-up, so belting parents would ring a
  whole subtree because one sub-task is stuck.
- One dashed ellipse with an animated `lineDashOffset`, not N particle arcs: one
  path per blocked star and no `shadowBlur`, which is the expensive call in that
  file. Because dashes are spaced by arc length, a squashed ellipse makes them
  quicken along the long edges — which is what sells it as an orbit.
- Signed-off values: `radius` 3.4r (clears `blocking`'s ~3.2r halo), `squash`
  0.35, `chunks` 24, `duty` 0.38, `period` 12s, `maxLineWidth` 2.4,
  `minScreenRadius` 9px, colour `#c2cde8` at 0.5 alpha.
- Two things were tuned, not guessed: at 14 chunks the belt read as a **dashed
  selection outline** when zoomed in, and without the width cap it became a heavy
  ring competing with the star. Both were found by looking at it.
- A circle reads as a **loading spinner** — "the app is fetching" — which is why
  it is a tilted ellipse turning slowly. Do not speed it up.

**Model** (`model/types.ts`)
- `Ticket.blockedByExternal?` / `blocksExternal?` — dependencies crossing between
  constellations (§11). `blockersOf()` now counts external dependents, or a
  ticket blocking another project would be missing from the galaxy headline.
- `Galaxy.diagnostics?` (`SourceDiagnostics`) — what the source noticed.

**Client**
- `App.tsx`: loading / error / **empty** states (zero epics is a legitimate
  answer, not a failure), a manual Refresh with a `synced HH:MM` stamp, and a
  diagnostics banner. A failed *refresh* keeps the galaxy it already had and
  shows a warning strip rather than throwing away a working map.
- `TicketPanel`: external dependencies listed as inert text rows; the "waiting
  on N" banner counts them, since their status is not knowable from here.
- `GalaxyMap`: "1 star" rather than "1 stars" — real data can have one ticket.

**Bug fixed in `engine/layout.ts`.** `const level = parentNode.level + 1` read
`RING_GAP[4]` for a level-3 parent. Jira hierarchies can be deeper than the four
levels the model has sizes for, so the source clamps `Ticket.level` at 3 — which
makes a level-3 parent with level-3 children possible for the first time. The
`undefined` gap produced `NaN` distances, the NaN propagated into `layout.extent`,
and **the entire canvas rendered blank**. The lookup is now clamped too. Dummy
data could never have caught this: its L3 nodes are always leaves.

**Build**
- `npm run build` now also emits `dist-server/` via `vite build --ssr`. The bundle
  imports only `node:http`, so the api image carries no `node_modules`.
- New `tsconfig.server.json` (bundler resolution — `tsconfig.node.json` is
  `nodenext`, which rejects the extensionless imports `src/` uses).
- `.env` and `dist-server` gitignored; `.env` also excluded from the build context.

**Verification status.** The belt was confirmed by screenshot at fit and at zoom
on `merchant-onboarding` (10 blocked leaves), and absent from the galaxy
miniatures as intended; 144fps there, i.e. pinned to the display refresh with no
dropped frames. The adapter was verified against a **stub Jira** covering the
level-wise walk, both link directions, a reversed link type, a cross-epic link,
ADF descriptions, story points, L4 clamping, an unmapped status, 401 handling and
the auth header format — plus a check that the token appears in no log. The
container path was verified on Podman 5.8.1: both images build, `api` reports
healthy before nginx starts, `/api/galaxy` proxies, one `Cache-Control` header,
no published port on the api, 12s cold start. **No real Jira credentials have been
used**, so the field mappings are verified in shape only.

## 10. State of play — read before deploying

**The container files are committed now** (they were untracked at the third
checkpoint — that warning is resolved). New files this round that must be staged:
`server/`, `tsconfig.server.json`, `.env.example`.

**`.env` is gitignored and must never be committed** — it holds the API token,
which is unscoped and equivalent to your account password across Jira and
Confluence. `.dockerignore` excludes it from the build context too, so it cannot
end up in an image layer.

**First contact with real Jira (2026-09-16).** The adapter ran against the live
instance and found nothing, with the app reporting "No epics found". The cause
was **not** the query: Jira answers an unaccepted credential by serving the
request **anonymously** instead of refusing it, announcing that only in an
`x-seraph-loginreason: AUTHENTICATED_FAILED` header. Search then returns `200`
with zero issues — an anonymous caller can browse none of the 803 projects — so
a rejected token was indistinguishable from a label that matches nothing.

Confirmed by probe: `/myself` 401, `mypermissions` reporting
`BROWSE_PROJECTS: havePermission: false`, `/project/search` total 0, and the
seraph header present on *every* response including the 200s. The auth header
itself was well formed (no wrapping, no stray whitespace, token a clean
192-char `ATATT3x…`), and Bearer auth returned 403 — so the credential, not the
code. **`server/jira.ts` now checks that header** and raises the real error, and
`npm run diagnose` (`server/probe.ts`) exists to answer this class of question
in one command. The empty state also shows the JQL that ran.

Lesson worth keeping: a `200` from Jira does not mean the request was
authenticated.

**Not yet done, in the order it probably matters:**

1. **Get a working token**, then run the adapter against real Jira. Nothing below is in doubt structurally,
   but every field mapping has only met a stub. Expect to iterate on
   `JIRA_STATUS_*` (the diagnostics banner will name the unmapped ones for you)
   and on the story-points field id.
2. **Settle the second link type** (§7). There is no `Depends` type in the
   instance, so this is the one open question that can silently produce *wrong*
   arrows rather than missing ones.
3. Re-anchor the dummy due dates (§5) — the "due soon" demo state has expired.
4. Decide on the red-vs-grey `blocked` badge inconsistency in `TicketPanel` (§7).

**Unverified claims worth a moment's scepticism.** The README says the render loop
holds "170+ animated stars at 60fps". The belt pass measured 144fps on
`merchant-onboarding`, but that is the display's refresh ceiling, not headroom —
nobody has measured how much slack is left. `vault-rotation` (30 done stars at
3.99r halos, plus the ignition wash) remains the worst case and has no belts at
all, so it is untouched by this round.

---

## 11. The Jira adapter

### Why a server exists

A browser cannot call Jira directly, for two independent reasons, and it is worth
being precise because the second one is the easier to get wrong.

1. **CORS is enforced by the browser, not by Jira.** A `fetch` to
   `*.atlassian.net` carries an `Authorization` header, which makes it a
   non-simple request, so the browser sends a preflight `OPTIONS` first. Atlassian
   Cloud's REST API does not answer that with our origin allowed, so the browser
   discards the response — even though Jira answered it correctly. Being
   authenticated is irrelevant; authentication and origin policy are separate
   gates, and a correctly-authenticated cross-origin read is exactly what CORS is
   strictest about. `mode: 'no-cors'` does not help: the response is opaque.
2. **The token cannot ship in the bundle.** An Atlassian API token is **not
   scoped** — it carries the account's full permissions across Jira and
   Confluence. And `import.meta.env.VITE_*` values are substituted into the JS
   *text* at build time, so they are string literals in a file nginx serves to
   anyone. `VITE_` variables are not secrets. This is the trap.

Server-to-server HTTP has no concept of an origin, so the hop sidesteps CORS
entirely and keeps the credential on the host.

### Shape

```
browser ──> nginx :80 ──┬── /            static dist/
                        └── /api/  ────> constellation-api :8081
                                             │ Authorization: Basic …
                                             ▼
                                         verifone.atlassian.net
```

`handler.ts` is mounted as **Vite middleware** in dev and served over `node:http`
in production — the same module at the same URL, so "works locally" and "works on
the host" cannot drift. `vite.config.ts` loads it via `ssrLoadModule`, so editing
the server hot-reloads.

The dev plugin reads `.env` with `loadEnv(mode, cwd, '')` — the empty prefix is
deliberate, because the variables must **not** be `VITE_`-prefixed.

### How a galaxy is built (`server/galaxy.ts`)

1. One JQL search for the epics. **The instance rejects unbounded JQL**, so the
   query always carries a restriction. `JIRA_EPIC_JQL` overrides the default
   label query outright — that is the escape hatch for before the label exists.
2. Walk each tree level by level: `parent in (<keys from the level above>)` until
   a level returns nothing. `parent = <epic>` alone reaches only L1. Depth-agnostic,
   one round trip per level, no label discipline needed below the epic. A `seen`
   set guards against a cyclic hierarchy re-querying forever.
3. Map fields. Status: `status.name` against `JIRA_STATUS_*` first, else
   `statusCategory.key`. `blocked` is unreachable by fallback — Jira has no such
   category — so it comes only from `JIRA_STATUS_BLOCKED`. `description` is ADF
   and is flattened to text. Level is tree depth, clamped to 3 and counted.
4. Dependencies from issue links only. **Both directions are read**, so every
   link surfaces twice (once from each end) and is de-duplicated by
   `blocker>blocked`. Reading both ends also means a link survives when only one
   of its two issues is inside the fetch.
5. `deriveGalaxy()` runs on the **client**, so every source gets the same roll-up.

### Link direction — the thing to get right

For a link on issue X, Jira gives either `outwardIssue` or `inwardIssue`, and that
is the discriminator:

| Entry on X | Reads as | Blocker |
| --- | --- | --- |
| `outwardIssue: B`, type in `JIRA_BLOCKS_LINK_TYPES` | X *blocks* B | X |
| `inwardIssue: B`, type in `JIRA_BLOCKS_LINK_TYPES` | X *is blocked by* B | B |

A type phrased the other way round — an outward phrase of "depends on", where the
*outward* issue is the dependent — belongs in `JIRA_DEPENDS_LINK_TYPES`, which
flips the mapping. **Putting a type in the wrong list reverses every arrow it
produces**, which is a silent, plausible-looking error. Check the phrasing in
Jira Settings → Issues → Issue linking.

### Cross-constellation dependencies

`engine/layout.ts` positions one constellation at a time, so a link to a ticket in
another epic has no coordinates to draw to. The naive fix — filter it out at
ingest — is wrong in one direction and it matters:

- *Our ticket is blocked by an outsider*: mild. Colour means effect on others
  (principle 1), so it does not change this star; only the panel loses the reason.
- *An outsider is blocked by our ticket*: **our ticket genuinely is a blocker and
  should be red**, but the link record lives in the other constellation's
  `blockedBy`, so this layout would never see it. `blocks` stays 0, the star
  renders grey `unlit`, and the galaxy's "blocking" headline under-reports.

So: counted, not drawn. `blocksExternal` folds into `StarNode.blocks` (the star
goes red correctly, no geometry change), `blockersOf()` counts it, and
`TicketPanel` lists it as an inert text row. The team says this never happens in
practice; it is built so that it cannot be silently wrong if it starts to.

### Caching and failure

TTL cache with **single-flight**: three people opening the standup screen at once
produce one Jira fetch. `?refresh=1` bypasses it. Failures are deliberately **not**
cached, so a fixed credential takes effect on the next request rather than after
the TTL.

- Missing config fails at boot **and** is served over HTTP, so a
  misconfiguration shows up in the app rather than only in container logs.
- `PORT` is read independently of config validation. It was not, at first — and a
  misconfigured container bound the wrong port, so nginx got a connection failure
  instead of the actionable message, defeating the point.
- `/healthz` is independent of the Jira config on purpose: when credentials are
  wrong the container's job is to *serve the error*, so it must come up healthy
  in order to do it.
- 401/403/429 map to messages naming what to check. The token appears in no log
  and no response body.
- `search()` tries `POST /rest/api/3/search/jql` (token paging) and falls back
  once to `POST /rest/api/3/search` (offset paging) on 404/410, remembering which
  the instance speaks. Atlassian has been migrating between the two; this avoids
  hard-coding a guess. Only the *first* attempt may fall back — switching
  mid-pagination would restart paging.

### nginx

`proxy_pass http://api:8081` uses a **literal hostname**, which nginx resolves
once at startup and exits if it is missing — hence `depends_on: service_healthy`.
A variable plus `resolver` would re-resolve per request, but the resolver address
differs between Docker and Podman and these files must work on both. Consequence:
restarting `api` alone may leave the web container 502ing until it restarts too.
The api healthcheck runs every 10s rather than 30s because that interval is also
the deploy's dead time (31s → 12s cold start).
