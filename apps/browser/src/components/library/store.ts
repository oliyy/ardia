import { create } from "zustand";
import type { ArchiveFilter, DownloadFilter } from "./groups";

export type LibrarySection = "downloads" | "archived";

export type LibraryView = {
  section: LibrarySection;
  query: Record<LibrarySection, string>;
  downloadFilter: DownloadFilter;
  archiveFilter: ArchiveFilter;
};

const useLibraryStore = create<Record<string, LibraryView>>()(() => ({}));
const openings = new Map<string, number>();

const freshView = (section: LibrarySection): LibraryView => ({ section, query: { downloads: "", archived: "" }, downloadFilter: "all", archiveFilter: "all" });

export const libraryVisible = (windowId: string) => !!useLibraryStore.getState()[windowId];

export const libraryWindows = () => Object.keys(useLibraryStore.getState());

export const libraryOpenings = (windowId: string) => openings.get(windowId) ?? 0;

export const useLibraryView = (windowId: string): LibraryView | undefined => useLibraryStore((all) => all[windowId]);

export const useLibraryVisible = (windowId: string) => useLibraryStore((all) => !!all[windowId]);

export const watchLibrary = (changed: () => void) => useLibraryStore.subscribe(changed);

export function showLibrary(windowId: string, section?: LibrarySection) {
  const shown = useLibraryStore.getState()[windowId];
  if (!shown) {
    openings.set(windowId, libraryOpenings(windowId) + 1);
    useLibraryStore.setState({ [windowId]: freshView(section ?? "downloads") });
  } else if (section && section !== shown.section) useLibraryStore.setState({ [windowId]: { ...shown, section } });
}

export function closeLibrary(windowId: string) {
  const { [windowId]: shown, ...rest } = useLibraryStore.getState();
  if (shown) useLibraryStore.setState(rest, true);
}

export function updateLibrary(windowId: string, patch: (view: LibraryView) => Partial<LibraryView>) {
  const view = useLibraryStore.getState()[windowId];
  if (view) useLibraryStore.setState({ [windowId]: { ...view, ...patch(view) } });
}
