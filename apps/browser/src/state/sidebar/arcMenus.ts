import { chooseFromMenu, type ChoiceItem } from "../app/menuChoice";
import { switchProfile } from "../browser/actions";
import { useBrowser } from "../browser/store";
import { menuShortcut } from "../commands/commandShortcuts";
import { updateProfile } from "../profiles/actions";
import type { IconChoice, IconMenuItem } from "../profiles/profileMenu";
import { openSettings } from "../settings/settingsWindows";
import { startRename } from "./actions";
import { newLiveFolderMenuItem, runNewLiveFolder } from "./liveMenus";
import { recentlyCleanedItem, recentlyClosedItem, runRestoreChoice, type RestoreChoice } from "./menus";
import { sep } from "./menuParts";
import { shownNodes } from "./pinnedTree";

const store = () => useBrowser.getState();

export async function openLibraryMenu(windowId: string) {
  const s = store();
  const w = s.windows[windowId];
  if (!w) return;
  const choice = await chooseFromMenu<RestoreChoice, string>([
    { id: "downloads", title: "Downloads", symbol: "arrow.down.circle", ...menuShortcut("downloads", s) },
    sep,
    recentlyCleanedItem(windowId),
    recentlyClosedItem(w.profileId),
    sep,
    { id: "profiles", title: "Profiles", symbol: "person.2" },
  ]);
  if (!choice || runRestoreChoice(windowId, choice)) return;
  if (choice === "downloads") store().setDownloadsOpen(windowId, !store().windowUi[windowId]?.downloadsOpen);
  else if (choice === "profiles") openSettings("profiles", w.profileId);
}

async function changeProfileIcon(profileId: string, iconItems: (current: string | null) => IconMenuItem[]) {
  const profile = store().profiles[profileId];
  if (!profile) return;
  const choice = await chooseFromMenu<IconChoice, "emoji">(iconItems(profile.icon));
  if (!choice || typeof choice !== "object" || !store().profiles[profileId]) return;
  updateProfile(profileId, { icon: choice.icon });
}

export function newPinnedFolder(windowId: string, profileId = store().windows[windowId]?.profileId) {
  if (!profileId) return;
  const id = store().newFolder(windowId, { profileId, siblings: shownNodes(store(), windowId, profileId, null) });
  if (id) void startRename(windowId, { kind: "group", id });
}

type SwitchChoice = { switchTo: string };

export async function openSpaceMenu(windowId: string, profileId: string, iconItems: (current: string | null) => IconMenuItem[]) {
  const s = store();
  if (!s.profiles[profileId]) return;
  const showsProfile = () => store().windows[windowId]?.profileId === profileId;
  const switchItems: ChoiceItem<SwitchChoice>[] = s.profileOrder.flatMap((id) => {
    const profile = s.profiles[id];
    return profile ? [{ value: { switchTo: id }, title: profile.name, checked: id === s.windows[windowId]?.profileId }] : [];
  });
  const choice = await chooseFromMenu<SwitchChoice, string>([
    { id: "space:icon", title: "Change Profile Icon…" },
    { id: "space:rename", title: "Rename Profile…" },
    { id: "space:theme", title: "Edit Theme Color…" },
    ...(showsProfile() ? [sep, { id: "space:folder", title: "New Folder", symbol: "folder.badge.plus" }, newLiveFolderMenuItem()] : []),
    sep,
    { id: "space:switch", title: "Switch Profile", children: switchItems },
    { id: "space:manage", title: "Manage Profiles…" },
  ]);
  if (!choice) return;
  if (typeof choice !== "string") return switchProfile(windowId, choice.switchTo, true);
  if (choice === "space:manage") return openSettings("profiles");
  if (!store().profiles[profileId]) return;
  if (choice === "space:icon") void changeProfileIcon(profileId, iconItems);
  else if (choice === "space:rename" || choice === "space:theme") openSettings("profiles", profileId);
  else if (!showsProfile()) return;
  else if (choice === "space:folder") newPinnedFolder(windowId, profileId);
  else runNewLiveFolder(windowId, choice);
}
