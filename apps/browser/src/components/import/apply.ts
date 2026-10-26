import { savePassword } from "@ardia/ardiacore";
import type { BookmarkNode as ImportedNode, Credential, DiaTabsProfile, ImportedFavicon, ImportedTab, ImportKind, ImportResult, SafariExport, SpaceSuggestion } from "@ardia/import";
import { adoptFavicons, pageKey as faviconPage } from "../../lib/favicons";
import type { BookmarkDraft } from "../../store/bookmarks";
import { MAX_DRAFT_LINKS } from "../../store/draftGroups";
import { useBrowser } from "../../store/browser";
import { engineProfile, isIncognitoProfile } from "../../store/model";
import { openPages, pageKey, pinnedPages } from "../../store/pageKeys";
import { FAVORITES, groupNode, liveNode, pinKeyOf, placeNodes, tabNode, withLeafPages, type PinPlaces } from "../../store/pinTree";
import { withNewTab } from "../../store/tabs";
import type { BrowserState } from "../../store/browser";
import type { ProfileColor, TabGroup } from "../../store/types";
import { newId } from "../../store/model";
import { importModule } from "./module";
import { adoptProfileTheme } from "../../sync/engine";
import { parseArcTheme } from "./arcTheme";
import { newProfileLiveFolder } from "../../live/engine";
import { live, updateFolder } from "../../live/store";
import type { LiveSourceId } from "../../live/types";

export type ImportCounts = { bookmarks: number; history: number; tabs: number; passwords: number; cookies: number; addresses: number; cards: number };

export const emptyCounts = (): ImportCounts => ({ bookmarks: 0, history: 0, tabs: 0, passwords: 0, cookies: 0, addresses: 0, cards: 0 });

const toDraft = (n: ImportedNode): BookmarkDraft =>
  n.type === "url"
    ? { title: n.title || n.url || "", url: n.url ?? "", addedAt: n.dateAdded }
    : { title: n.title, addedAt: n.dateAdded, children: (n.children ?? []).map(toDraft) };

const LIVE_SOURCES: Partial<Record<NonNullable<ImportedNode["role"]>, LiveSourceId>> = {
  liveGitHubPullRequests: "github",
  liveBitbucketPullRequests: "bitbucket",
};
const liveSourceOf = (n: ImportedNode) => (n.role ? LIVE_SOURCES[n.role] : undefined);
const liveSources = (nodes: ImportedNode[]): LiveSourceId[] =>
  nodes.flatMap((n) => [...(liveSourceOf(n) ? [liveSourceOf(n)!] : []), ...liveSources(n.children ?? [])]);
function importPullRequestsFolders(profileId: string, nodes: ImportedNode[]) {
  for (const source of new Set(liveSources(nodes))) {
    const have = Object.values(live().folders).some((f) => f.profileId === profileId && f.kind === "pullRequests" && f.sources.includes(source));
    if (!have) newProfileLiveFolder(profileId, "pullRequests", [source]);
  }
}

const linksOf = (nodes: ImportedNode[]): string[] => nodes.flatMap((n) => (n.type === "url" ? (n.url ? [n.url] : []) : linksOf(n.children ?? [])));

function importFavicons(profileId: string, favicons: ImportedFavicon[] | undefined, urls: string[]) {
  if (!favicons?.length || !urls.length) return;
  const wanted = new Set(urls.map(faviconPage));
  adoptFavicons(profileId, favicons.filter((f) => wanted.has(faviconPage(f.page))));
}

const linkCount = (nodes: ImportedNode[]): number => nodes.reduce((n, c) => n + (c.type === "url" ? 1 : linkCount(c.children ?? [])), 0);

export function importBookmarks(profileId: string, root: ImportedNode | undefined, browserName: string): number {
  if (!root?.children?.length) return 0;
  if (!useBrowser.getState().bookmarks.roots[profileId]) useBrowser.getState().addBookmarkTree(profileId, []);
  const roots = useBrowser.getState().bookmarks.roots[profileId]!;
  const toolbar = root.children.filter((c) => c.role === "toolbar").flatMap((c) => c.children ?? []);
  const rest = root.children.filter((c) => c.role !== "toolbar");
  const other = rest.flatMap((c) => (c.role === "other" || !c.role ? (c.type === "folder" ? (c.children ?? []) : [c]) : [c]));
  const title = `Imported from ${browserName}`;
  const place = (nodes: ImportedNode[], parentId: string) => {
    if (!nodes.length) return;
    const parent = useBrowser.getState().bookmarks.nodes[parentId];
    const empty = parent?.kind === "folder" && parent.children.length === 0;
    const drafts = nodes.map(toDraft);
    useBrowser.getState().addBookmarkTree(profileId, empty ? drafts : [{ title, children: drafts }], parentId);
  };
  place(toolbar, roots.bar);
  place(other, roots.other);
  return linkCount([...toolbar, ...other]);
}

function importSafariBookmarks(profileId: string, root: ImportedNode | undefined): number {
  return importBookmarks(profileId, root, "Safari");
}

export function importHistory(profileId: string, entries: { url: string; title: string; visits: number; lastVisit: number }[]): number {
  const before = useBrowser.getState().history[profileId]?.length ?? 0;
  useBrowser.getState().importHistory(profileId, entries);
  return (useBrowser.getState().history[profileId]?.length ?? 0) - before;
}

async function importPasswords(profileId: string, credentials: Credential[]): Promise<number> {
  let saved = 0;
  for (const c of credentials) {
    const origin = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i.exec(c.realm?.startsWith("http") ? c.realm : c.url)?.[1];
    if (!origin || !c.password) continue;
    if (await savePassword(engineProfile(profileId), origin, c.username, c.password).catch(() => false)) saved++;
  }
  return saved;
}

export async function importNative(
  profileId: string,
  token: string | undefined,
  kinds: ("cookies" | "autofill")[],
  onFailed?: (kind: ImportKind) => void,
): Promise<Pick<ImportCounts, "cookies" | "addresses" | "cards">> {
  const none = { cookies: 0, addresses: 0, cards: 0 };
  const api = importModule();
  if (!api || !token) return none;
  if (!kinds.length || isIncognitoProfile(profileId) || useBrowser.getState().profiles[profileId] === undefined) {
    api.discardImported(token);
    return none;
  }
  try {
    const w = await api.writeImported(token, engineProfile(profileId), kinds);
    if (w.cookiesFailed) onFailed?.("cookies");
    if (w.autofillFailed) onFailed?.("autofill");
    return { cookies: w.cookies, addresses: w.addresses, cards: w.cards };
  } catch {
    kinds.forEach((k) => onFailed?.(k));
    return none;
  }
}

function windowFor(profileId: string): string {
  const s = useBrowser.getState();
  const regular = s.ui.focusOrder.find((id) => s.windows[id] && !s.windows[id]!.incognito) ?? s.windowOrder.find((id) => !s.windows[id]!.incognito);
  return regular ?? s.createWindow({ profileId });
}

export function openInWebStore(profileId: string, urls: string[]) {
  if (!urls.length) return;
  const windowId = windowFor(profileId);
  urls.forEach((url, i) => useBrowser.getState().newTab(windowId, { url, profileId, background: i > 0 }));
}

export function importTabs(
  profileId: string,
  tabs: (Pick<ImportedTab, "url" | "title" | "pinned" | "customTitle"> & { row?: boolean })[],
  group: string | null,
): number {
  const s = useBrowser.getState();
  const pinned = pinnedPages(s, profileId);
  const open = openPages(s, profileId);
  const usable = tabs.filter((t) => {
    if (!/^(https?|file):/i.test(t.url)) return false;
    const seen = t.pinned ? pinned : open;
    const key = pageKey(t.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!usable.length) return 0;
  const windowId = windowFor(profileId);
  let next = useBrowser.getState();
  const unpinned: string[] = [];
  for (const t of usable) {
    const after = t.pinned ? undefined : unpinned.at(-1);
    const [made, id] = withNewTab(next, windowId, {
      url: t.url,
      profileId,
      background: true,
      pinned: t.pinned,
      snapshot: { title: t.title, customTitle: t.customTitle ?? null, ...(t.pinned && t.row ? { pinnedAsRow: true as const } : {}) },
      index: after ? next.windows[windowId]!.tabIds.indexOf(after) + 1 : undefined,
    });
    if (!id) continue;
    next = { ...made, tabs: { ...made.tabs, [id]: { ...made.tabs[id]!, navigation: null } } };
    if (t.pinned) next = { ...next, pinPlace: placeNodes(next.pinPlace, profileId, [tabNode(pinKeyOf(next.tabs[id]!))], t.row ? null : FAVORITES, null) };
    else unpinned.push(id);
  }
  useBrowser.setState(next);
  if (group && unpinned.length) useBrowser.getState().createGroup(unpinned, { name: group });
  return usable.length;
}

function importPinnedTree(profileId: string, nodes: ImportedNode[]): { tabs: number; skipped: number } {
  if (!nodes.length) return { tabs: 0, skipped: 0 };
  const existingFolders = new Set(Object.keys(live().folders));
  importPullRequestsFolders(profileId, nodes);
  const windowId = windowFor(profileId);
  let s: BrowserState = useBrowser.getState();
  let places: PinPlaces = s.pinPlace;
  const seen = pinnedPages(s, profileId);
  const placedLive = new Set<string>();
  const groups: Record<string, TabGroup> = {};
  let count = 0;
  let skipped = 0;
  const visit = (list: ImportedNode[], parent: string | null, budget?: { taken: number }) => {
    for (const n of list) {
      const source = liveSourceOf(n);
      if (source) {
        const folder = Object.values(live().folders).find((f) => f.profileId === profileId && f.kind === "pullRequests" && f.sources.includes(source));
        if (folder && !existingFolders.has(folder.id) && !placedLive.has(folder.id)) {
          places = placeNodes(places, profileId, [liveNode(folder.id)], parent, null);
          placedLive.add(folder.id);
          if (n.icon) updateFolder(folder.id, { icon: n.icon });
        }
        continue;
      }
      if (n.type === "folder") {
        const pages = linksOf([n]).filter((url) => /^(https?|file):/i.test(url));
        const newLive = liveSources([n]).some((source) => Object.values(live().folders).some((f) => f.profileId === profileId && f.kind === "pullRequests" && f.sources.includes(source) && !existingFolders.has(f.id) && !placedLive.has(f.id)));
        if (pages.length && pages.every((url) => seen.has(pageKey(url))) && !newLive) continue;
        const id = newId("g");
        groups[id] = { id, windowId, profileId, name: n.title, icon: n.icon ?? null, color: null, collapsed: false, pinned: true, tabIds: [], createdAt: Date.now(), ...(parent ? { parentId: parent.slice(2) } : {}) };
        places = placeNodes(places, profileId, [groupNode(id)], parent, null);
        visit(n.children ?? [], groupNode(id), budget ?? { taken: 0 });
        continue;
      }
      if (!n.url || !/^(https?|file):/i.test(n.url) || seen.has(pageKey(n.url))) continue;
      if (budget && budget.taken >= MAX_DRAFT_LINKS) {
        skipped++;
        continue;
      }
      const row = parent === null;
      const [next, id] = withNewTab(s, windowId, {
        url: n.url,
        profileId,
        background: true,
        pinned: row,
        snapshot: { title: n.pageTitle ?? n.title, customTitle: n.pageTitle ? n.title : null, ...(row ? { pinnedAsRow: true as const } : {}) },
      });
      if (!id) continue;
      seen.add(pageKey(n.url));
      if (budget) budget.taken++;
      s = { ...next, tabs: { ...next.tabs, [id]: { ...next.tabs[id]!, navigation: null, ...(!row ? { unloaded: true as const } : {}) } } };
      places = placeNodes(places, profileId, [tabNode(id)], parent, null);
      if (parent) groups[parent.slice(2)]!.tabIds.push(id);
      count++;
    }
  };
  visit(nodes, null);
  places = withLeafPages(places, profileId, Object.values(s.tabs).filter((t) => t.profileId === profileId));
  useBrowser.setState({ ...s, groups: { ...s.groups, ...groups }, pinPlace: places });
  return { tabs: count, skipped };
}

export function importArcSpace(profileId: string, space: SpaceSuggestion, favicons?: ImportedFavicon[]): { tabs: number; bookmarks: number; skipped: number } {
  importFavicons(profileId, favicons, [...linksOf(space.pinned), ...space.tabs.map((t) => t.url)]);
  const imported = importPinnedTree(profileId, space.pinned);
  const skipped = imported.skipped;
  let tabs = imported.tabs;
  tabs += importTabs(profileId, space.tabs.map((t) => ({ ...t, pinned: false })), "Imported");
  const theme = space.theme ? parseArcTheme(space.theme) : null;
  if (theme) {
    adoptProfileTheme(profileId);
    useBrowser.getState().updateProfile(profileId, { theme });
  }
  return { tabs, bookmarks: 0, skipped };
}

export function importDiaProfile(profileId: string, profile: DiaTabsProfile, what: { pinned: boolean; open: boolean }, favicons?: ImportedFavicon[]): number {
  importFavicons(profileId, favicons, [...(what.pinned ? profile.pinned : []), ...(what.open ? profile.tabs : [])].map((t) => t.url));
  const have = openPages(useBrowser.getState(), profileId);
  const fresh = (tabs: ImportedTab[]) => tabs.filter((t) => !have.has(pageKey(t.url)));
  let n = what.pinned ? importTabs(profileId, fresh(profile.pinned), null) : 0;
  if (what.open) n += importTabs(profileId, fresh(profile.tabs).map((t) => ({ ...t, pinned: false })), "Imported");
  return n;
}

export async function applyResult(
  profileId: string,
  result: ImportResult,
  browserName: string,
  requested: ImportKind[],
  onFailed?: (kind: ImportKind) => void,
): Promise<ImportCounts> {
  const toolbar = (result.bookmarks?.children ?? []).filter((c) => c.role === "toolbar");
  importFavicons(profileId, result.favicons, [...result.favorites.map((t) => t.url), ...(result.spaces.length ? [] : result.tabs.map((t) => t.url)), ...linksOf(toolbar)]);
  const counts = emptyCounts();
  counts.bookmarks += importBookmarks(profileId, result.bookmarks, browserName);
  if (result.history.length) counts.history += importHistory(profileId, result.history);
  const native = (["cookies", "autofill"] as const).filter((k) => requested.includes(k));
  Object.assign(counts, await importNative(profileId, result.vaultToken, native, onFailed));
  if (result.tabs.length && !result.spaces.length) counts.tabs += importTabs(profileId, result.tabs, "Imported");
  if (result.favorites.length) counts.tabs += importTabs(profileId, result.favorites.map((t) => ({ ...t, pinned: true })), null);
  if (result.credentials.length) counts.passwords += await importPasswords(profileId, result.credentials);
  return counts;
}

export async function applySafari(profileId: string, data: SafariExport, cookies = true, onFailed?: (kind: ImportKind) => void): Promise<ImportCounts> {
  const counts = emptyCounts();
  counts.bookmarks = importSafariBookmarks(profileId, data.bookmarks);
  const history = data.profiles.find((p) => !p.name)?.history ?? data.profiles[0]?.history ?? [];
  counts.history = importHistory(profileId, history);
  Object.assign(counts, await importNative(profileId, data.vaultToken, cookies ? ["cookies", "autofill"] : ["autofill"], onFailed));
  if (data.tabs.length) counts.tabs += importTabs(profileId, data.tabs, "Imported");
  counts.passwords = await importPasswords(profileId, data.credentials);
  return counts;
}

export function profileColorFor(hex: string | undefined): ProfileColor | undefined {
  const m = hex && /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return undefined;
  const v = parseInt(m[1]!, 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.08) return "neutral";
  let h = 0;
  if (max === r) h = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h *= 60;
  const hues: [ProfileColor, number][] = [
    ["red", 0],
    ["orange", 25],
    ["yellow", 45],
    ["green", 140],
    ["blue", 210],
    ["purple", 265],
    ["pink", 330],
    ["red", 360],
  ];
  return hues.reduce((best, c) => (Math.abs(c[1] - h) < Math.abs(best[1] - h) ? c : best))[0];
}
