import { onAppEvent, onWindowEvent } from "@ardia/shell";
import { everySlowly } from "../lib/slowTimers";
import { useBrowser } from "../store/browser";
import { activeTabId, isIncognitoProfile, viewTabIds } from "../store/model";
import { liveNode, migrateLivePlaces } from "../store/pinTree";
import { completedExpiry } from "./rows";
import { SOURCES } from "./sources";
import { applyFetch, createFolder, expireCompleted, finishCompleting, folderGeneration, live, markRead, removeFolder, setStatus, unhide, useLive, type LiveFolderSnapshot } from "./store";
import { LiveError, type CompletionState, type LiveFolder, type LiveFolderKind, type LiveItem, type LiveSourceId, type PullRequestSection } from "./types";

const ACTIVE_MS: Record<LiveFolderKind, number> = { pullRequests: 15_000, documents: 10 * 60_000 };
const IDLE_MS: Record<LiveFolderKind, number> = { pullRequests: 3 * 60_000, documents: 10 * 60_000 };
const TICK_MS = 15_000;
const STALE_ON_FOCUS_MS = 15_000;
export const COMPLETION_MS = 2600;

const inflight = new Map<string, { generation: number; task: Promise<void> }>();
const fetchedSources = new Map<string, Set<LiveSourceId>>();

const SECTION_ORDER: Record<PullRequestSection, number> = { authored: 0, review: 1, team: 2 };

function order(items: LiveItem[]): LiveItem[] {
  return [...items].sort(
    (a, b) => (SECTION_ORDER[a.section ?? "authored"] ?? 0) - (SECTION_ORDER[b.section ?? "authored"] ?? 0) || b.updatedAt - a.updatedAt,
  );
}

export function refreshFolder(folderId: string, background = false): Promise<void> {
  const generation = folderGeneration(folderId);
  const running = inflight.get(folderId);
  if (running?.generation === generation) return running.task;
  const after = running ? running.task.catch(() => undefined) : Promise.resolve();
  const task: Promise<void> = after.then(() => run(folderId, generation, background)).finally(() => {
    if (inflight.get(folderId)?.task === task) inflight.delete(folderId);
  });
  inflight.set(folderId, { generation, task });
  return task;
}

export function manualRefresh(folderId: string): Promise<void> {
  unhide(folderId);
  return refreshFolder(folderId);
}

const isCurrent = (folderId: string, generation: number) => !!live().folders[folderId] && folderGeneration(folderId) === generation;

async function run(folderId: string, generation: number, background: boolean) {
  const folder = live().folders[folderId];
  if (!folder || !isCurrent(folderId, generation)) return;
  const before = live();
  const fetchedBefore = !!before.status[folderId]?.lastFetch;
  if (!background || !fetchedBefore) setStatus(folderId, { state: fetchedBefore ? "updating" : "initializing" });
  const results = await Promise.allSettled(folder.sources.map((id) => SOURCES[id].fetch(folder)));
  if (!isCurrent(folderId, generation)) return;

  const fetched: LiveItem[] = [];
  const failed: { source: LiveSourceId; error: unknown }[] = [];
  results.forEach((r, i) => {
    const source = folder.sources[i]!;
    if (r.status === "fulfilled") fetched.push(...r.value);
    else failed.push({ source, error: r.reason });
  });
  if (!live().folders[folderId]) return;
  const fromFailedSource = (it: LiveItem) => failed.some((f) => f.source === it.source);
  const listedByFilters = (it: LiveItem) => (it.section === "review" ? folder.filters.reviewRequests : it.section === "team" ? folder.filters.teamReviewRequests : folder.filters.authored);
  const fetchWouldList = (it: LiveItem) => folder.sources.includes(it.source) && !fromFailedSource(it) && listedByFilters(it);

  const landed = live();
  const ids = new Set(fetched.map((it) => it.id));
  const animatingAtLanding = new Set(landed.completing[folderId] ?? []);
  const missing = [...(landed.items[folderId] ?? []), ...(landed.hidden[folderId] ?? [])].filter((it) => !ids.has(it.id) && !animatingAtLanding.has(it.id) && fetchWouldList(it));
  const gone: Record<string, CompletionState> = {};
  for (const source of new Set(missing.map((it) => it.source))) {
    const resolve = SOURCES[source].resolveGone;
    if (!resolve) continue;
    const resolved = await resolve(missing.filter((it) => it.source === source), folder).catch(() => ({}));
    if (!isCurrent(folderId, generation)) return;
    Object.assign(gone, resolved);
  }

  const current = live();
  const prev = current.items[folderId] ?? [];
  const animating = new Set(current.completing[folderId] ?? []);
  const next = [...fetched, ...prev.filter((it) => fromFailedSource(it) && !animating.has(it.id))];

  const firstFailure = failed[0];
  if (firstFailure && failed.length === folder.sources.length && !prev.length && !before.status[folderId]?.lastFetch) {
    setStatus(folderId, { state: "error", error: describe(firstFailure.source, firstFailure.error) });
    return;
  }
  const lastSources = fetchedSources.get(folderId);
  const quiet = new Set(lastSources ? next.filter((it) => !lastSources.has(it.source)).map((it) => it.id) : []);
  fetchedSources.set(folderId, new Set(folder.sources.filter((id) => !failed.some((f) => f.source === id))));
  const token = applyFetch(folderId, order(next), gone, Date.now(), quiet);
  if (firstFailure) setStatus(folderId, { state: "error", error: describe(firstFailure.source, firstFailure.error) });
  if (Object.keys(gone).length) setTimeout(() => finishCompleting(folderId, generation, token), COMPLETION_MS);
}

function describe(source: LiveSourceId, error: unknown) {
  if (error instanceof LiveError) return { kind: error.kind, message: error.message, source };
  return { kind: "other" as const, message: String((error as Error)?.message ?? error), source };
}

export function statusText(folderId: string, now = Date.now()): string {
  const hidden = live().hidden[folderId]?.length ?? 0;
  return hidden ? `${fetchText(folderId, now)} · ${hidden} hidden until you refresh` : fetchText(folderId, now);
}

function fetchText(folderId: string, now: number): string {
  const st = live().status[folderId];
  if (!st || st.state === "initializing") return "Loading…";
  if (st.state === "updating") return "Updating…";
  if (st.error) return errorText(st.error.kind, st.error.source);
  if (!st.lastFetch) return "Not updated yet";
  const min = Math.floor((now - st.lastFetch) / 60_000);
  return `Last fetch: ${min < 1 ? "just now" : min < 60 ? `${min}m ago` : `${Math.floor(min / 60)}h ago`}`;
}

export function errorText(kind: LiveError["kind"], source: LiveSourceId): string {
  const name = SOURCES[source].name;
  switch (kind) {
    case "notConfigured":
      return `Connect ${name} in Settings`;
    case "signedOut":
      return `Sign back in to ${name}`;
    case "sso":
      return `${name} needs Single Sign-On for this organization`;
    case "rateLimited":
      return `${name} rate limit exceeded. Try again in a few minutes.`;
    case "network":
      return `Couldn't connect to ${name}`;
    default:
      return `We're having trouble connecting to ${name}`;
  }
}

export function newLiveFolder(windowId: string, kind: LiveFolderKind): string | null {
  const w = useBrowser.getState().windows[windowId];
  if (!w || w.incognito) return null;
  return newProfileLiveFolder(w.profileId, kind);
}

export function newProfileLiveFolder(profileId: string, kind: LiveFolderKind, sources?: LiveSourceId[]): string {
  const s = live();
  const connected: LiveSourceId[] =
    kind === "pullRequests"
      ? (["github", "bitbucket"] as const).filter((id) => s.accounts[id])
      : (["notion", "confluence", "gdrive"] as const).filter((id) => s.accounts[id]);
  const id = createFolder(profileId, kind, sources ?? (connected.length ? connected : undefined));
  useBrowser.getState().placePinned(profileId, [liveNode(id)], null);
  void refreshFolder(id);
  return id;
}

export function openLiveItem(windowId: string, folderId: string, item: LiveItem, options: { background?: boolean } = {}) {
  const s = useBrowser.getState();
  markRead(folderId, [item.id]);
  const existing = viewTabIds(s, windowId).find((id) => s.tabs[id]?.liveItem?.itemId === item.id && s.tabs[id]?.liveItem?.folderId === folderId);
  if (existing) {
    if (!options.background) s.activate(existing);
    return existing;
  }
  const id = s.newTab(windowId, { url: item.url, background: options.background });
  useBrowser.getState().updateTab(id, { liveItem: { folderId, itemId: item.id } });
  return id;
}

export function deleteLiveFolder(folderId: string): LiveFolderSnapshot | null {
  const s = useBrowser.getState();
  const tabs = Object.values(s.tabs).filter((t) => t.liveItem?.folderId === folderId).map((t) => t.id);
  if (tabs.length) s.closeTabs(tabs);
  return removeFolder(folderId);
}

const expiries = new Map<string, { at: number; timer: ReturnType<typeof setTimeout> }>();

function scheduleExpiry(folderId: string) {
  const at = completedExpiry(live().completed[folderId] ?? []);
  const scheduled = expiries.get(folderId);
  if (scheduled?.at === at) return;
  if (scheduled) clearTimeout(scheduled.timer);
  expiries.delete(folderId);
  if (at === null) return;
  const timer = setTimeout(() => {
    expiries.delete(folderId);
    expireCompleted(folderId);
    scheduleExpiry(folderId);
  }, Math.max(0, at - Date.now()));
  expiries.set(folderId, { at, timer });
}

let started = false;
let appActive = true;
const lastNudge = new Map<string, number>();

const sourcePace = (folder: LiveFolder, now: number) => Math.max(0, ...folder.sources.map((id) => SOURCES[id].minInterval?.(now) ?? 0));
const sourceHeld = (folder: LiveFolder, now: number) => folder.sources.some((id) => (SOURCES[id].heldUntil?.() ?? 0) > now);

export function startLiveEngine() {
  if (started) return;
  started = true;
  const browser = useBrowser.getState();
  const saved = live();
  const pinPlace = migrateLivePlaces(browser.pinPlace, saved.folderOrder.flatMap((id) => {
    const folder = saved.folders[id];
    return folder && browser.profiles[folder.profileId] && !isIncognitoProfile(folder.profileId) ? [folder] : [];
  }));
  if (pinPlace !== browser.pinPlace) useBrowser.setState({ pinPlace });

  const orphans = () => {
    const s = useBrowser.getState();
    const folders = live().folders;
    for (const t of Object.values(s.tabs)) if (t.liveItem && !folders[t.liveItem.folderId]) s.updateTab(t.id, { liveItem: undefined });
  };
  orphans();
  useLive.subscribe((s, prev) => {
    if (s.folders !== prev.folders) orphans();
  });

  for (const id in live().completed) scheduleExpiry(id);
  useLive.subscribe((s, prev) => {
    if (s.completed === prev.completed) return;
    for (const id of new Set([...Object.keys(s.completed), ...expiries.keys()])) if (s.completed[id] !== prev.completed[id]) scheduleExpiry(id);
  });

  useLive.subscribe((s, prev) => {
    if (s.generations === prev.generations) return;
    for (const id in s.generations) if (s.generations[id] !== prev.generations[id] && s.folders[id]) queueMicrotask(() => void refreshFolder(id));
  });

  useBrowser.subscribe((s, prev) => {
    if (s.profiles === prev.profiles) return;
    for (const f of Object.values(live().folders)) if (!s.profiles[f.profileId]) removeFolder(f.id);
  });

  const due = (id: string, maxAge: (f: LiveFolder) => number, slack = 0) => {
    const f = live().folders[id];
    const st = live().status[id];
    const now = Date.now();
    if (!f || sourceHeld(f, now)) return false;
    return !st?.lastFetch || now - st.lastFetch >= Math.max(maxAge(f), sourcePace(f, now)) - slack;
  };
  const refreshStale = () => {
    for (const id of live().folderOrder) if (due(id, () => STALE_ON_FOCUS_MS)) void refreshFolder(id, true);
  };
  setTimeout(() => live().folderOrder.forEach((id) => void refreshFolder(id)), 2500);
  everySlowly({
    every: TICK_MS,
    run: () => {
      for (const id of live().folderOrder) if (due(id, (f) => (appActive ? ACTIVE_MS : IDLE_MS)[f.kind], TICK_MS / 2)) void refreshFolder(id, true);
    },
    needed: () => live().folderOrder.length > 0,
    watch: (changed) => useLive.subscribe((s, prev) => s.folderOrder !== prev.folderOrder && changed()),
  });
  onWindowEvent((e) => {
    if (e.type !== "focus") return;
    appActive = true;
    refreshStale();
  });
  onAppEvent((e) => {
    if (e.type === "resignActive" || e.type === "screenLocked") appActive = false;
    if (e.type !== "screenUnlocked") return;
    appActive = true;
    refreshStale();
  });

  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    for (const id in s.tabs) {
      const t = s.tabs[id]!;
      if (t.pinned && t.liveItem && !prev.tabs[id]?.pinned) useBrowser.getState().updateTab(id, { liveItem: undefined });
    }
  });

  useBrowser.subscribe((s, prev) => {
    if (s.windows === prev.windows) return;
    for (const windowId of s.windowOrder) {
      const before = activeTabId(prev, windowId);
      if (!before || before === activeTabId(s, windowId)) continue;
      const folderId = s.tabs[before]?.liveItem?.folderId;
      if (!folderId || Date.now() - (lastNudge.get(folderId) ?? 0) < 20_000) continue;
      lastNudge.set(folderId, Date.now());
      setTimeout(() => void refreshFolder(folderId, true), 3000);
    }
  });
}
