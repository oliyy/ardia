import type { BrowserState } from "../browser/store";
import type { TabGroup } from "../browser/types";
import { pinKeyOf } from "../browser/model";
import { shownSubtree } from "./folderTree";
import { withoutEmptiedFolders } from "./placing";
import { groupNode, instancesIn, isGroupNode, isTabNode, placedAt, placeNodes, tableOf, tabNode, withTable, type PinTable } from "./pinTree";

export function withFolderMovedToProfile(before: BrowserState, after: BrowserState, g: TabGroup, profileId: string, ids: Map<string, string>): BrowserState {
  const w = before.windows[g.windowId];
  const { table, root, subtree } = shownSubtree(before, g);
  if (!g.pinned || !w || !table[root]) return withoutEmptiedFolders(before, after);
  const inst = instancesIn(before, w, g.profileId, table);
  const movedNode = (node: string): string | undefined => {
    if (isGroupNode(node)) {
      const id = ids.get(inst.groups.get(node) ?? (node === root ? g.id : ""));
      const moved = id ? after.groups[id] : undefined;
      return moved?.profileId === profileId ? groupNode(pinKeyOf(moved)) : undefined;
    }
    const id = isTabNode(node) ? inst.tabs.get(node) : undefined;
    const moved = id ? after.tabs[id] : undefined;
    return moved?.profileId === profileId ? tabNode(pinKeyOf(moved)) : undefined;
  };
  const top = movedNode(root);
  if (!top) return withoutEmptiedFolders(before, after);
  const placed: PinTable = { ...tableOf(after.pinPlace, profileId) };
  for (const node of subtree) {
    const target = movedNode(node);
    const place = table[node];
    const parent = place?.parent ? movedNode(place.parent) : undefined;
    if (node !== root && target && place && parent) placed[target] = placedAt(place, parent, place.pos);
  }
  const moved = { ...after, pinPlace: placeNodes(withTable(after.pinPlace, profileId, placed), profileId, [top], null, null) };
  const shownElsewhere = Object.values(after.groups).some((x) => x.id !== g.id && x.profileId === g.profileId && x.pinned && x.tabIds.length > 0 && pinKeyOf(x) === pinKeyOf(g));
  return shownElsewhere ? moved : withoutEmptiedFolders(before, moved);
}
