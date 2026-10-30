import { canonical, type Adapter, type Extraction } from "../../platform/sync";
import { samePage } from "../../lib/url";
import { useBrowser, type BrowserState } from "../browser/store";
import { IDLE_LIVE, isIncognitoProfile, makeTab, newId, pinKeyOf, ROW_PIN, TILE_PIN, without } from "../browser/model";
import type { ParkedPins, Tab, TabPin } from "../browser/types";
import { leaveGroups } from "../groups/groups";
import { removeFolder, restoreFolder, updateFolder, useLive } from "../live/store";
import type { LiveFolder } from "../live/types";
import { groupChoiceKey, orderChoiceKey, placeChoiceKey } from "../pins/pinChoices";
import { homeTitle } from "../pins/pinMirror";
import { groupNode, isGroupNode, isLiveNode, isTabNode, keyOfNode, liveNode, nodesExisting, tableOf, tabNode, withTable, type PinPlace, type PinTable } from "../pins/pinTree";
import { noteRemotePinDeletion } from "../pins/tabCleanup";
import { ASLEEP, hasOwnOrSharedPage, hasPage, wakeOf, withWake } from "../tabs/pageSession";
import { removeTabs } from "../tabs/tabs";
import { isPinNode, PIN_NODE, PIN_TREE, pinNodeRecord, type PinFolderRecord, type PinLiveProps, type PinLiveRecord, type PinNodeProps, type PinNodeRecord, type PinTabRecord } from "./pinRecords";
import { choiceStillOut, homeWindow, settleChoices, store, windowsByFocus } from "./pinnedSyncState";

type ParkedTab = ParkedPins["tabs"][number];

const placeholder = (t: Tab) => !hasOwnOrSharedPage(t) && !wakeOf(t);
const folderKeyOf = (parent: string | null) => (parent !== null && isGroupNode(parent) ? keyOfNode(parent) : null);
const isLeafPlace = (place: PinPlace | undefined): place is PinPlace => !!place && folderKeyOf(place.parent) !== null;
const unchangedOr = <T>(list: T[], next: T[]) => (next.some((x, i) => x !== list[i]) ? next : list);
const pinAt = (parent: string | null, was: TabPin | null | undefined): TabPin | null =>
  folderKeyOf(parent) !== null ? null : parent === null ? ROW_PIN : was?.as === "tile" ? was : TILE_PIN;

const placeEntryOf = (r: PinNodeRecord): PinPlace => (r.kind === "tab" ? { parent: r.parent, pos: r.pos, url: r.url, title: r.title } : { parent: r.parent, pos: r.pos });

const sameEntry = (a: PinPlace, z: PinPlace) => a.parent === z.parent && a.pos === z.pos && a.url === z.url && a.title === z.title;

function addressOf(place: PinPlace | undefined, own: Pick<Tab, "url" | "title"> & { pinnedUrl?: string | null }, others: Pick<Tab, "url" | "title">[] = []) {
  if (isLeafPlace(place)) return place.url !== undefined ? { url: place.url, title: place.title ?? "" } : { url: own.url, title: own.title };
  const url = own.pinnedUrl || own.url;
  return { url, title: homeTitle(place, url) ?? [own, ...others].find((t) => t.title && samePage(t.url, url))?.title ?? own.title };
}

const liveProps = (f: LiveFolder): PinLiveProps => ({
  kind: "live",
  liveKind: f.kind,
  name: f.name,
  icon: f.icon,
  sources: [...f.sources],
  filters: { authored: f.filters.authored, reviewRequests: f.filters.reviewRequests, teamReviewRequests: f.filters.teamReviewRequests },
  hiddenRepos: [...f.hiddenRepos],
  groupStacks: f.groupStacks,
  showCompleted: f.showCompleted,
  createdAt: f.createdAt,
});

function pinnedProps(s: BrowserState, profileId: string, table: PinTable): Map<string, PinNodeProps> {
  const props = new Map<string, PinNodeProps>();
  const windows = windowsByFocus(s);
  const instances = new Map<string, Tab[]>();
  for (const w of windows) {
    for (const id of w.tabIds) {
      const t = s.tabs[id];
      if (!t || t.profileId !== profileId || t.liveItem) continue;
      const node = tabNode(pinKeyOf(t));
      const list = instances.get(node);
      if (list) list.push(t);
      else instances.set(node, [t]);
    }
  }
  for (const [node, list] of instances) {
    const source = list[0]!;
    props.set(node, { kind: "tab", ...addressOf(table[node], source, list.slice(1)), customTitle: source.customTitle, customIcon: source.customIcon });
  }
  const rank = new Map(windows.map((w, i) => [w.id, i]));
  const folders = Object.values(s.groups)
    .filter((g) => g.pinned && g.profileId === profileId && rank.has(g.windowId))
    .sort((a, z) => rank.get(a.windowId)! - rank.get(z.windowId)!);
  for (const g of folders) {
    const node = groupNode(pinKeyOf(g));
    if (!props.has(node)) props.set(node, { kind: "folder", name: g.name, icon: g.icon, color: g.color });
  }
  const park = s.parkedPins[profileId];
  for (const p of park?.tabs ?? []) {
    const node = tabNode(p.id);
    if (!props.has(node)) props.set(node, { kind: "tab", ...addressOf(table[node], p), customTitle: p.customTitle, customIcon: p.customIcon });
  }
  for (const g of park?.groups ?? []) {
    const node = groupNode(g.id);
    if (!props.has(node)) props.set(node, { kind: "folder", name: g.name, icon: g.icon, color: g.color });
  }
  for (const f of Object.values(useLive.getState().folders)) if (f.profileId === profileId) props.set(liveNode(f.id), liveProps(f));
  return props;
}

function placedExactly(s: BrowserState, profileId: string, received: Map<string, PinNodeRecord>, removed: Set<string>): BrowserState {
  const table = tableOf(s.pinPlace, profileId);
  let next: PinTable | null = null;
  for (const [node, record] of received) {
    const was = table[node];
    const entry = placeEntryOf(record);
    if (was && sameEntry(was, entry)) continue;
    next ??= { ...table };
    next[node] = entry;
  }
  for (const node of removed) {
    if (!table[node]) continue;
    next ??= { ...table };
    delete next[node];
  }
  return next ? { ...s, pinPlace: withTable(s.pinPlace, profileId, next) } : s;
}

function withoutRemoved(s: BrowserState, profileId: string, removed: Set<string>, placedBefore: PinTable): BrowserState {
  const keysOf = (is: (node: string) => boolean) => new Set([...removed].filter((n) => is(n) && placedBefore[n]).map(keyOfNode));
  const tabKeys = keysOf(isTabNode);
  const groupKeys = keysOf(isGroupNode);
  const doomed = new Set(Object.values(s.tabs).filter((t) => t.profileId === profileId && !t.liveItem && tabKeys.has(pinKeyOf(t))).map((t) => t.id));
  const removable = [...doomed].filter((id) => {
    const t = s.tabs[id]!;
    const w = s.windows[t.windowId];
    return !!w && !hasPage(t) && !Object.values(w.activeTabIds).includes(id) && w.tabIds.some((other) => !doomed.has(other));
  });
  let next = s;
  if (doomed.size) {
    const tabs = { ...s.tabs };
    for (const id of doomed) if (!removable.includes(id)) tabs[id] = { ...tabs[id]!, pin: null, pinnedUrl: null, pinKey: undefined };
    next = removeTabs({ ...next, tabs }, removable, false);
  }
  const folders = Object.values(next.groups).filter((g) => g.pinned && g.profileId === profileId && groupKeys.has(pinKeyOf(g)));
  if (folders.length) next = { ...next, groups: without(next.groups, folders.map((g) => g.id)) };
  const park = next.parkedPins[profileId];
  if (!park) return next;
  const tabsLeft = park.tabs.filter((p) => !removed.has(tabNode(p.id)));
  const groupsLeft = park.groups.filter((g) => !removed.has(groupNode(g.id)));
  if (tabsLeft.length === park.tabs.length && groupsLeft.length === park.groups.length) return next;
  const parkedPins = tabsLeft.length || groupsLeft.length ? { ...next.parkedPins, [profileId]: { ...park, tabs: tabsLeft, groups: groupsLeft } } : without(next.parkedPins, [profileId]);
  return { ...next, parkedPins };
}

const parkedPlacement = (r: PinTabRecord, was?: TabPin | null) => {
  const groupId = folderKeyOf(r.parent);
  return { pin: pinAt(r.parent, was), pinnedUrl: groupId === null ? r.url : null, groupId };
};

function parkedTabFrom(p: ParkedTab, r: PinTabRecord): ParkedTab {
  const { restoreFrom, ...rest } = p;
  const moved = p.url !== r.url;
  const next: ParkedTab = {
    ...rest,
    url: r.url,
    title: r.title,
    ...(moved ? { favicon: null } : {}),
    customTitle: r.customTitle,
    customIcon: r.customIcon,
    ...parkedPlacement(r, p.pin),
    ...(restoreFrom && !moved ? { restoreFrom } : {}),
  };
  return canonical(next) === canonical(p) ? p : next;
}

const newParkedTab = (key: string, profileId: string, r: PinTabRecord): ParkedTab => ({
  id: key,
  profileId,
  url: r.url,
  title: r.title,
  favicon: null,
  muted: false,
  zoom: 1,
  customTitle: r.customTitle,
  customIcon: r.customIcon,
  ...parkedPlacement(r),
});

function withReceived(s: BrowserState, profileId: string, received: Map<string, PinNodeRecord>): BrowserState {
  const home = homeWindow(s, profileId);
  let tabs = s.tabs;
  let groups = s.groups;
  let live = s.live;
  const added: string[] = [];
  const park = s.parkedPins[profileId];
  let parkTabs = park?.tabs ?? [];
  let parkGroups = park?.groups ?? [];
  const tabIdsOf = new Map<string, string[]>();
  for (const t of Object.values(s.tabs)) if (t.profileId === profileId && !t.liveItem) tabIdsOf.set(pinKeyOf(t), [...(tabIdsOf.get(pinKeyOf(t)) ?? []), t.id]);
  const groupIdsOf = new Map<string, string[]>();
  for (const g of Object.values(s.groups)) if (g.pinned && g.profileId === profileId && s.windows[g.windowId]) groupIdsOf.set(pinKeyOf(g), [...(groupIdsOf.get(pinKeyOf(g)) ?? []), g.id]);
  const editTab = (id: string, patch: Partial<Tab>) => {
    const t = tabs[id]!;
    if (Object.entries(patch).every(([k, v]) => t[k as keyof Tab] === v)) return;
    if (tabs === s.tabs) tabs = { ...s.tabs };
    tabs[id] = { ...t, ...patch };
  };
  const claimed = new Set<string>();
  const placeTab = (key: string, r: PinTabRecord) => {
    const leaf = folderKeyOf(r.parent) !== null;
    const ids = tabIdsOf.get(key) ?? [];
    for (const id of ids) {
      claimed.add(id);
      const t = tabs[id]!;
      const staleRestore = leaf && !!wakeOf(t) && !hasOwnOrSharedPage(t) && !samePage(t.url, r.url);
      editTab(id, {
        customTitle: r.customTitle,
        customIcon: r.customIcon,
        ...(leaf ? {} : { pinnedUrl: r.url }),
        ...(staleRestore ? { page: withWake(t.page, undefined) } : {}),
        ...(placeholder(t) || staleRestore ? { url: r.url, title: r.title, ...(t.url !== r.url ? { favicon: null } : {}) } : {}),
      });
    }
    parkTabs = unchangedOr(parkTabs, parkTabs.map((p) => (p.id === key ? parkedTabFrom(p, r) : p)));
    if (ids.length || parkTabs.some((p) => p.id === key)) return;
    if (!home) {
      parkTabs = [...parkTabs, newParkedTab(key, profileId, r)];
      return;
    }
    const id = tabs[key] ? newId("tab") : key;
    const tab: Tab = {
      ...makeTab(home.id, profileId, r.url, {
        title: r.title,
        pin: pinAt(r.parent, null),
        pinnedUrl: leaf ? null : r.url,
        customTitle: r.customTitle,
        customIcon: r.customIcon,
      }),
      id,
      ...(id === key ? {} : { pinKey: key }),
      page: ASLEEP,
    };
    if (tabs === s.tabs) tabs = { ...s.tabs };
    if (live === s.live) live = { ...s.live };
    tabs[id] = tab;
    live[id] = IDLE_LIVE;
    added.push(id);
  };
  const placeFolder = (key: string, r: PinFolderRecord) => {
    const ids = groupIdsOf.get(key) ?? [];
    for (const id of ids) {
      const g = groups[id]!;
      if (g.name === r.name && g.icon === r.icon && g.color === r.color) continue;
      if (groups === s.groups) groups = { ...s.groups };
      groups[id] = { ...g, name: r.name, icon: r.icon, color: r.color };
    }
    parkGroups = unchangedOr(parkGroups, parkGroups.map((g) => (g.id === key && (g.name !== r.name || g.icon !== r.icon || g.color !== r.color) ? { ...g, name: r.name, icon: r.icon, color: r.color } : g)));
    if (ids.length || parkGroups.some((g) => g.id === key)) return;
    if (!home) {
      parkGroups = [...parkGroups, { id: key, name: r.name, icon: r.icon, color: r.color, collapsed: false }];
      return;
    }
    if (groups === s.groups) groups = { ...s.groups };
    const id = groups[key] ? newId("g") : key;
    groups[id] = { id, windowId: home.id, profileId, name: r.name, icon: r.icon, color: r.color, collapsed: false, pinned: true, tabIds: [], createdAt: Date.now(), ...(id === key ? {} : { pinKey: key }) };
  };
  for (const [node, r] of received) {
    if (r.kind === "tab") placeTab(keyOfNode(node), r);
    else if (r.kind === "folder") placeFolder(keyOfNode(node), r);
  }
  const regular = Object.fromEntries(Object.entries(groups).filter(([, g]) => !g.pinned));
  const leftRegular = leaveGroups(regular, claimed);
  if (leftRegular !== regular) groups = { ...Object.fromEntries(Object.entries(groups).filter(([, g]) => g.pinned)), ...leftRegular };
  const parkChanged = park ? parkTabs !== park.tabs || parkGroups !== park.groups : parkTabs.length > 0 || parkGroups.length > 0;
  if (tabs === s.tabs && groups === s.groups && !parkChanged) return s;
  const windows = home && added.length ? { ...s.windows, [home.id]: { ...home, tabIds: [...added, ...home.tabIds] } } : s.windows;
  const parkedPins = parkChanged ? { ...s.parkedPins, [profileId]: { ...park, tabs: parkTabs, groups: parkGroups } } : s.parkedPins;
  return { ...s, tabs, groups, live, windows, parkedPins };
}

function withOrphanHomes(s: BrowserState, profileId: string, touched: Set<string>): BrowserState {
  const table = tableOf(s.pinPlace, profileId);
  const exists = nodesExisting(s, profileId);
  const homes = new Map<string, string>();
  for (const node of touched) {
    const place = table[node];
    if (!isTabNode(node) || !isLeafPlace(place) || place.url === undefined) continue;
    const parent = place.parent!;
    if (!table[parent] || !exists(parent)) homes.set(keyOfNode(node), place.url);
  }
  if (!homes.size) return s;
  let tabs = s.tabs;
  for (const t of Object.values(s.tabs)) {
    const home = t.profileId === profileId && !t.liveItem ? homes.get(pinKeyOf(t)) : undefined;
    if (home === undefined || (t.pin && t.pinnedUrl === home)) continue;
    if (tabs === s.tabs) tabs = { ...s.tabs };
    tabs[t.id] = { ...t, pin: t.pin ?? ROW_PIN, pinnedUrl: home };
  }
  return tabs === s.tabs ? s : { ...s, tabs };
}

const choicesOf = (node: string) => (isTabNode(node) ? [keyOfNode(node), placeChoiceKey(keyOfNode(node))] : isGroupNode(node) ? [groupChoiceKey(keyOfNode(node)), orderChoiceKey(keyOfNode(node))] : []);

function liveChanges(f: LiveFolder, r: PinLiveRecord): Partial<Omit<LiveFolder, "id" | "profileId" | "kind">> | null {
  const patch: Partial<Omit<LiveFolder, "id" | "profileId" | "kind">> = {};
  if (f.name !== r.name) patch.name = r.name;
  if (f.icon !== r.icon) patch.icon = r.icon;
  if (f.groupStacks !== r.groupStacks) patch.groupStacks = r.groupStacks;
  if (f.showCompleted !== r.showCompleted) patch.showCompleted = r.showCompleted;
  if (f.createdAt !== r.createdAt) patch.createdAt = r.createdAt;
  if (canonical(f.sources) !== canonical(r.sources)) patch.sources = [...r.sources];
  if (canonical(f.filters) !== canonical(r.filters)) patch.filters = { ...r.filters };
  if (canonical(f.hiddenRepos) !== canonical(r.hiddenRepos)) patch.hiddenRepos = [...r.hiddenRepos];
  return Object.keys(patch).length ? patch : null;
}

function applyLiveDefinitions(profileId: string, received: Map<string, PinNodeRecord>, removed: Set<string>, placedBefore: PinTable) {
  const folders = useLive.getState().folders;
  for (const node of removed) {
    const id = keyOfNode(node);
    if (isLiveNode(node) && placedBefore[node] && folders[id]?.profileId === profileId) removeFolder(id);
  }
  for (const [node, r] of received) {
    if (r.kind !== "live") continue;
    const id = keyOfNode(node);
    const f = folders[id];
    if (!f) {
      restoreFolder({ id, profileId, kind: r.liveKind, name: r.name, icon: r.icon, collapsed: false, sources: r.sources, filters: r.filters, hiddenRepos: r.hiddenRepos, groupStacks: r.groupStacks, showCompleted: r.showCompleted, createdAt: r.createdAt });
      continue;
    }
    if (f.profileId !== profileId || f.kind !== r.liveKind) continue;
    const patch = liveChanges(f, r);
    if (patch) updateFolder(id, patch);
  }
}

export function pinnedTreeAdapter(profileId: string): Adapter {
  return {
    prefix: PIN_TREE,
    adoptBeforePublish: true,
    extract: (base, queued, _now, _known, _remote, stamp) => {
      if (isIncognitoProfile(profileId)) return null;
      const s = store();
      const table = tableOf(s.pinPlace, profileId);
      const props = pinnedProps(s, profileId, table);
      const values = new Map<string, unknown>();
      for (const [node, place] of Object.entries(table)) {
        const own = isPinNode(node) ? props.get(node) : undefined;
        if (own) values.set(PIN_NODE + node, { parent: place.parent, pos: place.pos, ...own } satisfies PinNodeRecord);
      }
      const ignore = (key: string) => {
        if (!key.startsWith(PIN_NODE)) return true;
        const node = key.slice(PIN_NODE.length);
        return !!table[node] || !pinNodeRecord(node, base(key));
      };
      const chosen = s.pinChoices[profileId] ?? {};
      const chosenFor = (key: string) => (key.startsWith(PIN_NODE) ? choicesOf(key.slice(PIN_NODE.length)).filter((c) => c in chosen) : []);
      return {
        values,
        ignore,
        republish: (key) => chosenFor(key).some((c) => choiceStillOut(chosen, c, stamp(key))) && !queued(key),
        published: (keys) => settleChoices(profileId, Object.fromEntries([...keys].flatMap(chosenFor).map((c) => [c, chosen[c]!]))),
      } satisfies Extraction;
    },
    apply: (visible, changed, _base, records) => {
      if (isIncognitoProfile(profileId)) return true;
      const s = store();
      const placedBefore = tableOf(s.pinPlace, profileId);
      const joining = !records.joined;
      const received = new Map<string, PinNodeRecord>();
      const removed = new Set<string>();
      for (const key of joining ? new Set([...changed, ...visible.keys()]) : changed) {
        if (!key.startsWith(PIN_NODE)) continue;
        const node = key.slice(PIN_NODE.length);
        if (!isPinNode(node)) continue;
        if (!visible.has(key)) {
          removed.add(node);
          continue;
        }
        const record = pinNodeRecord(node, visible.get(key));
        if (record) received.set(node, record);
      }
      if (joining) for (const node of Object.keys(placedBefore)) if (!visible.has(PIN_NODE + node)) removed.add(node);
      if (!received.size && !removed.size) return true;
      const placed = withReceived(withoutRemoved(placedExactly(s, profileId, received, removed), profileId, removed, placedBefore), profileId, received);
      const orphaned = new Set([...received.keys(), ...Object.keys(placedBefore).filter((n) => removed.has(placedBefore[n]!.parent ?? ""))]);
      const next = withOrphanHomes(placed, profileId, orphaned);
      if (removed.size) noteRemotePinDeletion(profileId);
      if (next !== s) useBrowser.setState(next);
      applyLiveDefinitions(profileId, received, removed, placedBefore);
      return true;
    },
  };
}
