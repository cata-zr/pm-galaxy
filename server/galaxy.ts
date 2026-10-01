/**
 * Jira JSON → the domain model in `src/model/types.ts`.
 *
 * All of Jira's shape lives in this file and never reaches the browser: the
 * client receives `Galaxy` and nothing else, so `customfield_10016`,
 * `statusCategory` and ADF documents stay on this side of the wire.
 *
 * Parent statuses are deliberately *not* computed here. Every source gets the
 * same roll-up from `deriveGalaxy()` on the client, so a source only has to map
 * leaf statuses correctly (model/derive.ts).
 */
import type {
  Constellation,
  Galaxy,
  Level,
  SourceDiagnostics,
  Status,
  Ticket,
} from '../src/model/types';
import type { JiraConfig } from './config';
import { keyList, search, type JiraIssue, type JiraIssueLink } from './jira';

/** Deepest level the model has a size and ring gap for. */
const MAX_LEVEL = 3;

/** Guard against a pathological or cyclic hierarchy, not a real depth limit. */
const MAX_WALK_DEPTH = 10;

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'epic'
  );
}

/**
 * Jira v3 returns `description` as an ADF document, not a string. Flatten it to
 * the plain text the panel renders — the renderer has no rich-text support and
 * a JSON blob in the panel would be worse than nothing.
 */
function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof n.text === 'string') return n.text;
  const inner = Array.isArray(n.content) ? n.content.map(adfToText).join('') : '';
  // Block-level nodes need a break or the whole description runs together.
  return n.type && ['paragraph', 'heading', 'listItem', 'blockquote'].includes(n.type)
    ? `${inner}\n`
    : inner;
}

function describe(fields: JiraIssue['fields']): string {
  const raw = fields.description;
  if (typeof raw === 'string') return raw.trim();
  return adfToText(raw).trim();
}

/**
 * A ticket's own status. Names first, because several Jira statuses map onto one
 * of ours and only this instance knows which; `statusCategory` is the fallback
 * so an unlisted status still lands somewhere sensible instead of throwing.
 *
 * `blocked` is unreachable by fallback on purpose — Jira has no such category,
 * so it only ever comes from `JIRA_STATUS_BLOCKED`.
 */
function mapStatus(issue: JiraIssue, cfg: JiraConfig, unmapped: Set<string>): Status {
  const name = issue.fields.status?.name?.trim();
  if (name) {
    const mapped = cfg.statusByName.get(name.toLowerCase());
    if (mapped) return mapped;
    unmapped.add(name);
  }
  switch (issue.fields.status?.statusCategory?.key) {
    case 'done':
      return 'done';
    case 'indeterminate':
      return 'in_progress';
    default:
      return 'todo';
  }
}

function storyPoints(issue: JiraIssue, cfg: JiraConfig): number | undefined {
  const raw = issue.fields[cfg.storyPointsField];
  return typeof raw === 'number' ? raw : undefined;
}

/** One directed dependency: `blocker` must finish before `blocked` can proceed. */
interface Dep {
  blocker: string;
  blocked: string;
}

/**
 * Read both directions of every configured link type.
 *
 * We fetch every ticket in a tree, so each link surfaces twice — once from each
 * end — hence the de-duplication by the caller. Reading both ends also means a
 * link survives when only one of its two issues is inside our fetch.
 *
 * Direction follows Jira's convention: for a link on issue X, `outwardIssue`
 * means "X <outward phrase> that one" and `inwardIssue` means "X <inward
 * phrase> that one". For `Blocks` (outward "blocks", inward "is blocked by")
 * the outward issue is therefore the blocker. A type phrased the other way
 * round — an outward "depends on", where the *outward* issue is the dependent —
 * goes in JIRA_DEPENDS_LINK_TYPES instead.
 */
function depsOf(issue: JiraIssue, cfg: JiraConfig): Dep[] {
  const out: Dep[] = [];
  for (const link of issue.fields.issuelinks ?? ([] as JiraIssueLink[])) {
    const type = link.type?.name?.trim().toLowerCase();
    if (!type) continue;
    const forward = cfg.blockerTypes.has(type);
    const reversed = cfg.reversedTypes.has(type);
    if (!forward && !reversed) continue;

    const other = link.outwardIssue?.key ?? link.inwardIssue?.key;
    if (!other) continue;
    // `outwardIssue` present ⇒ this issue is the outward side of the link.
    const thisIsOutward = Boolean(link.outwardIssue?.key);
    // On a forward type the outward side blocks; on a reversed one it depends.
    const thisIsBlocker = forward ? thisIsOutward : !thisIsOutward;

    out.push(
      thisIsBlocker
        ? { blocker: issue.key, blocked: other }
        : { blocker: other, blocked: issue.key },
    );
  }
  return out;
}

function toTicket(
  issue: JiraIssue,
  level: Level,
  cfg: JiraConfig,
  unmapped: Set<string>,
): Ticket {
  return {
    key: issue.key,
    title: issue.fields.summary?.trim() || issue.key,
    level,
    status: mapStatus(issue, cfg, unmapped),
    issueType: issue.fields.issuetype?.name ?? 'Issue',
    parent: issue.fields.parent?.key ?? null,
    // Filled in once every epic is known — a dependency's other end may live in
    // a different constellation, or outside the galaxy entirely.
    blockedBy: [],
    assignee: issue.fields.assignee?.displayName ?? undefined,
    storyPoints: storyPoints(issue, cfg),
    dueDate: issue.fields.duedate ?? undefined,
    updated: issue.fields.updated ?? new Date().toISOString(),
    description: describe(issue.fields),
    labels: issue.fields.labels ?? [],
  };
}

/**
 * Walk one epic's tree a level at a time: `parent in (<previous level>)`.
 *
 * `parent = <epic>` on its own only reaches L1, so this loops. It is
 * depth-agnostic — L3 comes for free and needs no label discipline below the
 * epic — at the cost of one round trip per level, typically three or four.
 */
async function fetchDescendants(cfg: JiraConfig, epicKey: string): Promise<JiraIssue[][]> {
  const levels: JiraIssue[][] = [];
  let frontier = [epicKey];
  const seen = new Set<string>([epicKey]);

  for (let depth = 0; depth < MAX_WALK_DEPTH && frontier.length; depth++) {
    const issues = await search(cfg, `parent in (${keyList(frontier)}) ORDER BY created ASC`);
    // A cycle would otherwise re-query the same keys until MAX_WALK_DEPTH.
    const fresh = issues.filter((i) => !seen.has(i.key));
    if (!fresh.length) break;
    for (const i of fresh) seen.add(i.key);
    levels.push(fresh);
    frontier = fresh.map((i) => i.key);
  }
  return levels;
}

export async function buildGalaxy(cfg: JiraConfig): Promise<Galaxy> {
  const unmapped = new Set<string>();
  const epics = await search(cfg, cfg.epicJql);

  const diagnostics: SourceDiagnostics = {
    unmappedStatuses: [],
    clampedLevels: 0,
    externalLinks: 0,
    epics: epics.length,
    epicJql: cfg.epicJql,
  };

  const usedIds = new Set<string>();
  const constellations: Constellation[] = [];
  /** Every ticket in the galaxy, so dependencies can be resolved across epics. */
  const ticketByKey = new Map<string, Ticket>();
  const epicOfKey = new Map<string, string>();
  const deps: Dep[] = [];

  const collect = (issue: JiraIssue) => {
    for (const d of depsOf(issue, cfg)) deps.push(d);
  };

  for (const epicIssue of epics) {
    const epic = toTicket(epicIssue, 0, cfg, unmapped);
    // The epic is the sun; whatever Jira says its parent is, it has none here.
    epic.parent = null;
    collect(epicIssue);

    const levels = await fetchDescendants(cfg, epicIssue.key);
    const tickets: Ticket[] = [];
    levels.forEach((issues, index) => {
      const depth = index + 1;
      if (depth > MAX_LEVEL) diagnostics.clampedLevels += issues.length;
      const level = Math.min(depth, MAX_LEVEL) as Level;
      for (const issue of issues) {
        tickets.push(toTicket(issue, level, cfg, unmapped));
        collect(issue);
      }
    });

    // A rename changes the slug, so a bookmarked URL follows the epic's title.
    let id = slugify(epic.title);
    if (usedIds.has(id)) id = `${id}-${epic.key.toLowerCase()}`;
    usedIds.add(id);

    constellations.push({ id, epic, tickets });
    for (const t of [epic, ...tickets]) {
      ticketByKey.set(t.key, t);
      epicOfKey.set(t.key, id);
    }
  }

  // We read both ends of every link, so each dependency arrives twice. Collapse
  // them before resolving, or `externalLinks` double-counts.
  const unique = new Map(deps.map((d) => [`${d.blocker}>${d.blocked}`, d]));
  resolveDeps([...unique.values()], ticketByKey, epicOfKey, diagnostics);
  diagnostics.unmappedStatuses = [...unmapped].sort();

  return {
    constellations,
    sourceLabel: `Jira · ${new URL(cfg.baseUrl).host}`,
    fetchedAt: new Date().toISOString(),
    diagnostics,
  };
}

/**
 * Turn the raw link pairs into `blockedBy` plus the two external lists.
 *
 * A link whose two ends sit in different constellations cannot be *drawn* —
 * `engine/layout.ts` positions one constellation at a time, so the other end
 * has no coordinates. But it must still be *counted*, or a ticket holding up
 * another project would render as a quiet grey star and the galaxy's "blocking"
 * headline would under-report. So it goes on `blocksExternal` (which the layout
 * folds into `blocks`) and is listed as text in the ticket panel.
 */
function resolveDeps(
  deps: Dep[],
  ticketByKey: Map<string, Ticket>,
  epicOfKey: Map<string, string>,
  diagnostics: SourceDiagnostics,
) {
  const push = (list: string[], key: string) => {
    if (!list.includes(key)) list.push(key);
  };

  for (const { blocker, blocked } of deps) {
    const a = ticketByKey.get(blocker);
    const b = ticketByKey.get(blocked);
    const sameConstellation =
      a && b && epicOfKey.get(blocker) === epicOfKey.get(blocked);

    if (sameConstellation) {
      push(b.blockedBy, blocker);
      continue;
    }
    diagnostics.externalLinks++;
    // Record whichever end we actually hold. One or both may be outside the
    // galaxy entirely — a ticket in a project nobody labelled.
    if (b) push((b.blockedByExternal ??= []), blocker);
    if (a) push((a.blocksExternal ??= []), blocked);
  }
}
