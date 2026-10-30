import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Download } from "../../platform/downloads";
import { useBrowser } from "../browser/store";
import { downloadSession } from "../downloads/downloadsSlice";
import { archivedEntries, type ArchivedRow } from "../pins/archive";
import { useLibraryStore, type LibraryView } from "./store";

export const useLibraryView = (windowId: string): LibraryView | undefined => useLibraryStore((all) => all[windowId]);

export const useLibraryVisible = (windowId: string) => useLibraryStore((all) => !!all[windowId]);

export function useArchivedRows(windowId: string): ArchivedRow[] {
  const inputs = useBrowser(
    useShallow((s) => ({
      windows: s.windows,
      tabs: s.tabs,
      parkedPins: s.parkedPins,
      closedTabs: s.closedTabs,
      closedGroups: s.closedGroups,
      cleanedTabs: s.cleanedTabs,
      privateCleanedTabs: s.privateCleanedTabs,
    })),
  );
  return useMemo(() => archivedEntries(inputs, windowId), [inputs, windowId]);
}

export const useDownloadSession = (d: Pick<Download, "profile" | "offTheRecord">) => useBrowser((s) => downloadSession(s, d));
