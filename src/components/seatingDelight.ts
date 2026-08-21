/**
 * Decide whether a search result transition deserves a celebration: exactly
 * one guest matched, and we have not celebrated that guest before. Returns
 * the updated seen-set (new Set) when celebrating, else null.
 */
export function celebrateSingleMatch(
  matchedGuestIds: readonly string[],
  seen: ReadonlySet<string>,
): Set<string> | null {
  if (matchedGuestIds.length !== 1) return null;
  const id = matchedGuestIds[0] as string;
  if (seen.has(id)) return null;
  return new Set(seen).add(id);
}
