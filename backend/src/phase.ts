/**
 * Prints a one-line marker saying what this container is currently doing,
 * for docker-monitor to read out of the log stream.
 *
 * Docker can say "running" and, given a HEALTHCHECK, "healthy". Neither
 * says whether this process is sitting idle or is mid-way through
 * fetching and parsing a recipe off someone else's website — and the
 * portfolio's dashboard shows the difference as "Idle" vs "Populating
 * data".
 *
 * The format is a convention shared with docker-monitor (which parses it)
 * and flight-tracker (which also emits it): see docker-monitor's README
 * under "Phase reporting" for the vocabulary and the two rules. The one
 * that matters here is emit-on-transition-only, enforced below rather
 * than left to call sites.
 *
 * No dependency on docker-monitor: unread, these are ordinary log lines.
 */

export const Phase = {
  StartingUp: "starting_up",
  Ready: "ready",
  PopulatingData: "populating_data",
  Idle: "idle",
  Degraded: "degraded",
  ShuttingDown: "shutting_down",
} as const;

export type PhaseName = (typeof Phase)[keyof typeof Phase];

let current: PhaseName | null = null;

/**
 * Emits only when the phase actually changes. The detail is deliberately
 * not part of that comparison - importing three recipes in a row is one
 * continuous populating_data phase, not three.
 */
export function setPhase(phase: PhaseName, detail = ""): void {
  if (current === phase) return;
  current = phase;
  console.log(detail ? `[phase:${phase}] ${detail}` : `[phase:${phase}]`);
}

export function currentPhase(): PhaseName | null {
  return current;
}

/**
 * Runs `work` as populating_data, returning to idle when it settles.
 *
 * Deliberately returns to idle in a `finally`: an import that throws has
 * still stopped populating anything, and a phase that sticks on
 * "populating data" after a failure is worse than no phase at all -
 * someone watching the dashboard would wait for something that is never
 * going to finish.
 */
export async function duringPhase<T>(detail: string, work: () => Promise<T>): Promise<T> {
  setPhase(Phase.PopulatingData, detail);
  try {
    return await work();
  } finally {
    setPhase(Phase.Idle, "");
  }
}
