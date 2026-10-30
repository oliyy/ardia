import { useBrowser, type BrowserState } from "../browser/store";
import { pinKeyOf } from "../browser/model";
import { groupNode, liveNode, tabNode } from "../pins/pinTree";
import { dropTabs, placePinned } from "../pins/actions";
import type { TabPlacement } from "../pins/placing";
import { entryNode, shownNodes } from "../sidebar/pinnedTree";
import type { Drop } from "./drops";

export type PinnedSpot = { parent: string | null; before: string | null };

export type PinnedMover = { kind: string; tabIds: readonly string[]; groupId?: string; liveFolderId?: string };

type PinnedAt = { profileId: string; parent: string | null; beforeNode: string | null; siblings: string[] };

const nodesOf =
  (s: BrowserState) =>
  (m: PinnedMover): string[] => {
    if (m.kind === "live") return m.liveFolderId ? [liveNode(m.liveFolderId)] : [];
    if (m.kind === "group") return m.groupId && s.groups[m.groupId] ? [groupNode(pinKeyOf(s.groups[m.groupId]!))] : [];
    return m.tabIds.flatMap((id) => (s.tabs[id] ? [tabNode(pinKeyOf(s.tabs[id]!))] : []));
  };

function pinnedAt(s: BrowserState, windowId: string, spot: PinnedSpot, movers: readonly PinnedMover[]): PinnedAt | null {
  const profileId = s.windows[windowId]?.profileId;
  const folder = spot.parent ? s.groups[spot.parent] : undefined;
  if (!profileId || (spot.parent && !folder?.pinned)) return null;
  const parent = folder ? groupNode(pinKeyOf(folder)) : null;
  const moving = new Set(movers.flatMap(nodesOf(s)));
  const beforeNode = spot.before ? entryNode(s, windowId, profileId, parent, spot.before, moving) : null;
  return { profileId, parent, beforeNode, siblings: shownNodes(s, windowId, profileId, parent) };
}

const pinnedTabs = (spot: PinnedSpot, { beforeNode, siblings }: PinnedAt): TabPlacement =>
  spot.parent ? { pinned: false, groupId: spot.parent, beforeNode, siblings } : { pinned: true, row: true, beforeNode, siblings };

export function pinnedPlacementNow(windowId: string, spot: PinnedSpot): TabPlacement | null {
  const at = pinnedAt(useBrowser.getState(), windowId, spot, []);
  return at && pinnedTabs(spot, at);
}

export function dropPinnedNow(windowId: string, drop: Drop, spot: PinnedSpot, movers: readonly PinnedMover[]) {
  const at = pinnedAt(useBrowser.getState(), windowId, spot, movers);
  if (!at) return;
  if (drop.type === "tabs") return void dropTabs(movers.flatMap((m) => m.tabIds), { type: "tabs", placement: pinnedTabs(spot, at) });
  if (drop.type === "group") return void dropTabs([], { type: "group", groupId: drop.groupId, placement: { pinned: true, parent: at.parent, beforeNode: at.beforeNode, siblings: at.siblings } });
  const liveFolderId = movers[0]?.liveFolderId;
  if (drop.type === "live" && liveFolderId) placePinned(at.profileId, [liveNode(liveFolderId)], at.parent, at.beforeNode, at.siblings);
}
