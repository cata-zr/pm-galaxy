# Constellation

A star map for tracking big, multi-level projects. One epic is a sun, its tickets
are stars orbiting it, sub-tickets orbit their parent, and **a star only lights up
when its ticket is done**. Dependencies are drawn as flowing arcs, so "what is
holding us up" is visible from across the room.

Currently running on **dummy data** — no Jira connection yet (that is the next step;
see [Wiring up Jira](#wiring-up-jira)).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

`npm run build` produces a static bundle in `dist/` — it is a plain SPA, so it can
be dropped on any static host or opened through `npm run preview`.

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
| Blue flicker | In progress |
| Red, slowly pulsing | **Blocking others** — something is waiting on this ticket and it isn't done. Red never means "this ticket is stuck"; it means other work is stuck behind it. |
| Full starlight | Done |
| Thin straight line | Parent → child; it brightens once both ends are lit |
| Red dashed arc | Waiting on a blocker that hasn't started |
| Amber dashed arc | Waiting on a blocker that is in progress |
| Green dashed arc | Path clear — the blocker is done |

Dependency arcs are drawn in the colour of the **blocker's** progress, with dashes
flowing blocker → blocked, so a chain reads as a pipeline: red at the head, green
behind it.

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
  model/dummy.ts    Deterministic fake galaxy: 5 epics, ~200 tickets, real-ish deps
  model/derive.ts   Rolls leaf statuses up the tree (parents summarise children)
  model/source.ts   The single seam between UI and data — swap in Jira here
  engine/layout.ts  Ticket tree → star positions: a radial tidy tree, so subtrees
                    own an angular wedge and their links can never cross
  engine/renderer.ts  Canvas painter: background, links, stars, labels
  engine/camera.ts  Pan/zoom maths and hit testing
  engine/theme.ts   The visual language: status → colour, glow, pulse
  components/       React shell: canvas host, galaxy map, ticket panel, legend
```

Rendering is plain canvas 2D, no graph library. The layout is computed once per
epic and cached; the render loop only reads it, which keeps 170+ animated stars at
60fps.

## Wiring up Jira

Everything Jira-specific will live behind `GalaxySource` in `src/model/source.ts`.
Nothing else in the app needs to change.

A browser cannot call Jira directly (CORS, and the token must not ship in the
bundle), so this needs a thin local proxy — a ~50-line Node/Express or Vite
middleware that holds the PAT in an env var and exposes `GET /api/galaxy`.

Sketch of what the proxy does:

1. Find the epics:
   `search?jql=labels = "constellation" AND issuetype = Epic`
2. For each epic, pull the tree. Either
   `jql=parent = <epicKey>` then recurse per level, or — if the team adopts an epic
   label — one query per epic: `jql=labels = "<epic-label>"`, which is a single
   round trip and covers L3 for free.
3. Map each issue: `fields.status.statusCategory.key` → `done` / `in_progress` /
   `todo`; `fields.issuelinks` where `type.inward === "is blocked by"` →
   `blockedBy[]`; `fields.parent.key` → `parent`.
4. Hand the result to `deriveGalaxy()` — parent statuses are computed, never read
   from Jira, so a Jira epic left open by mistake cannot dim a finished map (and
   vice versa).

Fields worth requesting explicitly to keep the payload small:
`key,summary,description,status,assignee,parent,issuelinks,labels,updated,customfield_10016` (story points).

Open questions to settle before that work starts:

- Label vs. `parent` traversal for finding a project's tickets — the label approach
  is one query and depth-agnostic, but relies on people applying it.
- Which Jira states count as "blocked" in your workflow (only leaves need it).
- Refresh model: on load only, or poll every N minutes with a "last synced" stamp.
