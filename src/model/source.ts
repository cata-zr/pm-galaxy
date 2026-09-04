/**
 * The single seam between the UI and wherever the data comes from.
 *
 * Today: dummy data.
 * Later: a `jiraSource` that hits `/api/galaxy` on a tiny local proxy (a browser
 * cannot call Jira directly — CORS, and the token must not sit in the bundle).
 * The proxy would run one JQL search per labelled epic, e.g.
 *   labels = "constellation" AND issuetype = Epic
 *   parent = <epicKey> ORDER BY created ASC
 * and map Jira's statusCategory + issuelinks onto Status / blockedBy.
 */
import { deriveGalaxy } from './derive';
import { dummyGalaxy } from './dummy';
import type { Galaxy } from './types';

export interface GalaxySource {
  label: string;
  load(): Promise<Galaxy>;
}

export const dummySource: GalaxySource = {
  label: 'Dummy data',
  // Every source gets the same roll-up: parents summarise their children.
  load: async () => deriveGalaxy(dummyGalaxy()),
};

export function activeSource(): GalaxySource {
  return dummySource;
}
