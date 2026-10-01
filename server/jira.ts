/**
 * Thin Jira REST client. Server-side only.
 *
 * This is not a general proxy and must never become one: a route that forwards
 * arbitrary Jira paths would hand anyone who can reach the app the full power
 * of the configured token, including writes. It exposes exactly the two reads
 * the galaxy needs.
 */
import type { JiraConfig } from './config';

export interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    issuetype?: { name?: string };
    status?: { name?: string; statusCategory?: { key?: string } };
    parent?: { key?: string };
    assignee?: { displayName?: string } | null;
    duedate?: string | null;
    updated?: string;
    description?: unknown;
    labels?: string[];
    issuelinks?: JiraIssueLink[];
    [field: string]: unknown;
  };
}

export interface JiraIssueLink {
  type?: { name?: string; inward?: string; outward?: string };
  /** Present when *this* issue is on the receiving end of the outward phrase. */
  inwardIssue?: { key?: string };
  /** Present when *this* issue performs the outward phrase on that one. */
  outwardIssue?: { key?: string };
}

export class JiraError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Fields we actually read. Asking for everything makes the payload enormous. */
export function issueFields(cfg: JiraConfig): string[] {
  return [
    'summary',
    'issuetype',
    'status',
    'parent',
    'assignee',
    'duedate',
    'updated',
    'description',
    'labels',
    'issuelinks',
    cfg.storyPointsField,
  ];
}

function authHeader(cfg: JiraConfig): string {
  // Atlassian Cloud basic auth is email:token, not the token on its own.
  return `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64')}`;
}

/**
 * Turn a failed response into something diagnosable from the UI, without ever
 * echoing the credential back.
 */
async function toError(res: Response, url: string): Promise<JiraError> {
  let detail = '';
  try {
    const body: unknown = await res.json();
    const messages = (body as { errorMessages?: string[] })?.errorMessages;
    if (Array.isArray(messages) && messages.length) detail = messages.join('; ');
  } catch {
    // A non-JSON body (an HTML error page, say) tells us nothing useful.
  }
  const path = new URL(url).pathname;
  if (res.status === 401) {
    return new JiraError(
      'Jira rejected the credentials (401). Check JIRA_EMAIL and JIRA_API_TOKEN — ' +
        'the token must belong to that email, and Atlassian tokens expire.',
      401,
    );
  }
  if (res.status === 403) {
    return new JiraError(
      'Jira accepted the credentials but refused the request (403). The account ' +
        'likely lacks Browse Projects permission on one of the projects queried.',
      403,
    );
  }
  if (res.status === 429) {
    return new JiraError('Jira is rate-limiting this client (429). Try again shortly.', 429);
  }
  return new JiraError(`Jira ${res.status} on ${path}${detail ? `: ${detail}` : ''}`, res.status);
}

/**
 * Which search endpoint this instance speaks, remembered per process.
 *
 * Atlassian Cloud has been migrating `/rest/api/3/search` (offset paging via
 * `startAt`) to `/rest/api/3/search/jql` (token paging via `nextPageToken`).
 * Rather than hard-code a guess, try the new one and fall back once.
 */
let searchPath: '/rest/api/3/search/jql' | '/rest/api/3/search' | null = null;

const PAGE_SIZE = 100;

/**
 * Jira answers an unaccepted credential by serving the request **anonymously**
 * rather than refusing it, and says so only in this header. A search then
 * returns `200` with zero issues, because an anonymous caller can browse no
 * projects — indistinguishable, to us, from a query that legitimately matched
 * nothing. That cost real debugging time: the app reported "no epics found"
 * while the actual fault was a rejected token.
 *
 * Only the explicit failure value is treated as failure. The header is absent
 * on plenty of healthy responses, so its absence means nothing.
 */
function assertAuthenticated(res: Response, cfg: JiraConfig): void {
  if (res.headers.get('x-seraph-loginreason') !== 'AUTHENTICATED_FAILED') return;
  throw new JiraError(
    `Jira did not accept the credentials for ${cfg.email} and served the request ` +
      'anonymously, which is why nothing was found. The request itself was well ' +
      'formed, so this is the token, not the query: it may have expired or been ' +
      'revoked, it may have been created as a scoped token (Constellation needs a ' +
      'plain API token, not one created through "API tokens with scopes"), or it ' +
      'may belong to a different Atlassian account than JIRA_EMAIL. Create a new ' +
      'token at id.atlassian.com/manage-profile/security/api-tokens and run ' +
      '`npm run diagnose` to confirm it works.',
    401,
  );
}

/** Run a JQL search, following pagination to the end. */
export async function search(cfg: JiraConfig, jql: string): Promise<JiraIssue[]> {
  const fields = issueFields(cfg);
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  let startAt = 0;

  for (;;) {
    const modern = searchPath !== '/rest/api/3/search';
    const path = modern ? '/rest/api/3/search/jql' : '/rest/api/3/search';
    const body = modern
      ? { jql, fields, maxResults: PAGE_SIZE, ...(nextPageToken ? { nextPageToken } : {}) }
      : { jql, fields, maxResults: PAGE_SIZE, startAt };

    const url = `${cfg.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader(cfg),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    // Only the *first* attempt may fall back: once a page has been accepted the
    // endpoint is settled, and switching mid-pagination would restart paging.
    if (!res.ok && modern && searchPath === null && (res.status === 404 || res.status === 410)) {
      searchPath = '/rest/api/3/search';
      continue;
    }
    if (!res.ok) throw await toError(res, url);
    // Before trusting a 200: Jira may have answered it as an anonymous caller.
    assertAuthenticated(res, cfg);
    searchPath = path;

    const page = (await res.json()) as {
      issues?: JiraIssue[];
      nextPageToken?: string;
      isLast?: boolean;
      total?: number;
    };
    const batch = page.issues ?? [];
    issues.push(...batch);

    if (modern) {
      nextPageToken = page.nextPageToken;
      if (!nextPageToken || batch.length === 0) return issues;
    } else {
      startAt += batch.length;
      if (batch.length === 0 || (page.total !== undefined && startAt >= page.total)) return issues;
    }
  }
}

/** `key in (A, B, C)` — the level-wise walk's building block. */
export function keyList(keys: string[]): string {
  return keys.map((k) => `"${k.replace(/"/g, '')}"`).join(', ');
}
