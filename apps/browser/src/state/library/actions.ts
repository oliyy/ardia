import { useBrowser } from "../browser/store";
import { dismissHoverIn } from "../sidebar/hover";
import { cancelPlusMenu } from "../sidebar/plusMenu";
import { setSidebarUi, sidebarUi, useSidebarUi } from "../sidebar/sidebarUi";
import { cancelSwitcher } from "../sidebar/switcher";
import { closeFolderPanelIn } from "../sidebar/tileFolderUi";
import { setDownloadsOpen } from "../windows/actions";
import { addressBarInSidebar } from "../windows/layout";
import { isSmallWindow } from "../windows/small";
import { closeLibrary, libraryVisible, libraryWindows, showLibrary, type LibrarySection } from "./store";

const blockers = new Map<string, () => boolean>();

export function libraryAvailable(windowId: string): boolean {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  return !!w && !isSmallWindow(w) && addressBarInSidebar(s, windowId);
}

export function libraryScope(windowId: string): string | null {
  const w = useBrowser.getState().windows[windowId];
  return w ? `${w.profileId}\n${w.kind === "private" ? 1 : 0}` : null;
}

export const libraryInvalid = (windowId: string, scope: string | null) => !libraryAvailable(windowId) || libraryScope(windowId) !== scope;

export const whenLibraryInvalid = (windowId: string, scope: string | null, invalid: () => void) =>
  useBrowser.subscribe(() => {
    if (!libraryVisible(windowId) && libraryInvalid(windowId, scope)) invalid();
  });

export function blockLibraryWhile(windowId: string, blocked: () => boolean) {
  blockers.set(windowId, blocked);
  return () => {
    if (blockers.get(windowId) === blocked) blockers.delete(windowId);
  };
}

function dismissSidebarTransients(windowId: string) {
  const ui = sidebarUi();
  cancelPlusMenu();
  if (ui.switcher?.windowId === windowId) cancelSwitcher();
  setSidebarUi({
    ...(ui.renaming?.windowId === windowId ? { renaming: null } : {}),
    ...(ui.iconPicker?.windowId === windowId ? { iconPicker: null } : {}),
    ...(ui.searchTabs === windowId ? { searchTabs: null } : {}),
    ...(ui.hover?.windowId === windowId ? { hover: null } : {}),
  });
  closeFolderPanelIn(windowId);
  dismissHoverIn(windowId);
}

export function openLibrary(windowId: string, section?: LibrarySection): boolean {
  if (!libraryAvailable(windowId) || blockers.get(windowId)?.()) return false;
  showLibrary(windowId, section);
  if (useBrowser.getState().windowUi[windowId]?.downloadsOpen) setDownloadsOpen(windowId, false);
  dismissSidebarTransients(windowId);
  return true;
}

export function toggleLibrary(windowId: string) {
  if (libraryVisible(windowId)) closeLibrary(windowId);
  else openLibrary(windowId);
}

const g = globalThis as { __acLibraryWatch?: () => void };
g.__acLibraryWatch?.();
const unwatchBrowser = useBrowser.subscribe((s, prev) => {
  if (s.windows === prev.windows && s.settings === prev.settings) return;
  for (const windowId of libraryWindows()) if (!libraryAvailable(windowId)) closeLibrary(windowId);
});
const unwatchSidebar = useSidebarUi.subscribe((ui) => {
  if (ui.renaming && libraryVisible(ui.renaming.windowId)) setSidebarUi({ renaming: null });
  if (ui.iconPicker && libraryVisible(ui.iconPicker.windowId)) setSidebarUi({ iconPicker: null });
});
g.__acLibraryWatch = () => {
  unwatchBrowser();
  unwatchSidebar();
};
