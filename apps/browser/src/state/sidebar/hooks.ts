import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { activeTabId, tabTitle, viewTabIds } from "../browser/model";
import { liveTabPlace } from "../live/rows";
import { awayFromLiveItem } from "../live/liveHome";
import type { LiveItem } from "../live/types";
import type { Tab } from "../browser/types";
import { cleanedTabsFor } from "../pins/closedTabs";
import { groupLabel } from "../pins/tabGrouping";
import { canTidyTabs } from "../tidy/tidyTabs";
import { useTidyKey } from "../tidy/hooks";
import { useTidyRunning } from "../tidy/tidyUi";
import { folderIn } from "../pins/tileFolders";
import { useStoreWhile } from "../tabs/tabWatch";
import { splitOf, splitRowPanes } from "../splits/splits";
import { downloadsIn } from "../downloads/downloadsSlice";
import { folderPath, groupEntries, sidebarEntries } from "./entries";
import { keptEntry } from "./geometry";
import { folderChildren } from "./pinnedTree";
import { groupTabIds } from "./groupPanelRows";
import { capture, type Capture } from "./listCapture";
import { pinnedCollapsed, pinnedKept } from "./pinnedFold";
import { useSidebarUi, type Hover } from "./sidebarUi";
import { fittedSidebarWidth } from "./sidebarWidth";

export function useSidebarWidth(windowId: string): number {
  return useSidebarWidthOf(windowId, (width) => width);
}

export function useSidebarWidthOf<T>(windowId: string, of: (width: number) => T): T {
  const fitted = useBrowser((s) => fittedSidebarWidth(s, windowId));
  return useSidebarUi((u) => of(u.dragWidth[windowId] ?? fitted));
}

export const useIsInSplit = (tabId: string) => useBrowser((s) => !!splitOf(s, tabId));

export const useDragGhostLabel = (folderName: string | undefined, groupId: string | undefined, tab: Tab | undefined) =>
  useBrowser((s) => folderName ?? (groupId && s.groups[groupId] ? groupLabel(s, s.groups[groupId]!) : tab ? tabTitle(tab) : ""));

const NO_TABS: string[] = [];

export const useSplitRowPanes = (splitId: string) => useBrowser(useShallow((s) => splitRowPanes(s, s.splits[splitId])));

export const useGroupTabIds = (groupId: string) => useBrowser(useShallow((s) => s.groups[groupId]?.tabIds ?? NO_TABS));

export const useIconPickerCurrent = (kind: "tab" | "group" | "live" | "folder", id: string, liveIcon: string | null | undefined) =>
  useBrowser((s) => (kind === "tab" ? s.tabs[id]?.customIcon : kind === "live" ? liveIcon : s.groups[id]?.icon) ?? null);

export const useCapturedGroupEntries = (groupId: string, captured: Capture) =>
  useBrowser(
    useShallow((s) => {
      const list = groupEntries(s, groupId);
      return capture(captured, s, list, list);
    }),
  );

export const useCapturedSidebarEntries = (windowId: string, profileId: string, captured: Capture) =>
  useBrowser((s) => {
    const entries = sidebarEntries(s, windowId, profileId);
    return capture(captured, s, entries.list, entries);
  });

export const useCapturedFolderChildren = (windowId: string, profileId: string, groupId: string, captured: Capture) =>
  useBrowser(
    useShallow((s) => {
      const list = folderChildren(s, windowId, profileId, groupId);
      return capture(captured, s, list, list);
    }),
  );

export const useSelectionInFolder = (windowId: string, profileId: string, groupId: string) =>
  useBrowser((s) => {
    const selection = s.selection[windowId];
    return !!selection?.length && selection.some((id) => !!s.groups[groupId]?.tabIds.includes(id) || folderPath(s, windowId, profileId, id).includes(groupId));
  });

export const useKeptEntry = (windowId: string, profileId: string, entries: string[]) => useBrowser((s) => keptEntry(s, windowId, profileId, entries));

export const useKeptPin = (windowId: string, profileId: string, pinned: string[], live: boolean) => useBrowser((s) => (live ? keptEntry(s, windowId, profileId, pinned) : null));

export const usePinnedCollapsed = (profileId: string) => useBrowser((s) => pinnedCollapsed(s, profileId));

export const usePinnedKept = (windowId: string, profileId: string, entries: string[]) => useBrowser((s) => pinnedKept(s, windowId, profileId, entries));

export const useGroupFirstTabIcon = (groupId: string) =>
  useBrowser(
    useShallow((s) => {
      const t = s.tabs[s.groups[groupId]?.tabIds[0] ?? ""];
      return t && { url: t.url, favicon: t.favicon, customIcon: t.customIcon, profileId: t.profileId };
    }),
  );

export const useHasDownloads = (windowId: string) => useBrowser((s) => downloadsIn(s, windowId).length > 0);

export const useNoTiles = (windowId: string, profileId: string) => useBrowser((s) => sidebarEntries(s, windowId, profileId).tiles.length === 0);

export const useTileCellCount = (windowId: string, profileId: string) => useBrowser((s) => sidebarEntries(s, windowId, profileId).cells.length);

const NO_CELLS: string[] = [];

export const useSidebarCells = (windowId: string, profileId: string, offScreen: boolean) =>
  useBrowser((s) => (offScreen ? NO_CELLS : sidebarEntries(s, windowId, profileId).cells));

export function useCanTidyTabs(windowId: string, profileId: string, offScreen: boolean): boolean {
  const saved = useTidyKey();
  const can = useBrowser((s) => !offScreen && canTidyTabs(s, windowId, profileId));
  return can && saved;
}

export const useTidyingTabs = (profileId: string) => useTidyRunning((s) => !!s.profiles[profileId]);

export const useCleanedCount = (windowId: string) => useBrowser((s) => cleanedTabsFor(s, windowId).length);

export const useShownTabId = (windowId: string) => useBrowser((s) => activeTabId(s, windowId));

export const useIsShownTab = (windowId: string, tabId: string) => useBrowser((s) => activeTabId(s, windowId) === tabId);

export const useHoverOrphaned = (windowId: string, hover: Hover | null) =>
  useStoreWhile(
    useBrowser,
    !!hover,
    (s) => (hover?.kind === "tab" && !s.tabs[hover.id]) || (hover?.kind === "group" && !s.groups[hover.id]) || (hover?.kind === "folder" && !folderIn(s, windowId, hover.id)),
  );

export const useGroupPanelTabIds = (groupId: string) => useBrowser(useShallow((s) => groupTabIds(s.groups, groupId)));

export const useTabsById = (ids: string[]) => useBrowser(useShallow((s) => ids.map((id) => s.tabs[id])));

export const useClosedTabs = () => useBrowser((s) => s.closedTabs);

export const useClosedGroups = () => useBrowser((s) => s.closedGroups);

export const useLiveStrays = (windowId: string, profileId: string, folderId: string, itemIds: Set<string>, hiddenIds: Set<string>) =>
  useBrowser(
    useShallow((s) =>
      viewTabIds(s, windowId, profileId).filter((id) => s.tabs[id]?.liveItem?.folderId === folderId && liveTabPlace(s.tabs[id]!.liveItem!.itemId, itemIds, hiddenIds) === "stray"),
    ),
  );

export const useLiveActiveTab = (windowId: string, profileId: string, folderId: string, itemIds: Set<string>, hiddenIds: Set<string>) =>
  useBrowser((s) => {
    const id = activeTabId(s, windowId, profileId) ?? "";
    const liveItem = s.tabs[id]?.liveItem;
    return liveItem?.folderId === folderId && liveTabPlace(liveItem.itemId, itemIds, hiddenIds) !== "hidden" ? id : null;
  });

export const useLiveItemTab = (windowId: string, profileId: string, folderId: string, itemId: string) =>
  useBrowser((s) => viewTabIds(s, windowId, profileId).find((id) => s.tabs[id]?.liveItem?.itemId === itemId && s.tabs[id]?.liveItem?.folderId === folderId) ?? null);

export const useLiveTabAway = (tabId: string | null, item: Pick<LiveItem, "url">) => useBrowser((s) => !!tabId && awayFromLiveItem(s.tabs[tabId]?.url, item));

export const useIsActiveIn = (windowId: string, profileId: string, tabId: string | null) => useBrowser((s) => !!tabId && activeTabId(s, windowId, profileId) === tabId);

