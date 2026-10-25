import { addHistoryVisits, deleteHistoryUrls, deletePassword, savePassword } from "@ardia/ardiacore";
import { assignPositions, canonical, SyncNative, type Adapter, type Extraction, type SavedLogin } from "@ardia/sync";
import { FOLDER_DEFAULTS, removeFolder, restoreFolder, updateFolder, useLive } from "../live/store";
import type { LiveFolder, LiveFolderKind, LiveSourceId } from "../live/types";
import { bookmarkUuidFor, ensureRoots, isBookmarkUuid } from "../store/bookmarks";
import { MAX_HISTORY, MAX_VISIT_TIMES } from "../store/history";
import { useBrowser, type BrowserState } from "../store/browser";
import { leaveGroups } from "../store/groups";
import { engineProfile, IDLE_LIVE, isIncognitoProfile, makeTab, newId, without } from "../store/model";
import { groupChoiceKey, noteRemotePinDeletion, orderChoiceKey, placeChoiceKey, samePage } from "../store/organize";
import { homeTitle, mirrored } from "../store/pinMirror";
import { FAVORITES, groupNode, isGroupNode, isLiveNode, isTabNode, keyOfNode, liveNode, nodesExisting, pinKeyOf, tableOf, tabNode, withTable, type PinPlace, type PinTable } from "../store/pinTree";
import { removeTabs } from "../store/tabs";
import { isPeekTab } from "../store/peek";
import { fromSync } from "../store/pinOrderChoices";
import { tileFolderOf, withTileFolder } from "../store/tileFolders";
import { DEFAULT_PROFILE_ID, DEFAULT_SETTINGS, type Settings } from "../store/settings";
import { sanitizeTheme } from "../lib/profileTheme";
import type { BookmarkNode, HistoryEntry, ParkedPins, Profile, ProfileTheme, Tab, TabGroup, TileFolder } from "../store/types";

const store = () => useBrowser.getState();

export const SYNCED_SETTINGS = [
  "warnBeforeQuitting",
  "warnBeforeClosingWindow",
  "searchEngine",
  "customSearchUrl",
  "customSearchEngines",
  "searchSuggestions",
  "showSelectionSearch",
  "commandBarPreference",
  "tabLayout",
  "hideToolbarWhileScrolling",
  "showSidebarButton",
  "showClearButton",
  "balancedTopApps",
  "pinnedTabIconRing",
  "fadeUnloadedTabs",
  "warnBeforeClosingTabGroup",
  "newTabPosition",
  "newTabOpens",
  "warnBeforeClosingLastTab",
  "undoReopensClosedTab",
  "warnBeforeMovingTabsToProfile",
  "tabReorderHaptics",
  "extendWebsiteColor",
  "cmdClickCreatesTabGroup",
  "optShiftClickOpensInGroup",
  "peekModifier",
  "splitLinkModifier",
  "autoGroupMeetingTabs",
  "cleanUpInactiveTabsAfterHours",
  "mutedSites",
  "autoPictureInPicture",
  "videoUpscaling",
  "sidebarMediaControls",
  "showFullUrl",
  "bookmarksBar",
  "appearance",
  "addressBar",
  "commandBarPlacement",
  "shortcuts",
] as const satisfies readonly (keyof Settings)[];

export const settingsAdapter: Adapter = {
  prefix: "set:",
  adoptRemoteOnJoin: true,
  extract: (base) => {
    const settings = store().settings;
    const chosen = new Set(settings.chosen ?? []);
    const inferred = new Set(settings.inferred ?? []);
    const filledIn = (name: (typeof SYNCED_SETTINGS)[number], value: unknown) => {
      if (!inferred.has(name) || JSON.stringify(value) !== JSON.stringify(DEFAULT_SETTINGS[name])) return false;
      const last = base(`set:${name}`) as { v?: unknown } | undefined;
      return last === undefined || last.v === null || last.v === undefined;
    };
    const values = new Map<string, unknown>();
    for (const name of SYNCED_SETTINGS) {
      const value = settings[name] as unknown;
      if (!chosen.has(name) || value === undefined || (value === null && DEFAULT_SETTINGS[name] !== null) || filledIn(name, value)) continue;
      values.set(`set:${name}`, { v: value });
    }
    return { values, ignore: (key) => !values.has(key) };
  },
  apply: (visible, changed) => {
    const patch: Record<string, unknown> = {};
    for (const key of changed) {
      const name = key.slice(4);
      const record = visible.get(key) as { v: unknown } | undefined;
      if (!record || !(SYNCED_SETTINGS as readonly string[]).includes(name)) continue;
      const value = record.v;
      if (value === undefined || (value === null && DEFAULT_SETTINGS[name as keyof Settings] !== null)) continue;
      patch[name] = value;
    }
    if (Object.keys(patch).length) store().updateSettings(patch as Partial<Settings>, { fromSync: true });
  },
};

export type ProfileRecord = { n: string; c: Profile["color"]; i: string | null; d?: true; th?: ProfileTheme | null };

export type ProfileThemeRecord = { t: ProfileTheme } | { preset: true };

export type ThemeAngleRecord = { a?: number; d?: number };

export const themeAngleKey = (syncId: string) => `pth:${syncId}:angle`;

function withoutAngles({ angle: _angle, dark, ...theme }: ProfileTheme): ProfileTheme {
  if (!dark) return theme;
  const { angle: _darkAngle, ...darkLook } = dark;
  return { ...theme, dark: darkLook };
}

function anglesOf(theme: ProfileTheme): ThemeAngleRecord {
  return { ...(theme.angle !== undefined ? { a: theme.angle } : {}), ...(theme.dark?.angle !== undefined ? { d: theme.dark.angle } : {}) };
}

export function themeFromRecord(record: unknown, angles?: unknown): Pick<Profile, "theme"> | null {
  if (!record || typeof record !== "object") return null;
  if ("preset" in record && record.preset === true) return { theme: null };
  const theme = "t" in record ? sanitizeTheme(record.t) : null;
  if (!theme) return null;
  if (!angles || typeof angles !== "object") return { theme };
  const { a, d } = angles as Record<string, unknown>;
  const look = withoutAngles(theme);
  return { theme: sanitizeTheme({ ...look, angle: a, ...(look.dark ? { dark: { ...look.dark, angle: d } } : {}) }) };
}

export function legacyThemeOf(record: ProfileRecord): Pick<Profile, "theme"> | null {
  const theme = record.th ? sanitizeTheme(record.th) : null;
  return theme ? { theme } : null;
}

export function profilesAdapter(links: () => Record<string, { syncId: string }>): Adapter {
  const linked = () => Object.entries(links()).filter(([id]) => store().profiles[id]);
  return {
    prefix: "prof:",
    adoptRemoteOnJoin: true,
    extract: (_base, _queued, _now, known) => {
      const values = new Map<string, unknown>();
      const all = links();
      for (const [id, { syncId }] of linked()) {
        const p = store().profiles[id]!;
        const sharesSyncedData = !!p.dataId && p.dataId !== id && !!all[p.dataId] && !!store().profiles[p.dataId];
        if (sharesSyncedData && !known(`share:${syncId}`)) continue;
        values.set(`prof:${syncId}`, {
          n: p.name,
          c: p.color,
          i: p.icon,
          ...(id === DEFAULT_PROFILE_ID ? { d: true } : {}),
        } satisfies ProfileRecord);
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key) };
    },
    apply: (visible, changed, _base, records) => {
      for (const [id, { syncId }] of linked()) {
        const record = visible.get(`prof:${syncId}`) as ProfileRecord | undefined;
        if (!record || !changed.has(`prof:${syncId}`)) continue;
        const legacy = store().profiles[id]!.theme === undefined && !records.known(`pth:${syncId}`) ? legacyThemeOf(record) : null;
        store().updateProfile(id, { name: record.n, color: record.c, icon: record.i, ...legacy });
      }
    },
  };
}

export function profileThemesAdapter(
  links: () => Record<string, { syncId: string; themeAdopting?: true }>,
  records: () => Record<string, { v: unknown }> | undefined,
  adopted: (profileId: string) => void = () => {},
): Adapter {
  const linked = () => Object.entries(links()).filter(([id]) => store().profiles[id]);
  const unapplied = (key: string, base: (key: string) => unknown) => {
    const record = records()?.[key];
    return !!record && record.v !== null && canonical(record.v) !== canonical(base(key) ?? null);
  };
  return {
    prefix: "pth:",
    adoptRemoteOnJoin: true,
    extract: (base, _queued, _now, known) => {
      const values = new Map<string, unknown>();
      for (const [id, { syncId, themeAdopting }] of linked()) {
        const theme = store().profiles[id]!.theme;
        const key = `pth:${syncId}`;
        const angleKey = themeAngleKey(syncId);
        if (theme === undefined || themeAdopting || unapplied(key, base) || unapplied(angleKey, base)) continue;
        values.set(key, (theme ? { t: withoutAngles(theme) } : { preset: true }) satisfies ProfileThemeRecord);
        const angles = theme ? anglesOf(theme) : {};
        if (Object.keys(angles).length || known(angleKey)) values.set(angleKey, angles satisfies ThemeAngleRecord);
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key) };
    },
    apply: (visible, changed) => {
      for (const [id, { syncId }] of linked()) {
        const angleKey = themeAngleKey(syncId);
        if (!changed.has(`pth:${syncId}`) && !changed.has(angleKey)) continue;
        const patch = themeFromRecord(visible.get(`pth:${syncId}`), visible.get(angleKey));
        if (!patch) continue;
        store().updateProfile(id, patch);
        adopted(id);
      }
    },
  };
}

export type ShareRecord = { o: string };

type ShareLink = { syncId: string; enabled: boolean; retire?: boolean };

export function sharedDataAdapter(links: () => Record<string, ShareLink>): Adapter {
  return {
    prefix: "share:",
    adoptRemoteOnJoin: true,
    publishAfterPull: true,
    extract: (_base, _queued, _now, known) => {
      const all = links();
      const synced = (id: string) => !!store().profiles[id] && !!all[id]?.enabled && !all[id]?.retire;
      const values = new Map<string, unknown>();
      for (const [id, link] of Object.entries(all)) {
        const ownerId = store().profiles[id]?.dataId;
        if (!synced(id) || !ownerId || ownerId === id || !synced(ownerId)) continue;
        const key = `share:${link.syncId}`;
        if (!known(key)) values.set(key, { o: all[ownerId]!.syncId } satisfies ShareRecord);
      }
      return { values, ignore: (key) => !values.has(key) };
    },
    apply: () => true,
  };
}

export type DeviceRecord = { n: string };

export function deviceAdapter(deviceId: string, name: () => string, retired = false): Adapter {
  return {
    prefix: "dev:",
    extract: () => ({
      values: retired ? new Map() : new Map([[`dev:${deviceId}`, { n: name() } satisfies DeviceRecord]]),
      ignore: (key) => key !== `dev:${deviceId}`,
    }),
    apply: () => true,
  };
}

type BookmarkValue = { k: "u" | "f"; p: string; t: string; u?: string; a: number; pos: string };

export function bookmarksAdapter(profileId: string): Adapter {
  const ready = () => !!store().bookmarksReady[profileId];
  return {
    prefix: "bm:",
    extract: (base) => {
      if (!ready()) return null;
      const b = store().bookmarks;
      const roots = b.roots[profileId];
      const values = new Map<string, unknown>();
      if (!roots) return { values };
      const keyOf = (id: string) => {
        if (id === roots.bar) return "bar";
        if (id === roots.other) return "other";
        const key = b.nodes[id]?.syncKey;
        return key && bookmarkUuidFor(key) === id ? key : id;
      };
      const seen = new Set<string>();
      const walk = (folderId: string) => {
        const folder = b.nodes[folderId];
        if (folder?.kind !== "folder" || seen.has(folderId)) return;
        seen.add(folderId);
        const parent = keyOf(folderId);
        const children = folder.children.filter((id) => b.nodes[id]);
        const positions = assignPositions(
          children.map((id) => {
            const known = base(`bm:${keyOf(id)}`) as BookmarkValue | undefined;
            return known?.p === parent ? known.pos : undefined;
          }),
        );
        children.forEach((id, i) => {
          const node = b.nodes[id]!;
          values.set(`bm:${keyOf(id)}`, {
            k: node.kind === "url" ? "u" : "f",
            p: parent,
            t: node.title,
            ...(node.kind === "url" ? { u: node.url } : {}),
            a: node.addedAt,
            pos: positions[i]!,
          } satisfies BookmarkValue);
          if (node.kind === "folder") walk(id);
        });
      };
      walk(roots.bar);
      walk(roots.other);
      return { values };
    },
    apply: (visible) => {
      if (!ready()) return false;
      const s = store();
      const [b, roots] = ensureRoots(s.bookmarks, profileId);
      const values = new Map([...visible].map(([k, v]) => [bookmarkUuidFor(k.slice(3)), v as BookmarkValue]));
      const keys = new Map([...visible.keys()].map((k) => [bookmarkUuidFor(k.slice(3)), k.slice(3)]));
      const rootOf = (key: string) => (key === "bar" ? roots.bar : key === "other" ? roots.other : null);
      const parentOf = new Map<string, string>();
      for (const [id, v] of values) {
        const root = rootOf(v.p);
        const parent = root ? null : bookmarkUuidFor(v.p);
        parentOf.set(id, root ?? (parent && values.get(parent)?.k === "f" ? parent : roots.other));
      }
      for (const id of [...values.keys()].sort()) {
        const seen = new Set<string>([id]);
        for (let at = parentOf.get(id)!; parentOf.has(at); at = parentOf.get(at)!) {
          if (seen.has(at)) {
            parentOf.set(id, roots.other);
            break;
          }
          seen.add(at);
        }
      }
      const children = new Map<string, string[]>([[roots.bar, []], [roots.other, []]]);
      for (const id of values.keys()) children.set(parentOf.get(id)!, [...(children.get(parentOf.get(id)!) ?? []), id]);
      const byPosition = (a: string, z: string) => {
        const pa = values.get(a)!.pos;
        const pz = values.get(z)!.pos;
        const ka = keys.get(a)!;
        const kz = keys.get(z)!;
        return pa < pz ? -1 : pa > pz ? 1 : ka < kz ? -1 : 1;
      };
      const nodes: Record<string, BookmarkNode> = { ...b.nodes };
      const drop = (id: string) => {
        const node = nodes[id];
        if (node?.kind === "folder") node.children.forEach(drop);
        if (id !== roots.bar && id !== roots.other) delete nodes[id];
      };
      drop(roots.bar);
      drop(roots.other);
      for (const [id, v] of values) {
        const old = b.nodes[id];
        const key = keys.get(id)!;
        const syncKey = isBookmarkUuid(key) ? {} : { syncKey: key };
        nodes[id] =
          v.k === "u"
            ? { kind: "url", id, parentId: parentOf.get(id)!, title: v.t, url: v.u ?? "", favicon: old?.kind === "url" ? old.favicon : null, addedAt: v.a, ...syncKey }
            : { kind: "folder", id, parentId: parentOf.get(id)!, title: v.t, children: [], addedAt: v.a, ...syncKey };
      }
      for (const [parent, ids] of children) {
        const folder = nodes[parent];
        if (folder?.kind === "folder") nodes[parent] = { ...folder, children: ids.sort(byPosition) };
      }
      useBrowser.setState({ bookmarks: { ...b, nodes } });
    },
  };
}

const HISTORY_WINDOW_MS = 90 * 86_400_000;

type HistoryValue = { t: string; n: number; vt: number[] };
const lastVisitOf = (v: HistoryValue) => Math.max(0, ...v.vt);
const keptInHistory = (url: string) => /^(https?|file):/i.test(url);
const SAME_VISIT_MS = 1;

export const historyExpired = (key: string, value: unknown, now: number) =>
  key.startsWith("h:") && lastVisitOf(value as HistoryValue) < now - HISTORY_WINDOW_MS;

export function historyAdapter(profileId: string): Adapter {
  const ready = () => !!store().historyReady[profileId];
  return {
    prefix: "h:",
    extract: (base) => {
      if (!ready()) return null;
      const since = Date.now() - HISTORY_WINDOW_MS;
      const values = new Map<string, unknown>();
      const older = new Set<string>();
      const view = store().history[profileId] ?? [];
      const floor = store().historyFloor[profileId] ?? -Infinity;
      for (const e of view) {
        if (!keptInHistory(e.url)) continue;
        const key = `h:${e.url}`;
        if (e.lastVisit < since) {
          older.add(key);
          continue;
        }
        const local: HistoryValue = { t: e.title, n: e.visits, vt: e.visitTimes?.length ? e.visitTimes : [e.lastVisit] };
        const known = base(key) as HistoryValue | undefined;
        const edited = !known || local.vt.some((t) => !known.vt.some((k) => Math.abs(k - t) <= SAME_VISIT_MS));
        values.set(key, edited ? local : known);
      }
      const ignore = (key: string) => {
        if (older.has(key) || !keptInHistory(key.slice(2))) return true;
        const known = base(key) as HistoryValue | undefined;
        return !!known && (lastVisitOf(known) < since || lastVisitOf(known) <= floor);
      };
      return { values, ignore };
    },
    editedAt: (v) => lastVisitOf(v as HistoryValue),
    apply: async (visible, changed) => {
      if (!ready()) return false;
      const since = Date.now() - HISTORY_WINDOW_MS;
      const byUrl = new Map((store().history[profileId] ?? []).map((e) => [e.url, e]));
      const add: { url: string; title: string; visitTimes: number[] }[] = [];
      const remove: string[] = [];
      const updates = new Map<string, HistoryEntry | null>();
      for (const key of changed) {
        const url = key.slice(2);
        if (!keptInHistory(url)) continue;
        const v = visible.get(key) as HistoryValue | undefined;
        const old = byUrl.get(url);
        if (v) {
          const have = old?.visitTimes ?? [];
          const fresh = v.vt.filter((t) => t >= since && !have.some((h) => Math.abs(h - t) <= SAME_VISIT_MS));
          if (fresh.length) add.push({ url, title: v.t, visitTimes: fresh });
          const times = [...have, ...fresh].sort((a, z) => a - z).slice(-MAX_VISIT_TIMES);
          if (!times.length) continue;
          updates.set(url, {
            url,
            title: v.t || old?.title || "",
            favicon: null,
            visits: Math.max(v.n, old?.visits ?? 0),
            lastVisit: times[times.length - 1]!,
            visitTimes: times,
          });
        } else if (old && old.lastVisit >= since) {
          remove.push(url);
          updates.set(url, null);
        }
      }
      if (!updates.size) return;
      const engine = engineProfile(profileId);
      await Promise.all([addHistoryVisits(engine, add, SAME_VISIT_MS), deleteHistoryUrls(engine, remove)]);
      useBrowser.setState((s) => {
        const current = new Map((s.history[profileId] ?? []).map((e) => [e.url, e]));
        for (const [url, update] of updates) {
          const now = current.get(url);
          if (!update) current.delete(url);
          else if (!now) current.set(url, update);
          else {
            const times = [...new Set([...(now.visitTimes ?? []), ...(update.visitTimes ?? [])])].sort((a, z) => a - z).slice(-MAX_VISIT_TIMES);
            current.set(url, { ...update, visits: Math.max(now.visits, update.visits), lastVisit: times[times.length - 1]!, visitTimes: times });
          }
        }
        const list = [...current.values()].sort((a, z) => z.lastVisit - a.lastVisit).slice(0, MAX_HISTORY);
        return { history: { ...s.history, [profileId]: list } };
      });
    },
  };
}

export type DeviceTabs = { n: string; tabs: { u: string; t: string }[] };
const MAX_DEVICE_TABS = 30;

export function deviceTabsAdapter(profileId: string, deviceId: string, name: () => string, retired = false): Adapter {
  const key = `tabs:${deviceId}`;
  return {
    prefix: "tabs:",
    extract: () => {
      if (retired) return { values: new Map(), ignore: (k) => k !== key };
      const s = store();
      const open = Object.values(s.tabs)
        .filter((t) => t.profileId === profileId && !t.pinned && !t.unloaded && /^(https?|file):/.test(t.url) && !s.windows[t.windowId]?.incognito && !isPeekTab(s, t.id))
        .sort((a, z) => z.lastActiveAt - a.lastActiveAt)
        .slice(0, MAX_DEVICE_TABS)
        .map((t) => ({ u: t.url, t: t.customTitle || t.title }));
      return { values: new Map([[key, { n: name(), tabs: open } satisfies DeviceTabs]]), ignore: (k) => k !== key };
    },
    apply: () => true,
  };
}

const PIN_TREE = "pt:";
const PIN_NODE = `${PIN_TREE}n:`;

type PinTabProps = { kind: "tab"; url: string; title: string; customTitle: string | null; customIcon: string | null };
type PinFolderProps = { kind: "folder"; name: string; icon: string | null; color: TabGroup["color"] };
type PinLiveProps = Pick<LiveFolder, "name" | "icon" | "sources" | "filters" | "groupStacks" | "showCompleted" | "createdAt"> & { kind: "live"; liveKind: LiveFolderKind };
type PinNodeProps = PinTabProps | PinFolderProps | PinLiveProps;
export type PinNodeRecord = PinPlace & PinNodeProps;
type PinTabRecord = PinPlace & PinTabProps;
type PinFolderRecord = PinPlace & PinFolderProps;
type PinLiveRecord = PinPlace & PinLiveProps;

type Window = BrowserState["windows"][string];
type ParkedTab = ParkedPins["tabs"][number];

const LIVE_SOURCES: Record<LiveSourceId, true> = { github: true, bitbucket: true, notion: true, confluence: true, gdrive: true };
const isText = (v: unknown): v is string => typeof v === "string";
const isTextOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isPinParent = (v: unknown): v is string | null => v === null || v === FAVORITES || (isText(v) && isGroupNode(v));
const isPinNode = (node: string) => isTabNode(node) || isGroupNode(node) || isLiveNode(node);
const isLiveSource = (v: unknown): v is LiveSourceId => isText(v) && Object.keys(LIVE_SOURCES).includes(v);
const isLiveKind = (v: unknown): v is LiveFolderKind => isText(v) && Object.keys(FOLDER_DEFAULTS).includes(v);

const hasPage = (t: Tab) => !!t.navigation || !!t.adoptId;
const placeholder = (t: Tab) => !hasPage(t) && !t.pageIn && !t.wakeAdoptId;
const folderKeyOf = (parent: string | null) => (parent !== null && isGroupNode(parent) ? keyOfNode(parent) : null);
const isLeafPlace = (place: PinPlace | undefined): place is PinPlace => !!place && folderKeyOf(place.parent) !== null;
const unchangedOr = <T>(list: T[], next: T[]) => (next.some((x, i) => x !== list[i]) ? next : list);

function pinNodeRecord(node: string, value: unknown): PinNodeRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isPinParent(v.parent) || !isText(v.pos)) return null;
  const place: PinPlace = { parent: v.parent, pos: v.pos };
  if (isTabNode(node) && v.kind === "tab" && isText(v.url) && isText(v.title) && isTextOrNull(v.customTitle) && isTextOrNull(v.customIcon)) {
    return { ...place, kind: "tab", url: v.url, title: v.title, customTitle: v.customTitle, customIcon: v.customIcon };
  }
  if (isGroupNode(node) && v.kind === "folder" && isText(v.name) && isTextOrNull(v.icon) && isTextOrNull(v.color)) {
    return { ...place, kind: "folder", name: v.name, icon: v.icon, color: v.color as TabGroup["color"] };
  }
  const filters = v.filters as Record<string, unknown> | null | undefined;
  if (
    isLiveNode(node) &&
    v.kind === "live" &&
    isLiveKind(v.liveKind) &&
    isText(v.name) &&
    isTextOrNull(v.icon) &&
    Array.isArray(v.sources) &&
    typeof v.createdAt === "number" &&
    !!filters &&
    typeof v.groupStacks === "boolean" &&
    typeof v.showCompleted === "boolean" &&
    typeof filters.authored === "boolean" &&
    typeof filters.reviewRequests === "boolean"
  ) {
    const filtersOut = { authored: filters.authored, reviewRequests: filters.reviewRequests };
    return { ...place, kind: "live", liveKind: v.liveKind, name: v.name, icon: v.icon, sources: v.sources.filter(isLiveSource), filters: filtersOut, groupStacks: v.groupStacks, showCompleted: v.showCompleted, createdAt: v.createdAt };
  }
  return null;
}

const placeEntryOf = (r: PinNodeRecord): PinPlace => (r.kind === "tab" ? { parent: r.parent, pos: r.pos, url: r.url, title: r.title } : { parent: r.parent, pos: r.pos });

const sameEntry = (a: PinPlace, z: PinPlace) => a.parent === z.parent && a.pos === z.pos && a.url === z.url && a.title === z.title;

function addressOf(place: PinPlace | undefined, own: Pick<Tab, "url" | "title"> & { pinnedUrl?: string | null }, others: Pick<Tab, "url" | "title">[] = []) {
  if (isLeafPlace(place)) return place.url !== undefined ? { url: place.url, title: place.title ?? "" } : { url: own.url, title: own.title };
  const url = own.pinnedUrl || own.url;
  return { url, title: homeTitle(place, url) ?? [own, ...others].find((t) => t.title && samePage(t.url, url))?.title ?? own.title };
}

const windowsByFocus = (s: BrowserState): Window[] => [...new Set([...s.ui.focusOrder, ...s.windowOrder])].map((id) => s.windows[id]).filter(mirrored);

function homeWindow(s: BrowserState, profileId: string): Window | undefined {
  const order = windowsByFocus(s);
  const shows = (w: Window) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId);
  const holdsFolder = new Set(Object.values(s.groups).filter((g) => g.pinned && g.profileId === profileId).map((g) => g.windowId));
  return order.find((w) => w.profileId === profileId && shows(w)) ?? order.find(shows) ?? order.find((w) => holdsFolder.has(w.id));
}

const liveProps = (f: LiveFolder): PinLiveProps => ({
  kind: "live",
  liveKind: f.kind,
  name: f.name,
  icon: f.icon,
  sources: [...f.sources],
  filters: { authored: f.filters.authored, reviewRequests: f.filters.reviewRequests },
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
    for (const id of doomed) if (!removable.includes(id)) tabs[id] = { ...tabs[id]!, pinned: false, pinnedUrl: null, pinnedAsRow: undefined, tileFolder: undefined, pinKey: undefined };
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

const parkedPlacement = (r: PinTabRecord) => {
  const groupId = folderKeyOf(r.parent);
  return { pinned: groupId === null, pinnedUrl: groupId === null ? r.url : null, groupId, ...(r.parent === null ? { pinnedAsRow: true as const } : {}) };
};

function parkedTabFrom(p: ParkedTab, r: PinTabRecord): ParkedTab {
  const { pinnedAsRow: _, restoreFrom, ...rest } = p;
  const moved = p.url !== r.url;
  const next: ParkedTab = {
    ...rest,
    url: r.url,
    title: r.title,
    ...(moved ? { favicon: null } : {}),
    customTitle: r.customTitle,
    customIcon: r.customIcon,
    ...parkedPlacement(r),
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
      const staleRestore = leaf && !!t.wakeAdoptId && !hasPage(t) && !t.pageIn && !samePage(t.url, r.url);
      editTab(id, {
        customTitle: r.customTitle,
        customIcon: r.customIcon,
        ...(leaf ? {} : { pinnedUrl: r.url }),
        ...(staleRestore ? { wakeAdoptId: undefined } : {}),
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
        pinned: !leaf,
        pinnedUrl: leaf ? null : r.url,
        customTitle: r.customTitle,
        customIcon: r.customIcon,
        ...(r.parent === null ? { pinnedAsRow: true as const } : {}),
      }),
      id,
      ...(id === key ? {} : { pinKey: key }),
      navigation: null,
      unloaded: true,
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
    if (home === undefined || t.pinnedUrl === home) continue;
    if (tabs === s.tabs) tabs = { ...s.tabs };
    tabs[t.id] = { ...t, pinnedUrl: home };
  }
  return tabs === s.tabs ? s : { ...s, tabs };
}

const choicesOf = (node: string) => (isTabNode(node) ? [keyOfNode(node), placeChoiceKey(keyOfNode(node))] : isGroupNode(node) ? [groupChoiceKey(keyOfNode(node)), orderChoiceKey(keyOfNode(node))] : []);

function settleChoices(profileId: string, published: Record<string, number>) {
  const now = store().pinChoices;
  const mine = now[profileId];
  if (!mine) return;
  const left = Object.fromEntries(Object.entries(mine).filter(([key, n]) => published[key] !== n));
  if (Object.keys(left).length === Object.keys(mine).length) return;
  const { [profileId]: _, ...others } = now;
  useBrowser.setState({ pinChoices: Object.keys(left).length ? { ...now, [profileId]: left } : others });
}

function liveChanges(f: LiveFolder, r: PinLiveRecord): Partial<Omit<LiveFolder, "id" | "profileId" | "kind">> | null {
  const patch: Partial<Omit<LiveFolder, "id" | "profileId" | "kind">> = {};
  if (f.name !== r.name) patch.name = r.name;
  if (f.icon !== r.icon) patch.icon = r.icon;
  if (f.groupStacks !== r.groupStacks) patch.groupStacks = r.groupStacks;
  if (f.showCompleted !== r.showCompleted) patch.showCompleted = r.showCompleted;
  if (f.createdAt !== r.createdAt) patch.createdAt = r.createdAt;
  if (canonical(f.sources) !== canonical(r.sources)) patch.sources = [...r.sources];
  if (canonical(f.filters) !== canonical(r.filters)) patch.filters = { ...r.filters };
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
      restoreFolder({ id, profileId, kind: r.liveKind, name: r.name, icon: r.icon, collapsed: false, sources: r.sources, filters: r.filters, groupStacks: r.groupStacks, showCompleted: r.showCompleted, createdAt: r.createdAt });
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
    extract: (base, queued) => {
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
        republish: (key) => chosenFor(key).length > 0 && !queued(key),
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

const TILE_FOLDER = "tilefold:";
const FOLDER_NAME = `${TILE_FOLDER}n:`;
type TileFolderValue = { f: string };
type FolderNameValue = { n: string };

const syncedFolderId = (value: unknown) => {
  const v = value as TileFolderValue | undefined;
  return v && typeof v.f === "string" ? v.f : undefined;
};
const syncedName = (value: unknown) => {
  const v = value as FolderNameValue | undefined;
  return v && typeof v.n === "string" ? v.n : undefined;
};
const folderMark = (base: (key: string) => unknown, key: string) => {
  const id = syncedFolderId(base(`${TILE_FOLDER}${key}`));
  return id ? { tileFolder: { id, name: syncedName(base(`${FOLDER_NAME}${id}`)) ?? "" } } : {};
};
const localFolders = new Map<string, Set<string>>();

export function tileFoldersAdapter(profileId: string): Adapter {
  const keyOf = (k: string) => k.slice(TILE_FOLDER.length);
  return {
    prefix: TILE_FOLDER,
    adoptBeforePublish: true,
    extract: (base, _queued, _now, recorded, remote) => {
      const s = store();
      const values = new Map<string, unknown>();
      const known = new Set<string>();
      const local = new Map<string, TileFolder>();
      const mark = (key: string, folder: TileFolder | undefined) => {
        known.add(key);
        if (!folder) return;
        values.set(`${TILE_FOLDER}${key}`, { f: folder.id } satisfies TileFolderValue);
        const was = local.get(folder.id);
        if (!was || (folder.renamedAt ?? -1) > (was.renamedAt ?? -1)) local.set(folder.id, folder);
      };
      const unpinned = (key: string) => recorded(`${PIN_NODE}${tabNode(key)}`) && remote(`${PIN_NODE}${tabNode(key)}`) === null;
      const home = homeWindow(s, profileId);
      for (const w of home ? [home, ...windowsByFocus(s).filter((w) => w.id !== home.id)] : windowsByFocus(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (t?.pinned && t.profileId === profileId && !known.has(pinKeyOf(t))) mark(pinKeyOf(t), tileFolderOf(t));
        }
      }
      for (const p of s.parkedPins[profileId]?.tabs ?? []) if (!p.groupId && !known.has(p.id)) mark(p.id, p.pinnedAsRow ? undefined : p.tileFolder);
      for (const [folderId, folder] of local) {
        const synced = base(`${FOLDER_NAME}${folderId}`);
        if (folder.renamedAt !== undefined && syncedName(synced) !== folder.name) values.set(`${FOLDER_NAME}${folderId}`, { n: folder.name } satisfies FolderNameValue);
        else if (synced !== undefined) values.set(`${FOLDER_NAME}${folderId}`, synced);
      }
      const had = localFolders.get(profileId) ?? new Set();
      localFolders.set(profileId, new Set(local.keys()));
      const ignore = (k: string) => {
        if (k.startsWith(FOLDER_NAME)) return !had.has(k.slice(FOLDER_NAME.length));
        return !known.has(keyOf(k)) && base(`${PIN_NODE}${tabNode(keyOf(k))}`) === undefined && !unpinned(keyOf(k));
      };
      return { values, ignore } satisfies Extraction;
    },
    apply: (visible, changed) => {
      const s = store();
      const touched = new Set([...changed].filter((k) => !k.startsWith(FOLDER_NAME)).map(keyOf));
      const names = new Map<string, string>();
      for (const [k, v] of visible) {
        const name = k.startsWith(FOLDER_NAME) ? syncedName(v) : undefined;
        if (name !== undefined) names.set(k.slice(FOLDER_NAME.length), name);
      }
      const wanted = (key: string, current: TileFolder | undefined): TileFolder | undefined => {
        const id = touched.has(key) ? syncedFolderId(visible.get(`${TILE_FOLDER}${key}`)) : current?.id;
        if (!id) return undefined;
        const name = names.get(id);
        if (current?.id === id && (name === undefined || name === current.name)) return current;
        return { id, name: name ?? (current?.id === id ? current.name : "") };
      };
      let tabs: Record<string, Tab> | null = null;
      for (const w of windowsByFocus(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (!t?.pinned || t.pinnedAsRow || t.profileId !== profileId) continue;
          const folder = wanted(pinKeyOf(t), t.tileFolder);
          if (folder !== t.tileFolder) (tabs ??= { ...s.tabs })[id] = withTileFolder(t, folder);
        }
      }
      const park = s.parkedPins[profileId];
      const parked = park?.tabs.map((p) => {
        if (p.groupId || p.pinnedAsRow) return p;
        const folder = wanted(p.id, p.tileFolder);
        if (folder === p.tileFolder) return p;
        const { tileFolder: _, ...rest } = p;
        return folder ? { ...rest, tileFolder: folder } : rest;
      });
      const parkEdited = !!park && parked!.some((p, i) => p !== park.tabs[i]);
      if (!tabs && !parkEdited) return true;
      fromSync(() =>
        useBrowser.setState({
          ...(tabs ? { tabs } : {}),
          ...(parkEdited ? { parkedPins: { ...s.parkedPins, [profileId]: { ...park!, tabs: parked! } } } : {}),
        }),
      );
      return true;
    },
  };
}

type PasswordValue = { o: string; u: string; p: string };
const PASSWORD_READ_INTERVAL = 30_000;

export function passwordsAdapter(
  profileId: string,
  forced: () => boolean,
  readLogins: (engineProfile: string) => Promise<SavedLogin[] | null | undefined> = async (p) => SyncNative?.readPasswords(p),
): Adapter {
  let lastRead = 0;
  let quietUntil = 0;
  let created = new Map<string, number>();
  const profile = () => engineProfile(profileId);
  const keyOf = (origin: string, username: string) => `pw:${origin}\n${username}`;
  const read = async () => {
    const logins = await readLogins(profile());
    if (!logins) return null;
    const out = new Map<string, PasswordValue & { c: number }>();
    for (const l of logins) {
      const origin = originOf(l);
      if (origin) out.set(keyOf(origin, l.username), { o: origin, u: l.username, p: l.password, c: l.created });
    }
    return out;
  };
  return {
    prefix: "pw:",
    extract: async () => {
      const now = Date.now();
      if (now < quietUntil || (now - lastRead < PASSWORD_READ_INTERVAL && !forced())) return null;
      const logins = await read();
      if (!logins) return null;
      lastRead = now;
      created = new Map([...logins].map(([k, v]) => [k, v.c]));
      return { values: new Map([...logins].map(([k, { o, u, p }]) => [k, { o, u, p } satisfies PasswordValue])) };
    },
    editedAt: (v) => created.get(keyOf((v as PasswordValue).o, (v as PasswordValue).u)) || undefined,
    apply: async (visible, changed, base) => {
      const local = await read();
      if (!local) return false;
      let ok = true;
      for (const key of changed) {
        const v = visible.get(key) as PasswordValue | undefined;
        const have = local.get(key);
        const known = base(key) as PasswordValue | undefined;
        if (have && known?.p !== have.p) continue;
        const [origin, username] = [key.slice(3, key.indexOf("\n")), key.slice(key.indexOf("\n") + 1)];
        if (v) {
          if (have?.p === v.p) continue;
          if (have) ok = (await deletePassword(profile(), origin, username)) && ok;
          ok = (await savePassword(profile(), v.o, v.u, v.p)) && ok;
        } else if (have) {
          ok = (await deletePassword(profile(), origin, username)) && ok;
        }
      }
      let settled = false;
      for (let i = 0; i < 20 && !settled; i++) {
        const now = await read();
        settled = !!now && [...changed].every((k) => (visible.get(k) as PasswordValue | undefined)?.p === now.get(k)?.p);
        if (!settled) await new Promise((r) => setTimeout(r, 250));
      }
      if (!settled) quietUntil = Date.now() + 30_000;
      return ok;
    },
  };
}

function originOf(login: SavedLogin): string | null {
  const realm = login.origin.replace(/\/$/, "");
  return /^https?:\/\/[^/\s]+$/.test(realm) ? realm : null;
}
