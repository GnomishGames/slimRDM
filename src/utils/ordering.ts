import { Category, Connection, Group, TunnelConfig } from "../types";

// Single source of truth for the order of every list the UI renders. Ordering
// used to happen in three places at once — the Rust list_* commands, the
// appStore mutations, and nowhere at all for categories — so what you saw
// depended on which code path last touched the array (creation order at launch,
// alphabetical after an edit). It happens here and only here now.
//
// "en"                → the same slimrdm.json orders identically on every
//                       machine, rather than following the system locale
// numeric: true       → "T2" before "T10", not lexically between "T1" and "T3"
// case-insensitive at the primary level, but case still breaks a tie, so
// "core" and "Core" get a fixed order instead of falling back to array order
const collator = new Intl.Collator("en", { numeric: true });

/** Compares by display name, falling back to id so the order is always total. */
function byName<T extends { id: string }>(name: (item: T) => string) {
  return (a: T, b: T) => collator.compare(name(a), name(b)) || collator.compare(a.id, b.id);
}

const byConnectionLabel = byName<Connection>((c) => c.label);
const byGroupName = byName<Group>((g) => g.name);
const byCategoryName = byName<Category>((c) => c.name);
const byTunnelName = byName<TunnelConfig>((t) => t.name);

export function sortConnections(connections: Connection[]): Connection[] {
  return [...connections].sort(byConnectionLabel);
}

export function sortGroups(groups: Group[]): Group[] {
  return [...groups].sort(byGroupName);
}

export function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort(byCategoryName);
}

export function sortTunnels(tunnels: TunnelConfig[]): TunnelConfig[] {
  return [...tunnels].sort(byTunnelName);
}

export function groupsInCategory(groups: Group[], categoryId: string): Group[] {
  return sortGroups(groups.filter((g) => g.categoryId === categoryId));
}

/**
 * Groups rendered at the top level: those in no category, plus any whose
 * categoryId points at a category that no longer exists. Without that fallback
 * an orphaned group renders nowhere at all — it is filtered out of every
 * category section and out of the top level too.
 */
export function uncategorizedGroups(groups: Group[], categories: Category[]): Group[] {
  const known = new Set(categories.map((c) => c.id));
  return sortGroups(groups.filter((g) => !g.categoryId || !known.has(g.categoryId)));
}

/** Connections rendered at the top level — same orphan rescue as above, for groups. */
export function ungroupedConnections(connections: Connection[], groups: Group[]): Connection[] {
  const known = new Set(groups.map((g) => g.id));
  return sortConnections(connections.filter((c) => !c.groupId || !known.has(c.groupId)));
}
