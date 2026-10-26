import { useBrowser } from "../../store/browser";
import { isSmallWindow } from "../../store/small";
import { addressBarInSidebar } from "../layout/windowLayout";
import { dismissHoverIn } from "../sidebar/hover";
import { cancelPlusMenu } from "../sidebar/PlusMenu";
import { setSidebarUi, sidebarUi, useSidebarUi } from "../sidebar/state";
import { cancelSwitcher } from "../sidebar/switcher";
import { closeFolderPanelIn } from "../sidebar/tileFolderUi";
import { closeLibrary, libraryVisible, libraryWindows, showLibrary, type LibrarySection } from "./store";

const blockers = new Map<string, () => boolean>();

export function libraryAvailable(windowId: string): boolean {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  return !!w && !isSmallWindow(w) && addressBarInSidebar(s, windowId);
}

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
  const s = useBrowser.getState();
  if (s.windowUi[windowId]?.downloadsOpen) s.setDownloadsOpen(windowId, false);
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
