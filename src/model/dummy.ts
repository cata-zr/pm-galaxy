/**
 * Dummy galaxy used until the Jira adapter lands. Fully deterministic: the same
 * seed always yields the same keys, statuses and dependencies, so the layout is
 * stable while we iterate on the design.
 */
import { pick, rngFor } from '../lib/rng';
import type { Constellation, Galaxy, Level, Status, Ticket } from './types';

interface EpicSpec {
  id: string;
  projectKey: string;
  keyBase: number;
  name: string;
  summary: string;
  /** 0..1 — how far along the epic is; drives the status mix. */
  completion: number;
  /** How often a ticket ends up blocked rather than merely waiting. */
  friction: number;
  /**
   * Epic due date, as days from BASE. Omit for an epic with no deadline — the
   * field is optional in Jira too, and the UI has to cope with that.
   */
  dueInDays?: number;
  workstreams: string[];
  /** Levels to generate below L1 (2 = sub-tickets, 3 = sub-sub-tickets). */
  maxLevel: Level;
}

const EPICS: EpicSpec[] = [
  {
    id: 'unified-checkout',
    projectKey: 'AETCOE',
    keyBase: 124000,
    name: 'Unified Checkout Migration',
    summary:
      'Collapse the three legacy checkout flows into a single hosted checkout served from the new edge runtime, without breaking existing merchant integrations.',
    completion: 0.45,
    friction: 0.3,
    dueInDays: 47,
    maxLevel: 2,
    workstreams: [
      'Payment method registry',
      'Hosted checkout shell',
      'Legacy flow adapter',
      'Pricing & tax integration',
      'Fraud signal pipeline',
      '3DS2 challenge flow',
      'Merchant migration tooling',
      'Checkout telemetry',
      'Accessibility compliance',
      'Rollout & kill switch',
    ],
  },
  {
    id: 'tax-engine',
    projectKey: 'TAXENG',
    keyBase: 8400,
    name: 'Tax Engine Rewrite',
    summary:
      'Replace the monolithic tax calculator with a rules-driven engine that supports per-jurisdiction overrides and can be replayed against historical orders.',
    completion: 0.68,
    friction: 0.15,
    dueInDays: 9,
    maxLevel: 2,
    workstreams: [
      'Rule DSL & parser',
      'Jurisdiction data import',
      'Calculation core',
      'Historical replay harness',
      'Rate change scheduler',
      'Exemption certificates',
      'Reporting exports',
      'Legacy engine shadow mode',
    ],
  },
  {
    id: 'merchant-onboarding',
    projectKey: 'ONBRD',
    keyBase: 2100,
    name: 'Merchant Onboarding Self-Serve',
    summary:
      'Let merchants onboard themselves end to end: KYC, contract signature, payout setup and first test transaction, with no ops involvement for the happy path.',
    completion: 0.22,
    friction: 0.45,
    dueInDays: -6,
    maxLevel: 3,
    workstreams: [
      'Signup & identity',
      'KYC provider integration',
      'Contract e-signature',
      'Payout account setup',
      'Risk scoring gate',
      'Sandbox provisioning',
      'Go-live checklist',
      'Ops escalation console',
      'Onboarding analytics',
    ],
  },
  {
    // Shipped — the one epic whose sun has ignited.
    id: 'vault-rotation',
    projectKey: 'VAULT',
    keyBase: 3100,
    name: 'Vault Key Rotation',
    summary:
      'Rotate every service credential through the new vault, with automated re-issue and zero downtime. Shipped and closed out.',
    completion: 1,
    friction: 0,
    // In the past, but the work shipped — this must read as met, not overdue.
    dueInDays: -20,
    maxLevel: 2,
    workstreams: [
      'Vault cluster hardening',
      'Credential inventory',
      'Automated re-issue job',
      'Service cutover',
      'Break-glass procedure',
      'Decommission old store',
    ],
  },
  {
    id: 'observability',
    projectKey: 'OBSRV',
    keyBase: 771,
    name: 'Observability Overhaul',
    summary:
      'One trace per transaction across all services, with SLO dashboards and alerting that the on-call rotation actually trusts.',
    completion: 0.85,
    friction: 0.1,
    maxLevel: 2,
    workstreams: [
      'Trace context propagation',
      'Log schema normalisation',
      'SLO definitions',
      'Alert routing',
      'Dashboard library',
      'Cost guardrails',
    ],
  },
];

const SUBTASK_TEMPLATES = [
  'Design and review the interface',
  'Implement the happy path',
  'Cover error and timeout handling',
  'Add contract tests',
  'Wire up feature flag',
  'Backfill existing records',
  'Write the runbook',
  'Load test at 3x peak',
  'Instrument metrics and traces',
  'Migrate the legacy caller',
];

const LEAF_TEMPLATES = [
  'Unit tests',
  'Update OpenAPI spec',
  'Handle nullable legacy column',
  'Add audit log entry',
  'Pen-test follow-up',
];

const PEOPLE = [
  'Ana Ionescu',
  'Marius Petrescu',
  'Diana Stan',
  'Radu Vlad',
  'Elena Marin',
  'Tudor Barbu',
  'Ioana Dragomir',
  'Sorin Ene',
];

const ISSUE_TYPE: Record<Level, string> = {
  0: 'Epic',
  1: 'Story',
  2: 'Sub-task',
  3: 'Sub-task',
};

const SPRINTS = ['Sprint 41', 'Sprint 42', 'Sprint 43', 'Backlog'];

function statusFor(
  rand: () => number,
  completion: number,
  friction: number,
  blockersDone: boolean,
): Status {
  if (!blockersDone) return rand() < friction * 1.6 ? 'blocked' : 'todo';
  const roll = rand();
  if (roll < completion) return 'done';
  if (roll < completion + 0.22) return 'in_progress';
  if (roll < completion + 0.22 + friction * 0.25) return 'blocked';
  return 'todo';
}

/** Everything in here is dated relative to this, so the fixture stays stable. */
const BASE = Date.parse('2026-09-03T09:00:00Z');

function isoDaysAgo(rand: () => number): string {
  const days = Math.floor(rand() * 45);
  return new Date(BASE - days * 86_400_000).toISOString();
}

/** Jira hands back `duedate` as a plain calendar day, so match that shape. */
function dueDate(days: number | undefined): string | undefined {
  return days === undefined ? undefined : new Date(BASE + days * 86_400_000).toISOString().slice(0, 10);
}

function buildConstellation(spec: EpicSpec): Constellation {
  const rand = rngFor(spec.id);
  let seq = spec.keyBase;
  const nextKey = () => `${spec.projectKey}-${++seq}`;

  const tickets: Ticket[] = [];
  /** Statuses resolved so far, for dependency-aware status assignment. */
  const statusByKey = new Map<string, Status>();

  const make = (
    key: string,
    title: string,
    level: Level,
    parent: string | null,
    blockedBy: string[],
    description: string,
  ): Ticket => {
    const blockersDone = blockedBy.every((b) => statusByKey.get(b) === 'done');
    const status = statusFor(rand, spec.completion, spec.friction, blockersDone);
    statusByKey.set(key, status);
    const ticket: Ticket = {
      key,
      title,
      level,
      status,
      issueType: ISSUE_TYPE[level],
      parent,
      blockedBy,
      assignee: status === 'todo' && rand() < 0.4 ? undefined : pick(rand, PEOPLE),
      storyPoints: level === 1 ? pick(rand, [1, 2, 3, 5, 8, 13]) : pick(rand, [1, 2, 3]),
      sprint: status === 'done' ? 'Sprint 41' : pick(rand, SPRINTS),
      updated: isoDaysAgo(rand),
      description,
      labels: ['constellation', spec.id],
    };
    tickets.push(ticket);
    return ticket;
  };

  const epicKey = `${spec.projectKey}-${spec.keyBase}`;
  const epic: Ticket = {
    key: epicKey,
    title: spec.name,
    level: 0,
    status: 'in_progress',
    issueType: 'Epic',
    parent: null,
    blockedBy: [],
    assignee: PEOPLE[0],
    dueDate: dueDate(spec.dueInDays),
    updated: isoDaysAgo(rand),
    description: spec.summary,
    labels: ['constellation', spec.id],
  };

  // L1 — one per workstream, occasionally blocked by an earlier workstream.
  const l1Keys: string[] = [];
  spec.workstreams.forEach((name, i) => {
    const key = nextKey();
    const blockedBy: string[] = [];
    if (i > 0 && rand() < 0.45) {
      const from = l1Keys[Math.floor(rand() * i)];
      if (from) blockedBy.push(from);
    }
    make(
      key,
      name,
      1,
      epicKey,
      blockedBy,
      `Workstream "${name}" for ${spec.name}. Owns the design, implementation and rollout of this slice, including its own feature flag and dashboard.`,
    );
    l1Keys.push(key);
  });

  // L2 — sub-tickets per workstream, sequenced within the parent.
  const l2ByParent = new Map<string, string[]>();
  for (const parentKey of l1Keys) {
    const count = 2 + Math.floor(rand() * 4);
    const siblings: string[] = [];
    for (let i = 0; i < count; i++) {
      const key = nextKey();
      const blockedBy: string[] = [];
      // Sub-tickets usually queue behind the previous one in the same parent.
      if (i > 0 && rand() < 0.55) blockedBy.push(siblings[i - 1]);
      make(
        key,
        pick(rand, SUBTASK_TEMPLATES),
        2,
        parentKey,
        blockedBy,
        `Sub-task of ${parentKey}. Scoped to a single reviewable change; merged behind the parent workstream flag.`,
      );
      siblings.push(key);
    }
    l2ByParent.set(parentKey, siblings);
  }

  // L3 — only for epics that model that depth today.
  if (spec.maxLevel >= 3) {
    for (const siblings of l2ByParent.values()) {
      for (const parentKey of siblings) {
        if (rand() > 0.3) continue;
        const count = 1 + Math.floor(rand() * 2);
        const kids: string[] = [];
        for (let i = 0; i < count; i++) {
          const key = nextKey();
          const blockedBy = i > 0 && rand() < 0.5 ? [kids[i - 1]] : [];
          make(
            key,
            pick(rand, LEAF_TEMPLATES),
            3,
            parentKey,
            blockedBy,
            `Leaf task under ${parentKey}.`,
          );
          kids.push(key);
        }
      }
    }
  }

  // Parent and epic statuses are not set here: deriveStatuses() rolls them up
  // from the leaves, exactly as it will once the leaves come from Jira.
  return { id: spec.id, epic, tickets };
}

export function dummyGalaxy(): Galaxy {
  return {
    constellations: EPICS.map(buildConstellation),
    sourceLabel: 'Dummy data (no Jira connection)',
    fetchedAt: '2026-09-03T09:00:00Z',
  };
}
