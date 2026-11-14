/**
 * Pace real-match events evenly across the short demo without changing order.
 * This keeps the event channel visibly active during short injected stalls;
 * original match clocks remain in the event text and score context.
 */
export function paceEvents(events, { durationSeconds = 360 } = {}) {
  const ordered = [...events].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  if (ordered.length < 2) return ordered.map(event => ({ ...event, t: 0 }));
  return ordered.map((event, index) => ({
    ...event,
    t: Number((index / (ordered.length - 1) * durationSeconds).toFixed(2)),
  }));
}
