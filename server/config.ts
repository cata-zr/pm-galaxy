/**
 * Runtime configuration, read from the environment on the server.
 *
 * Nothing here may ever reach the browser bundle. Vite substitutes `VITE_*`
 * variables into the JS text at build time, so they are string literals in a
 * file nginx serves to anyone — an Atlassian API token carries the full
 * permissions of the account across Jira and Confluence, so it lives only
 * here, server-side, and is read at *runtime* so one image works everywhere.
 */
import type { Status } from '../src/model/types';

export type SourceMode = 'jira' | 'dummy';

export interface JiraConfig {
  /** Site origin, no trailing slash and no `/jira` suffix. */
  baseUrl: string;
  email: string;
  token: string;
  /** JQL that finds the L0 epics. */
  epicJql: string;
  /** Link type names whose *outward* issue is the blocker (e.g. "Blocks"). */
  blockerTypes: Set<string>;
  /** Link types that read the other way round (e.g. an outward "depends on"). */
  reversedTypes: Set<string>;
  /** Lowercased Jira status name → our Status. */
  statusByName: Map<string, Status>;
  storyPointsField: string;
  cacheTtlMs: number;
}

export interface Config {
  mode: SourceMode;
  /** Absent in dummy mode — that is the whole point of dummy mode. */
  jira: JiraConfig | null;
  port: number;
}

/**
 * The site origin Jira's REST API hangs off.
 *
 * People paste the URL out of the browser, which is the *web UI* path and ends
 * in `/jira/` — and `https://site.atlassian.net/jira/rest/api/3/...` is a 404.
 * Strip it, plus any trailing slash, and keep only the origin.
 */
export function normaliseBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  return url.origin;
}

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function lowerSet(raw: string | undefined, fallback: string[]): Set<string> {
  const items = list(raw);
  return new Set((items.length ? items : fallback).map((s) => s.toLowerCase()));
}

/**
 * Jira status *names* → our four statuses. Several Jira statuses legitimately
 * mean the same thing ("In Progress", "In Review", "In Development"), and only
 * this instance knows which, so the whole mapping is configurable.
 *
 * `blocked` is name-driven and nothing else: Jira has only three status
 * *categories* (new / indeterminate / done) and none of them is "blocked", so
 * an unlisted status can never fall back into it.
 */
function statusMap(env: NodeJS.ProcessEnv): Map<string, Status> {
  const map = new Map<string, Status>();
  const add = (raw: string | undefined, status: Status) => {
    for (const name of list(raw)) map.set(name.toLowerCase(), status);
  };
  add(env.JIRA_STATUS_TODO, 'todo');
  add(env.JIRA_STATUS_IN_PROGRESS, 'in_progress');
  add(env.JIRA_STATUS_BLOCKED, 'blocked');
  add(env.JIRA_STATUS_DONE, 'done');
  return map;
}

export class ConfigError extends Error {}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode: SourceMode = env.CONSTELLATION_SOURCE === 'dummy' ? 'dummy' : 'jira';
  const port = Number(env.PORT ?? 8081);

  if (mode === 'dummy') return { mode, jira: null, port };

  // Fail at boot, naming the variable. The alternative is a mystery 500 on the
  // first page load, diagnosed by reading container logs.
  const missing = (['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'] as const).filter(
    (k) => !env[k]?.trim(),
  );
  if (missing.length) {
    throw new ConfigError(
      `Missing required environment ${missing.length > 1 ? 'variables' : 'variable'}: ` +
        `${missing.join(', ')}. Set them in the .env file beside docker-compose.yml ` +
        `(see .env.example), or set CONSTELLATION_SOURCE=dummy to run without Jira.`,
    );
  }

  const label = env.CONSTELLATION_LABEL?.trim() || 'constellation';
  // An explicit JQL wins outright: it is the escape hatch for an instance where
  // the label has not been applied to anything yet, so you can point at a
  // project or a literal list of keys and still see something.
  const epicJql = env.JIRA_EPIC_JQL?.trim() || `labels = "${label}" AND issuetype = Epic`;

  return {
    mode,
    port,
    jira: {
      baseUrl: normaliseBaseUrl(env.JIRA_BASE_URL!),
      email: env.JIRA_EMAIL!.trim(),
      token: env.JIRA_API_TOKEN!.trim(),
      epicJql,
      blockerTypes: lowerSet(env.JIRA_BLOCKS_LINK_TYPES, ['Blocks']),
      reversedTypes: lowerSet(env.JIRA_DEPENDS_LINK_TYPES, []),
      statusByName: statusMap(env),
      storyPointsField: env.JIRA_STORY_POINTS_FIELD?.trim() || 'customfield_10016',
      cacheTtlMs: Number(env.GALAXY_CACHE_TTL ?? 120) * 1000,
    },
  };
}
