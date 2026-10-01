/**
 * Connection diagnostic. Run with `npm run diagnose`.
 *
 * Answers "why did the app find no epics when my JQL works in the browser?"
 * without guessing, by reusing the *same* config module the server uses — so
 * what it prints is what the app actually sends, not a re-implementation that
 * could disagree.
 *
 * Read-only: it runs searches and nothing else.
 */
import { readConfig, type JiraConfig } from './config';
import { search } from './jira';

const line = (s = '') => console.log(s);
const head = (s: string) => {
  line();
  line(`── ${s} ${'─'.repeat(Math.max(0, 68 - s.length))}`);
};

/** Show a value so that stray quotes or an inline `# comment` are visible. */
const show = (v: string | undefined) => (v === undefined ? '(unset)' : `[${v}]`);

async function api(cfg: JiraConfig, path: string) {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64')}`,
      Accept: 'application/json',
    },
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
}

/** Run one JQL and report how many it matched, without throwing. */
async function count(cfg: JiraConfig, jql: string, note = '') {
  try {
    const issues = await search(cfg, jql);
    const types = [...new Set(issues.map((i) => i.fields.issuetype?.name ?? '?'))];
    const mark = issues.length ? '✓' : '·';
    line(`  ${mark} ${String(issues.length).padStart(4)}  ${jql}${note ? `   ${note}` : ''}`);
    if (issues.length) {
      line(`          issue types: ${types.join(', ')}`);
      line(`          e.g. ${issues.slice(0, 5).map((i) => i.key).join(', ')}`);
    }
    return issues;
  } catch (e) {
    line(`  ✗        ${jql}`);
    line(`          ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function main() {
  const cfg = readConfig().jira;
  if (!cfg) {
    line('CONSTELLATION_SOURCE=dummy — no Jira configured. Nothing to diagnose.');
    return;
  }

  head('Configuration as the app sees it');
  line(`  base URL (normalised) ${show(cfg.baseUrl)}`);
  line(`  raw JIRA_BASE_URL     ${show(process.env.JIRA_BASE_URL)}`);
  line(`  email                 ${show(cfg.email)}`);
  line(`  token                 ${cfg.token.length} chars, ends ${cfg.token.slice(-4)}`);
  line(`  label                 ${show(process.env.CONSTELLATION_LABEL)}`);
  line(`  JIRA_EPIC_JQL         ${show(process.env.JIRA_EPIC_JQL)}`);
  line(`  effective epic JQL    ${show(cfg.epicJql)}`);
  line(`  story points field    ${show(cfg.storyPointsField)}`);
  line('  If any value above has stray quotes or a trailing "# comment", that is');
  line('  the bug — .env values are literal, so quotes become part of the string.');

  head('Who does the token belong to?');
  // The decisive check. A token issued from a different Atlassian account will
  // authenticate perfectly and then see none of the projects you can see in the
  // browser, which looks exactly like "my JQL matches nothing".
  const me = await api(cfg, '/rest/api/3/myself');
  if (me.status !== 200) {
    // NOT fatal, and it is important not to treat it as such: the newer scoped
    // API tokens (`ATATT3x…`) are granted individual scopes, and a token with
    // read:jira-work but not read:jira-user searches fine while /myself 401s.
    line(`  ⚠ /myself returned ${me.status}. This alone does not mean the token is`);
    line('    bad: a scoped token without read:jira-user cannot read /myself but');
    line('    can still search. Carrying on — the searches below are what matter.');
  }
  const who = (me.body ?? {}) as { emailAddress?: string; displayName?: string; accountId?: string };
  if (me.status === 200) {
    line(`  ✓ ${who.displayName} <${who.emailAddress ?? 'email hidden'}>`);
    line(`    accountId ${who.accountId}`);
    if (who.emailAddress && who.emailAddress.toLowerCase() !== cfg.email.toLowerCase()) {
      line(`  ⚠ This is NOT ${cfg.email}. The token belongs to a different account,`);
      line('    so it sees a different set of projects than your browser does.');
    }
  }

  head('The query the app runs');
  await count(cfg, cfg.epicJql, '← this is what returned nothing');

  head('Isolating which clause excludes everything');
  const label = process.env.CONSTELLATION_LABEL?.trim() || 'constellation';
  // Each probe drops one constraint, so the first one that returns rows names
  // the clause that is wrong.
  await count(cfg, `labels = "${label}"`, '(label only, any issue type)');
  await count(cfg, `labels = "${label.toLowerCase()}"`, '(lower-case label)');
  await count(cfg, `labels in ("${label}", "${label.toLowerCase()}", "${label.toUpperCase()}")`, '(case variants)');
  line();
  line('  If "label only" finds issues but the app\'s query does not, the label is');
  line('  fine and `issuetype = Epic` is wrong — look at the issue types listed');
  line('  above and set JIRA_EPIC_JQL to match, e.g. issuetype = Feature.');
  line('  If "label only" finds nothing either, the label is not on those issues');
  line('  (or not visible to this account) — set JIRA_EPIC_JQL to a project query.');

  head('Does this account see anything at all?');
  const projects = await api(cfg, '/rest/api/3/project/search?maxResults=5');
  const found = (projects.body as { total?: number })?.total;
  line(`  ${projects.status === 200 ? '✓' : '✗'} /project/search → ${projects.status}, total ${found ?? '?'}`);
  if (found === 0) {
    line('  ⚠ Zero projects visible. The account authenticates but has no Browse');
    line('    Projects permission anywhere — which is why every query is empty.');
  }

  head('Which search endpoint the instance speaks');
  line('  (whichever the probes above used successfully — a 404 on /search/jql');
  line('  falls back to /search automatically, and the fallback is silent.)');
  line();
}

main().catch((e) => {
  line(`\nProbe failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
