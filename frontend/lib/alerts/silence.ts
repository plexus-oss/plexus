/**
 * Wall-clock alert silencing.
 *
 * A monitor with silenced_until in the future keeps its state (houston keeps
 * evaluating; hysteresis/cooldown survive) but fires nothing: the poll and
 * offline loops skip it, and the houston transitions route drops the insert —
 * which also suppresses every downstream notification, since fan-out hangs
 * off alert creation.
 */
export function isSilenced(
  until: string | null | undefined,
  now: number = Date.now(),
): boolean {
  return !!until && Date.parse(until) > now;
}
