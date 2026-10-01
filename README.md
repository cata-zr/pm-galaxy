# Constellation

A star map for tracking big, multi-level projects. One epic is a sun, its tickets
are stars orbiting it, sub-tickets orbit their parent, and **a star only lights up
when its ticket is done**. Dependencies are drawn as flowing arcs, and the tickets
other work is waiting on burn hottest, so "what is holding us up" is visible from
across the room.

Data comes from **Jira**, discovered by label. See
[Connecting Jira](#connecting-jira) for the configuration, which is all runtime
environment — the same image runs locally and on the server.

## Run it

```bash
npm install
cp .env.example .env   # then fill in JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
npm run dev            # http://localhost:5173
```

No Jira to hand? `CONSTELLATION_SOURCE=dummy` serves a built-in fixture of five
epics and ~200 tickets instead — enough to work on the visual layer with no
connection at all.

`npm run build` produces three things: the browser bundle in `dist/`, and the API
in `dist-server/`. The app is no longer a pure static SPA: it needs the small API
beside it, because **a browser cannot call Jira directly** (see below).

## Deploy it

```bash
cp .env.example .env          # fill in the Jira connection first
docker compose up -d          # builds both images on first run, serves on :8080
```

That is the whole deployment. Two containers come up:

| Service | What it is |
| --- | --- |
| `constellation` | nginx serving the browser bundle, and proxying `/api/` to the other one. The only service with a published port. |
| `constellation-api` | The Jira adapter. Holds the API token, talks to Jira server-to-server, exposes one read-only route. **No published port** — reachable only through the proxy. |

Node compiles both, then the toolchain is thrown away: the web image is ~70 MB of
nginx plus static files, and the api image is Alpine Node plus a single bundled
JS file — it has no `node_modules` at all, because the only thing the server
imports is `node:http`.

| | |
| --- | --- |
| Port | `8080` on the host. Set `CONSTELLATION_PORT=80` in a `.env` file beside the compose file to serve the host directly. |
| Restart | `unless-stopped`, so the service returns after a host reboot. Without this the URL quietly dies the first time the box restarts. |
| Health | `GET /healthz` returns `ok`; Compose polls it every 30s, so `docker ps` reports the container healthy rather than merely running. |
| Redeploy | `docker compose up -d --build` after a `git pull`. |
| Config | `.env` beside the compose file, read at **runtime** by the api container. Never rebuild to change a setting. |

The web container waits for the api to report healthy before starting, because
nginx resolves the `api` hostname once when it loads its config and exits if the
name is missing. One consequence worth knowing: if you restart `constellation-api`
on its own it may come back on a new address, and the web container will return
502 until it is restarted too. `docker compose restart` avoids the whole issue.

Caching is split deliberately: Vite fingerprints filenames under `/assets/`, so
those are served `immutable` for a year, while `index.html` is sent `no-cache`.
That combination is what makes a redeploy take effect immediately instead of
leaving people on a cached page that asks for bundles which no longer exist.

The container is engine-agnostic — image names are fully qualified and no
engine-specific features are used, so the same files run under `podman compose`
locally and `docker compose` on the server. If you build the image on a Mac and
push it rather than building on the host, add `--platform linux/amd64`; building
on the AWS box itself needs nothing.

## What you see

**Galaxy map** (landing page) — one card per epic with a live miniature of its
constellation, percentage lit, how many tickets are blocking others, and the
epic's due date if it has one. A finished epic's card glows: its sun has ignited.
Click a card to enter that constellation, and use `← Galaxy map` in the header to
come back.

The summary line above the grid describes **only the work still in flight** —
completed constellations are left out, so a shipped project can't quietly inflate
the numbers. Search finds a constellation by name, key or slug, and the quick
filters narrow the grid to what is **blocking**, **due soon** (within 14 days),
**overdue** or **completed**.

Due dates are read from the epic and stay quiet until they matter: grey while the
deadline is far off, amber as it approaches, red once it has passed. A completed
constellation just reads **delivered** — it is never late, whatever the date said.

**Constellation view**

| Element | Meaning |
| --- | --- |
| Sun | The epic (L0). A banked fire while work remains — it **ignites only when every star is lit**, flooding the constellation with light. |
| Star, 30% of sun | L1 ticket |
| Star, 20% of sun | L2 sub-ticket |
| Star, 14% of sun | L3 (supported, used by the *Merchant Onboarding* demo epic) |
| Unlit grey body | Not started |
| Blue flicker, tight glow | In progress |
| Red, the hottest point on the map | **Blocking others** — something is waiting on this ticket and it isn't done. Red never means "this ticket is stuck"; it means other work is stuck behind it. |
| Red breathing to amber, ~2s | Blocking others, **and being worked on** — the amber says it is on its way out of red |
| Gold, gentle core with a wide halo | Done |
| Thin straight line | Parent → child; it brightens once both ends are lit |
| Red dashed arc | Waiting on a blocker that hasn't started |
| Amber dashed arc | Waiting on a blocker that is in progress |
| Green dashed arc | Path clear — the blocker is done |

Brightness and glow say different things. **Brightness ranks how much a ticket
wants your attention**, so blockers are the brightest stars on the map — they are
where the project is actually stuck. **The halo says what state it is in**: a
tight, hot point means deal with me, a broad soft glow means finished. Done work
is deliberately *calmer* than a blocker, and warms the constellation instead of
shouting.

Dependency arcs are drawn in the colour of the **blocker's** progress, with dashes
flowing blocker → blocked, so a chain reads as a pipeline: red at the head, green
behind it. A blocking star breathes towards the same amber the arcs use for "in
progress", so the star and the arc leaving it tell the same story.

The stats panel top-left carries the epic's due date, and its progress bar is
**blue while work remains and gold only at 100%** — gold is kept for finished
work, so that nothing on screen is permanently wearing the colour of the reward.

**Status is only entered at the leaves.** A parent is done when all its children
are done, in progress when any child has started, and otherwise not started. So
an epic can never claim to be finished while a sub-task under it is open, and the
Jira adapter only has to map leaf statuses correctly.

Positions are seeded from the ticket key, so a given star sits in the same place on
every reload. The map becomes something the team can learn, instead of reshuffling
each time you open it. Siblings are ordered so dependency chains end up as angular
neighbours — which is why most dependencies are short arcs along a ring rather than
chords across the map.

### Controls

| Action | |
| --- | --- |
| Drag | Pan |
| Wheel / trackpad | Zoom at the cursor |
| Click a star | Open the ticket panel (summary, status, assignee, relations) |
| Double-click a star | Centre and zoom on it |
| Click a relation in the panel | Fly to that ticket |
| `f` | Fit the whole constellation |
| `l` | Cycle label density (auto / all / minimal) |
| `b` | Jump to the next blocking ticket |
| `Esc` | Deselect |

The current view lives in the URL hash (`#/tax-engine`), so a constellation can be
bookmarked or pasted into a standup thread.

## Code map

```
src/
  model/types.ts    Domain model (Ticket, Constellation, Galaxy) + derived helpers
  model/dummy.ts    Deterministic fake galaxy: 5 epics, ~200 tickets, real-ish deps,
                    and one epic per due-date state (far off, soon, overdue, none)
  model/derive.ts   Rolls leaf statuses up the tree (parents summarise children)
  model/source.ts   The single seam between UI and data — fetches /api/galaxy
  engine/layout.ts  Ticket tree → star positions: a radial tidy tree, so subtrees
                    own an angular wedge and their links can never cross
  engine/renderer.ts  Canvas painter: background, links, stars, labels
  engine/camera.ts  Pan/zoom maths and hit testing
  engine/theme.ts   The visual language: status → colour, glow, pulse
  components/       React shell: canvas host, galaxy map, ticket panel, legend

server/             The Jira adapter. Never reaches the browser.
  config.ts         Environment parsing, validation, base-URL normalisation
  jira.ts           REST client: auth, pagination, error mapping
  galaxy.ts         Jira JSON → the domain model above
  cache.ts          TTL cache with single-flight
  handler.ts        The one route, shared by dev middleware and production
  main.ts           node:http entry point (production only)
```

Rendering is plain canvas 2D, no graph library. The layout is computed once per
epic and cached; the render loop only reads it, which keeps 170+ animated stars at
60fps.

## Connecting Jira

All the Jira-specific code lives in `server/` and never reaches the browser. The
UI only ever sees the domain model, so the app itself has no idea where its data
came from.

### Why there is a server at all

A browser cannot call Jira directly, for two independent reasons:

1. **CORS.** The REST API on `*.atlassian.net` returns no
   `Access-Control-Allow-Origin` for our origin, so the browser's preflight is
   refused and the response is discarded — even when Jira answered it perfectly
   well. This has nothing to do with being authenticated; origin policy is
   enforced by the browser, not by Jira, and being correctly authenticated is
   exactly the case it is strictest about.
2. **The token.** An Atlassian API token is **not scoped** — it carries the full
   permissions of your account across Jira and Confluence. Anything the browser
   can send, a user can read, and Vite substitutes `VITE_*` variables into the JS
   text at build time, so a token stored that way is a plain string in a file
   nginx serves to the world.

The api container fixes both. Server-to-server HTTP has no concept of an origin,
so CORS simply does not apply, and the credential never leaves the host. It is
deliberately **not** a general Jira proxy: one read-only route, one response
shape. A route that forwarded arbitrary Jira paths would hand anyone who can
reach the app the full power of the token, including writes.

### Configuration

All runtime environment, in `.env` beside the compose file. `.env.example`
documents every variable; the ones that matter:

| Variable | Notes |
| --- | --- |
| `JIRA_BASE_URL` | Site origin. A trailing `/jira` or `/` is stripped, so the URL copied out of the browser works as-is. |
| `JIRA_EMAIL` | Atlassian Cloud basic auth is `email:token` — the token alone is not enough. |
| `JIRA_API_TOKEN` | From [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens). Treat it as a password. |
| `CONSTELLATION_LABEL` | Epic discovery: `labels = "<label>" AND issuetype = Epic`. |
| `JIRA_EPIC_JQL` | Escape hatch — replaces the query above outright. Useful before the label exists anywhere. |
| `JIRA_BLOCKS_LINK_TYPES` | Link types where the **outward** issue is the blocker, like Jira's built-in `Blocks`. |
| `JIRA_DEPENDS_LINK_TYPES` | Link types phrased the other way round, where the outward issue is the one that *depends*. |
| `JIRA_STATUS_*` | Jira status **names** → the model's four statuses. Several Jira statuses legitimately mean the same thing. |
| `GALAXY_CACHE_TTL` | Seconds a fetched galaxy is held. Concurrent requests share one fetch regardless. |
| `CONSTELLATION_SOURCE` | `dummy` serves the fixture instead of calling Jira. |

Missing credentials fail at boot with a message naming the variable, and the same
message is served over HTTP — so a misconfiguration shows up in the app rather
than only in container logs.

### How the data is built

1. **Find the epics** with one JQL search. Note this instance rejects unbounded
   JQL, so the query always carries a restriction.
2. **Walk each tree a level at a time**: `parent in (<keys from the level above>)`,
   repeating until a level comes back empty. `parent = <epic>` alone only reaches
   L1, which is why it loops. Depth-agnostic, needs no label discipline below the
   epic, and costs one round trip per level.
3. **Map the fields.** `fields.status.name` against `JIRA_STATUS_*` first, falling
   back to `statusCategory.key`; `fields.parent.key` → `parent`;
   `fields.duedate` → `dueDate` (already `YYYY-MM-DD`); `description` is an ADF
   document and gets flattened to text.
4. **Read dependencies from issue links, never from a status.** Both directions
   are read, so each link surfaces twice and is de-duplicated. Direction follows
   Jira's convention: on issue X, an `outwardIssue` means "X *blocks* that one"
   and an `inwardIssue` means "X *is blocked by* that one".
5. **Roll statuses up on the client** via `deriveGalaxy()`. Parent statuses are
   always computed, never read from Jira, so an epic left open by mistake cannot
   dim a finished map.

### Two things worth knowing

**A ticket's own status and its dependencies are separate ideas.** `blocked` is a
status some Jira workflows use — "I am stuck" — and it is configured through
`JIRA_STATUS_BLOCKED`. Whether other work is *waiting* on a ticket comes only
from issue links. A blocked leaf gets a slowly turning belt of debris; a ticket
others are waiting on burns red. They compose, and either can happen without the
other.

**Dependencies that cross between constellations are counted but not drawn.**
`engine/layout.ts` positions one constellation at a time, so a link to a ticket in
another epic has no star to point at. Dropping it would be worse than not drawing
it — a ticket holding up another project would render as a quiet grey star and the
galaxy's "blocking" total would under-report. So it is folded into the blocking
count and listed as plain text in the ticket panel.

### Troubleshooting: `npm run diagnose`

```bash
npm run diagnose
```

Reads `.env`, reuses the server's own config module, and prints what the app
actually sends: the normalised base URL, the effective epic JQL, which account
the token resolves to, then progressively looser searches so the clause that
excludes everything names itself. Read-only — it runs searches and nothing else,
and prints no token.

**"No epics found" when the same JQL works in Jira.** Jira answers an
unaccepted credential by serving the request **anonymously** rather than
refusing it, and says so only in an `x-seraph-loginreason: AUTHENTICATED_FAILED`
header. A search then returns `200` with zero issues, because an anonymous
caller can browse no projects — which looks exactly like a label that matches
nothing. The adapter now checks that header and reports the real cause, but if
you see this symptom on an older build, it is the token, not the query.

Tokens that fail this way are usually expired or revoked, **created through
"API tokens with scopes"** (Constellation needs a plain API token), or issued
from a different Atlassian account than `JIRA_EMAIL`.

### Diagnostics

The API reports what it noticed, and the app shows it in a banner rather than a
log: Jira statuses that matched no mapping (with the names, so they can be added),
tickets found deeper than L3 and clamped to it, and dependencies crossing between
constellations. An unmapped status is otherwise discovered by noticing a star is
the wrong colour.

### Still open

- Which link types the team actually uses. `Blocks` exists; there is no `Depends`
  link type in this instance, so if that is the second one in use it goes by
  another name — and if its outward phrase reads "depends on" it belongs in
  `JIRA_DEPENDS_LINK_TYPES`, not `JIRA_BLOCKS_LINK_TYPES`, or every arrow it
  produces points the wrong way.
- Sprint is not mapped. It is a custom field whose id differs per instance, so the
  panel shows `—` until `JIRA_SPRINT_FIELD` is added.
- Story points default to `customfield_10016`. Verify it on your instance.
- Whether 14 days is the right "due soon" window (`NEAR_DUE_DAYS` in
  `src/model/types.ts`) — it was a default, not a decision.
- Refresh is manual (a button, plus a `synced HH:MM` stamp). Polling every N
  minutes is the obvious next step if the map lives on a wall screen.
- The app has **no authentication**. Anyone who can reach the host can read every
  labelled epic.
