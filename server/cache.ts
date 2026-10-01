/**
 * TTL cache with single-flight.
 *
 * Single-flight is the part that matters: three people opening the standup
 * screen at the same moment should produce one Jira fetch between them, not
 * three. A failure is deliberately *not* cached, so a fixed credential or a
 * recovered outage takes effect on the next request rather than after the TTL.
 */
export interface Cached<T> {
  value: T;
  /** When this entry was produced. */
  at: number;
}

export function createCache<T>(ttlMs: number, load: () => Promise<T>) {
  let entry: Cached<T> | null = null;
  let inFlight: Promise<T> | null = null;

  return {
    async get(force = false): Promise<{ value: T; cached: boolean }> {
      if (!force && entry && Date.now() - entry.at < ttlMs) {
        return { value: entry.value, cached: true };
      }
      // Late arrivals join the fetch already running instead of starting another.
      if (!inFlight) {
        inFlight = load()
          .then((value) => {
            entry = { value, at: Date.now() };
            return value;
          })
          .finally(() => {
            inFlight = null;
          });
      }
      return { value: await inFlight, cached: false };
    },
  };
}
