import { readDocument, saveDocument, writeDocument } from "@ardia/shell";
import {
  canonical,
  Clock,
  emptyScope,
  folderTransport,
  localDataReady,
  restoreJournal,
  syncScope,
  SyncNative,
  visible,
  whenLocalDataReady,
  writtenSeq,
  type Adapter,
  type ExtensionsAdapter,
  type FolderInfo,
  type LogFile,
  type PhraseResult,
  type ScopeState,
} from "@ardia/sync";
import { create } from "zustand";
import { useBrowser } from "../store/browser";
import { fromLegacy } from "../legacy";
import { engineProfile, isIncognitoProfile } from "../store/model";
import { DEFAULT_PROFILE_ID } from "../store/settings";
import type { Profile } from "../store/types";
import {
  bookmarksAdapter,
  deviceAdapter,
  deviceTabsAdapter,
  historyAdapter,
  historyExpired,
  passwordsAdapter,
  pinnedTreeAdapter,
  profilesAdapter,
  settingsAdapter,
  sharedDataAdapter,
  tileFoldersAdapter,
  type DeviceRecord,
  type DeviceTabs,
  type ProfileRecord,
  legacyThemeOf,
  profileThemesAdapter,
  themeAngleKey,
  themeFromRecord,
  type ShareRecord,
} from "./adapters";
import { extensionsAdapterFor, extensionSyncAvailable, probeExtensionSync, watchExtensionIntents } from "./extensions";

type DataType = "bookmarks" | "history" | "tabs" | "pinned" | "passwords" | "extensions" | "settings";

export const DATA_TYPES: { id: DataType; title: string; description: string }[] = [
  { id: "bookmarks", title: "Bookmarks", description: "Each synced profile’s bookmarks bar and other bookmarks." },
  { id: "history", title: "History", description: "The last 90 days." },
  { id: "tabs", title: "Open Tabs", description: "Your other devices’ tabs show in the tab overflow menu." },
  { id: "pinned", title: "Pinned Tabs and Groups", description: "Pinned tabs and pinned tab groups." },
  { id: "passwords", title: "Passwords", description: "Saved passwords. Turning sync off never removes them from this Mac." },
  { id: "extensions", title: "Extensions", description: "Extensions from the Chrome Web Store, whether they’re on, and whether they’re pinned." },
  { id: "settings", title: "Settings", description: "Search engine, appearance, tab and keyboard settings." },
];

type ProfileLink = {
  syncId: string;
  enabled: boolean;
  retire?: boolean;
  themeAdopting?: true;
};

type ChainState = "ready" | "imported" | "creating" | "awaiting";

type SyncDoc = {
  v: 2;
  enabled: boolean;
  folder: string | null;
  deviceId: string | null;
  clock: string | null;
  types: Record<DataType, boolean>;
  profiles: Record<string, ProfileLink>;
  scopes: Record<string, ScopeState>;
  lastSyncedAt: number | null;
  setupAt: number | null;
  joining: boolean;
  chain: ChainState;
  adoptBeforePublish: boolean;
  seqs?: Record<string, number>;
};

type PreviousSyncDoc = {
  v: 1;
  enabled?: boolean;
  folder?: string | null;
  deviceId?: string | null;
  clock?: string | null;
  types?: Partial<Record<DataType, boolean>>;
  profiles?: Record<string, Partial<ProfileLink>>;
  setupAt?: number | null;
};

const DOC = "sync-v2.json";
const STATE = "sync-v2-state.nns";
const JOURNAL = "sync-v2-journal.nns";
const PREVIOUS_DOC = "sync.json";
const APP_SCOPE = "app";
const CYCLE_MS = 15_000;
const AFTER_EDIT_MS = 3_000;

const defaultTypes = (): Record<DataType, boolean> => ({ bookmarks: true, history: true, tabs: true, pinned: true, passwords: true, extensions: true, settings: true });

const emptyDoc = (): SyncDoc => ({
  v: 2,
  enabled: false,
  folder: null,
  deviceId: null,
  clock: null,
  types: defaultTypes(),
  profiles: {},
  scopes: {},
  lastSyncedAt: null,
  setupAt: null,
  joining: false,
  chain: "ready",
  adoptBeforePublish: false,
});

export type SyncStatus = "off" | "starting" | "updating" | "updated" | "stalled" | "offline" | "locked" | "reset" | "unavailable";

type SyncedDevice = { id: string; name: string; lastSeen: number | null; current: boolean };
export type RemoteTabs = { deviceId: string; name: string; tabs: { url: string; title: string }[] };
type RemoteProfile = { syncId: string; name: string; color: Profile["color"]; icon: string | null; sharesWith?: { name: string; added: boolean }; waiting?: true };

type SyncUi = {
  status: SyncStatus;
  enabled: boolean;
  folder: string | null;
  types: Record<DataType, boolean>;
  profiles: Record<string, ProfileLink>;
  lastSyncedAt: number | null;
  error: string | null;
  pending: number;
  devices: SyncedDevice[];
  remoteTabs: Record<string, RemoteTabs[]>;
  remoteProfiles: RemoteProfile[];
};

export const useSync = create<SyncUi>(() => ({
  status: SyncNative ? "off" : "unavailable",
  enabled: false,
  folder: null,
  types: defaultTypes(),
  profiles: {},
  lastSyncedAt: null,
  error: null,
  pending: 0,
  devices: [],
  remoteTabs: {},
  remoteProfiles: [],
}));

let doc: SyncDoc = emptyDoc();
let savedJson = "";
let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let forcePasswords = false;
const passwordAdapters = new Map<string, Adapter>();
const extensionAdapters = new Map<string, ExtensionsAdapter>();

function load() {
  try {
    const json = readDocument(DOC);
    if (json) {
      const saved = JSON.parse(json) as Partial<SyncDoc> | null;
      if (saved?.v !== 2) throw new Error(`unknown version ${String(saved?.v)}`);
      doc = { ...emptyDoc(), ...saved, types: { ...defaultTypes(), ...saved.types }, scopes: {} };
    }
    savedJson = json ?? "";
    if (!json) importPreviousConfiguration();
  } catch (error) {
    console.warn(`[sync] couldn't read ${DOC}`, error);
  }
}

function importPreviousConfiguration() {
  const json = readDocument(PREVIOUS_DOC);
  if (!json) return;
  const previous = JSON.parse(json) as PreviousSyncDoc | null;
  if (previous?.v !== 1) return;
  const folder = typeof previous.folder === "string" ? previous.folder : null;
  const deviceId = typeof previous.deviceId === "string" ? previous.deviceId : null;
  const types = { ...defaultTypes(), ...previous.types };
  if (previous.enabled !== true || !folder || !deviceId) {
    doc = { ...emptyDoc(), folder, types };
  } else {
    const profiles = Object.fromEntries(
      Object.entries(previous.profiles ?? {})
        .filter(([, link]) => typeof link?.syncId === "string")
        .map(([id, link]): [string, ProfileLink] => [id, { syncId: link.syncId!, enabled: link.enabled !== false, ...(link.themeAdopting ? { themeAdopting: true as const } : {}) }]),
    );
    const clock = typeof previous.clock === "string" ? previous.clock : null;
    const setupAt = typeof previous.setupAt === "number" ? previous.setupAt : null;
    doc = { ...emptyDoc(), enabled: true, folder, deviceId, clock, types, profiles, setupAt, chain: "imported", adoptBeforePublish: true };
  }
  saveDoc();
}

type Journal = Record<string, LogFile[]>;
let journal: Journal = {};
let journalOnDisk = false;

async function openSealed<T>(name: string, fallback: T): Promise<T> {
  const sealed = readDocument(name);
  const json = sealed ? await SyncNative?.openLocal(sealed) : null;
  try {
    if (json) return JSON.parse(json) as T;
  } catch {}
  return fallback;
}

async function loadState() {
  const scopes = await openSealed<SyncDoc["scopes"]>(STATE, {});
  journal = (await openSealed<{ journal?: Journal }>(JOURNAL, {})).journal ?? {};
  journalOnDisk = Object.keys(journal).length > 0;
  const clock = new Clock(doc.deviceId ?? "", doc.clock);
  for (const scope of new Set([...Object.keys(doc.seqs ?? {}), ...Object.keys(journal)])) {
    const mine = (journal[scope] ?? []).filter((f) => f.device === doc.deviceId);
    restoreJournal((scopes[scope] ??= emptyScope()), mine, clock, doc.seqs?.[scope]);
  }
  if (doc.deviceId && Object.keys(journal).length) doc.clock = clock.last;
  doc.scopes = scopes;
}

const persistJournal = (scope: string) => async (batches: LogFile[]) => {
  const list = (journal[scope] ??= []);
  for (const file of batches) if (!list.some((f) => f.seq === file.seq)) list.push(file);
  const sealed = await SyncNative!.sealLocal(JSON.stringify({ journal }));
  await saveDocument(JOURNAL, sealed);
  journalOnDisk = true;
};

function pruneJournal(saved: Record<string, number>) {
  for (const [scope, list] of Object.entries(journal)) {
    const left = list.filter((f) => f.seq > (saved[scope] ?? 0));
    if (left.length) journal[scope] = left;
    else delete journal[scope];
  }
  if (journalOnDisk && !Object.keys(journal).length) clearJournal();
}

function clearJournal() {
  journal = {};
  journalOnDisk = false;
  writeDocument(JOURNAL, "");
}

let savedState = "";
let sealing: Promise<void> | null = null;

function saveDoc() {
  const { scopes, ...meta } = doc;
  const json = JSON.stringify({ ...meta, seqs: Object.fromEntries(Object.entries(scopes).map(([k, s]) => [k, writtenSeq(s)])) });
  if (json !== savedJson) {
    savedJson = json;
    writeDocument(DOC, json);
  }
}

async function stateSaved() {
  while (sealing) await sealing;
}

function save() {
  saveDoc();
  const scopes = doc.scopes;
  const state = doc.enabled ? JSON.stringify(scopes) : "";
  if (state === savedState || sealing) return;
  if (!state) {
    savedState = "";
    writeDocument(STATE, "");
    return;
  }
  const seqs = Object.fromEntries(Object.entries(scopes).map(([k, s]) => [k, s.seq]));
  sealing = (async () => {
    try {
      const sealed = await SyncNative?.sealLocal(state);
      if (sealed) {
        await saveDocument(STATE, sealed);
        savedState = state;
        pruneJournal(seqs);
      }
    } catch (error) {
      console.warn("[sync] couldn't save the sync state", error);
    } finally {
      sealing = null;
    }
    if (doc.enabled && JSON.stringify(doc.scopes) !== savedState) save();
  })();
}

function publishUi(patch: Partial<SyncUi> = {}) {
  useSync.setState({
    enabled: doc.enabled,
    folder: doc.folder,
    types: { ...doc.types },
    profiles: { ...doc.profiles },
    lastSyncedAt: doc.lastSyncedAt,
    ...(doc.enabled ? summarize() : { devices: [], remoteTabs: {}, remoteProfiles: [], pending: 0 }),
    ...patch,
  });
}

export const deviceName = () => SyncNative?.deviceName() ?? "This Mac";

const inTodaysNames = (adapter: Adapter): Adapter => ({
  ...adapter,
  apply: (visible, changed, base, records) =>
    adapter.apply(new Map([...visible].map(([key, value]) => [key, fromLegacy(value)])), changed, (key) => fromLegacy(base(key)), records),
});

function appAdapters(retiring: boolean): Adapter[] {
  const id = doc.deviceId!;
  if (retiring) return [deviceAdapter(id, deviceName, true)];
  const enabledLinks = () => Object.fromEntries(Object.entries(doc.profiles).filter(([, l]) => l.enabled));
  return [
    ...(doc.types.settings ? [inTodaysNames(settingsAdapter)] : []),
    sharedDataAdapter(() => doc.profiles),
    profilesAdapter(enabledLinks),
    profileThemesAdapter(enabledLinks, () => doc.scopes[APP_SCOPE]?.records, themeAdopted),
    deviceAdapter(id, deviceName),
  ];
}

function profileAdapters(profileId: string, retiring: boolean): Adapter[] {
  const id = doc.deviceId!;
  if (retiring) return [deviceTabsAdapter(profileId, id, deviceName, true)];
  const s = useBrowser.getState();
  const ownsData = !s.profiles[profileId]?.dataId;
  const t = doc.types;
  let passwords = passwordAdapters.get(profileId);
  if (!passwords) passwordAdapters.set(profileId, (passwords = passwordsAdapter(profileId, () => forcePasswords)));
  return [
    ...(t.pinned ? [inTodaysNames(pinnedTreeAdapter(profileId)), tileFoldersAdapter(profileId)] : []),
    ...(t.bookmarks && ownsData ? [inTodaysNames(bookmarksAdapter(profileId))] : []),
    ...(t.history && ownsData ? [inTodaysNames(historyAdapter(profileId))] : []),
    inTodaysNames(deviceTabsAdapter(profileId, id, deviceName, !t.tabs)),
    ...(t.passwords && ownsData ? [passwords] : []),
    ...(t.extensions && ownsData && extensionSyncAvailable() ? [extensionsOf(profileId)] : []),
  ];
}

async function watchExtensions() {
  if (!doc.enabled || !doc.types.extensions) return;
  const s = useBrowser.getState();
  const profiles = [...new Set(Object.entries(doc.profiles).filter(([id, l]) => l.enabled && s.profiles[id] && !s.profiles[id]!.dataId).map(([id]) => engineProfile(id)))];
  if (profiles.length && (await probeExtensionSync(profiles[0]!))) watchExtensionIntents(profiles);
}

function extensionsOf(profileId: string): ExtensionsAdapter {
  let adapter = extensionAdapters.get(profileId);
  if (!adapter) extensionAdapters.set(profileId, (adapter = extensionsAdapterFor(profileId)));
  return adapter;
}

function scheduleSync(delay = AFTER_EDIT_MS) {
  if (!doc.enabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => void runCycle(), delay);
}

const resumeWhenLocalDataReady = () => scheduleSync(0);

export async function syncNow() {
  forcePasswords = true;
  await runCycle();
}

async function runCycle({ retiring = false } = {}) {
  const native = SyncNative;
  if (!native || !doc.enabled || !doc.folder || !doc.deviceId) return;
  if (!localDataReady()) return whenLocalDataReady(resumeWhenLocalDataReady);
  if (running) {
    again = true;
    return;
  }
  running = true;
  clearTimeout(timer);
  const slow = setTimeout(() => useSync.getState().status === "updated" && publishUi({ status: "updating" }), 1000);
  try {
    if (retiring && doc.chain !== "ready") return;
    await stateSaved();
    await watchExtensions();
    const status = await native.chainStatus(doc.folder);
    if (status === "unavailable") return publishUi({ status: "offline", error: null });
    const chain = await openChain(native, doc.folder, status);
    if (chain === "lost") return await resetFromElsewhere();
    if (chain === "awaiting") return publishUi({ status: "starting", error: null });
    const transport = folderTransport(native, doc.folder);
    const clock = new Clock(doc.deviceId, doc.clock);
    const device = doc.deviceId;
    const app = (doc.scopes[APP_SCOPE] ??= { ...emptyScope(), awaitRemote: doc.joining });
    settleAppliedThemes(app);
    const appCycle = await syncScope({
      scope: APP_SCOPE,
      state: app,
      transport,
      adapters: appAdapters(retiring),
      clock,
      device,
      options: { persist: persistJournal(APP_SCOPE), adoptBeforePublish: doc.adoptBeforePublish },
    });
    if (appCycle.adopted) again = true;
    if (app.joined) linkProfiles(app);
    confirmThemes(app);
    let pending = app.pending;
    const s = useBrowser.getState();
    const remotelySynced = (syncId: string) => doc.joining && !!app.records[`prof:${syncId}`]?.v;
    for (const [profileId, link] of app.joined ? Object.entries(doc.profiles) : []) {
      const exists = !!s.profiles[profileId];
      const retire = retiring || !!link.retire || !exists;
      if (!retire && !link.enabled) continue;
      const scope = `p:${link.syncId}`;
      const state = (doc.scopes[scope] ??= { ...emptyScope(), ...(remotelySynced(link.syncId) ? { awaitRemote: true } : {}) });
      const profileCycle = await syncScope({
        scope,
        state,
        transport,
        adapters: profileAdapters(profileId, retire),
        clock,
        device,
        options: { expired: historyExpired, persist: persistJournal(scope), adoptBeforePublish: doc.adoptBeforePublish },
      });
      if (profileCycle.adopted) again = true;
      pending += state.pending;
      if (!retire && doc.types.extensions && !s.profiles[profileId]?.dataId && extensionSyncAvailable()) await extensionsOf(profileId).reconcile(visible(state, "ext:"), Date.now());
      if (retire) {
        delete link.retire;
        if (!exists) {
          delete doc.scopes[scope];
          delete doc.profiles[profileId];
        }
      }
    }
    doc.clock = clock.last;
    doc.lastSyncedAt = Date.now();
    if (app.joined) doc.joining = false;
    forcePasswords = false;
    publishUi({ status: "updated", error: null, pending });
  } catch (error) {
    console.warn("[sync] cycle failed", error);
    publishUi({ status: "stalled", error: errorText(error) });
  } finally {
    clearTimeout(slow);
    running = false;
    save();
    if (doc.enabled) {
      if (again) {
        again = false;
        scheduleSync(0);
      } else {
        scheduleSync(CYCLE_MS);
      }
    }
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

type OpenChain = "open" | "awaiting" | "lost";

async function openChain(native: NonNullable<typeof SyncNative>, folder: string, status: "ok" | "previous" | "missing"): Promise<OpenChain> {
  if (doc.chain === "ready") return status === "ok" ? "open" : "lost";
  if (status === "missing") return "lost";
  if (doc.chain === "imported" && status === "ok") return settleChain(true);
  if (doc.chain === "imported") {
    doc.chain = "creating";
    saveDoc();
  }
  if (doc.chain === "creating") {
    await native.createChain(folder);
    return settleChain(false);
  }
  return status === "ok" ? settleChain(doc.joining) : "awaiting";
}

function settleChain(joining: boolean): OpenChain {
  doc.chain = "ready";
  doc.joining = joining;
  saveDoc();
  return "open";
}

function pairedTheme(app: ScopeState, syncId: string): Pick<Profile, "theme"> | null {
  const record = app.records[`pth:${syncId}`]?.v;
  if (record) return themeFromRecord(record, app.records[themeAngleKey(syncId)]?.v);
  const profile = app.records[`prof:${syncId}`]?.v as ProfileRecord | null | undefined;
  return profile ? legacyThemeOf(profile) : null;
}

function settledTheme(app: ScopeState, syncId: string): boolean {
  const record = app.records[`pth:${syncId}`]?.v;
  return !!record && !!themeFromRecord(record);
}

function pairTheme(app: ScopeState, profileId: string, link: ProfileLink) {
  const theme = pairedTheme(app, link.syncId);
  if (theme) useBrowser.getState().updateProfile(profileId, theme);
  if (settledTheme(app, link.syncId)) delete link.themeAdopting;
  else link.themeAdopting = true;
}

function settleAppliedThemes(app: ScopeState | undefined) {
  if (!app) return;
  for (const link of Object.values(doc.profiles)) {
    if (!link.themeAdopting) continue;
    const key = `pth:${link.syncId}`;
    const record = app.records[key]?.v;
    if (record && themeFromRecord(record) && app.base[key] === canonical(record)) delete link.themeAdopting;
  }
}

function confirmThemes(app: ScopeState) {
  settleAppliedThemes(app);
  if (app.pending > 0 || Object.keys(app.damaged).length > 0) return;
  if (Object.values(app.files).some((f) => f.k === "bad")) return;
  for (const link of Object.values(doc.profiles)) {
    if (!link.themeAdopting) continue;
    const record = app.records[`pth:${link.syncId}`];
    if (!record || record.v === null) delete link.themeAdopting;
  }
}

function themeAdopted(profileId: string) {
  const link = doc.profiles[profileId];
  if (link?.themeAdopting) delete link.themeAdopting;
}

export function adoptProfileTheme(profileId: string) {
  const link = doc.profiles[profileId];
  if (!link?.themeAdopting) return;
  delete link.themeAdopting;
  save();
  if (doc.enabled) scheduleSync(AFTER_EDIT_MS);
}

function linkProfiles(app: ScopeState) {
  const s = useBrowser.getState();
  const remote = [...visible(app, "prof:")].map(([k, v]) => [k.slice(5), v as ProfileRecord] as const);
  const taken = new Set(Object.values(doc.profiles).map((l) => l.syncId));
  for (const id of s.profileOrder) {
    const profile = s.profiles[id];
    if (!profile || isIncognitoProfile(id) || doc.profiles[id]) continue;
    const match = doc.joining
      ? remote.find(([syncId, r]) => !taken.has(syncId) && (id === DEFAULT_PROFILE_ID ? r.d : r.n === profile.name))?.[0]
      : undefined;
    const syncId = match ?? SyncNative!.newDeviceId();
    doc.profiles[id] = { syncId, enabled: true };
    taken.add(syncId);
    if (match) {
      doc.scopes[`p:${syncId}`] = { ...emptyScope(), awaitRemote: true };
      pairTheme(app, id, doc.profiles[id]!);
    }
  }
  for (const [id, link] of Object.entries(doc.profiles)) if (!s.profiles[id] && !link.retire) link.retire = true;
}

async function resetFromElsewhere() {
  await SyncNative?.forget(doc.deviceId!);
  doc = { ...emptyDoc(), folder: doc.folder, types: doc.types };
  clearJournal();
  save();
  publishUi({ status: "reset", error: "This device is out of sync. Sync may have been reset from another device." });
}

function summarize(): Pick<SyncUi, "devices" | "remoteTabs" | "remoteProfiles"> {
  const app = doc.scopes[APP_SCOPE];
  if (!app) return { devices: [], remoteTabs: {}, remoteProfiles: [] };
  const lastSeen = new Map<string, number>();
  for (const scope of Object.values(doc.scopes)) {
    for (const [device, at] of Object.entries(scope.seen)) lastSeen.set(device, Math.max(at, lastSeen.get(device) ?? 0));
  }
  const names = new Map([...visible(app, "dev:")].map(([k, v]) => [k.slice(4), (v as DeviceRecord).n]));
  const devices: SyncedDevice[] = [...names].map(([id, name]) => ({ id, name, lastSeen: lastSeen.get(id) ?? null, current: id === doc.deviceId }));
  devices.sort((a, b) => Number(b.current) - Number(a.current) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const remoteTabs: Record<string, RemoteTabs[]> = {};
  for (const [profileId, link] of Object.entries(doc.profiles)) {
    const scope = doc.scopes[`p:${link.syncId}`];
    if (!scope || !link.enabled) continue;
    remoteTabs[profileId] = [...visible(scope, "tabs:")]
      .map(([k, v]) => ({ deviceId: k.slice(5), value: v as DeviceTabs }))
      .filter(({ deviceId, value }) => deviceId !== doc.deviceId && names.has(deviceId) && value.tabs.length > 0)
      .map(({ deviceId, value }) => ({ deviceId, name: names.get(deviceId) || value.n || "Unknown Device", tabs: value.tabs.map((t) => ({ url: t.u, title: t.t })) }));
  }
  const linked = new Set(Object.values(doc.profiles).map((l) => l.syncId));
  const remoteProfiles = [...visible(app, "prof:")]
    .filter(([k]) => !linked.has(k.slice(5)))
    .map(([k, v]): RemoteProfile => {
      const syncId = k.slice(5);
      const record = v as ProfileRecord;
      const { adds, sharesWith, waitingFor } = sharedDataChain(syncId);
      const ownerName = adds[1] ? remoteProfileRecord(adds[1])?.n : sharesWith ? useBrowser.getState().profiles[sharesWith]?.name : undefined;
      return {
        syncId,
        name: record.n,
        color: record.c,
        icon: record.i,
        ...(ownerName !== undefined ? { sharesWith: { name: ownerName, added: !!adds[1] } } : {}),
        ...(waitingFor ? { waiting: true as const } : {}),
      };
    });
  return { devices, remoteTabs, remoteProfiles };
}

export async function folderInfo(path?: string | null): Promise<FolderInfo | null> {
  return (await SyncNative?.folderInfo(path ?? doc.folder ?? null)) ?? null;
}

function setSyncFolder(path: string) {
  if (doc.enabled) return;
  doc.folder = path;
  save();
  publishUi();
}

export async function chooseSyncFolder(): Promise<string | null> {
  const picked = (await SyncNative?.chooseFolder(doc.folder)) ?? null;
  if (picked) setSyncFolder(picked);
  return picked;
}

function begin(folder: string, deviceId: string, joining: boolean) {
  doc = { ...emptyDoc(), types: doc.types, enabled: true, folder, deviceId, setupAt: Date.now(), joining, chain: joining ? "awaiting" : "ready" };
  clearJournal();
  save();
  publishUi({ status: "starting", error: null });
  scheduleSync(0);
}

export async function turnOnSync(folder: string): Promise<{ ok: true } | { error: string }> {
  const native = SyncNative;
  if (!native) return { error: "Sync isn’t available in this build." };
  const deviceId = native.newDeviceId();
  try {
    if (!(await native.createPhrase(deviceId))) return { error: "Couldn’t save the sync key in your Keychain." };
    await native.createChain(folder);
  } catch (error) {
    await native.forget(deviceId);
    return { error: `Couldn’t use that folder: ${errorText(error)}` };
  }
  begin(folder, deviceId, false);
  return { ok: true };
}

export async function enterRecoveryPhrase(folder: string, text: string): Promise<PhraseResult | { error: "unavailable" }> {
  const native = SyncNative;
  if (!native) return { error: "unavailable" };
  if (doc.enabled && doc.deviceId && useSync.getState().status === "locked") {
    const result = await native.enterPhrase(doc.deviceId, text, doc.folder ?? folder);
    if ("ok" in result) {
      await loadState();
      publishUi({ status: "starting", error: null });
      scheduleSync(0);
    }
    return result;
  }
  const deviceId = native.newDeviceId();
  const result = await native.enterPhrase(deviceId, text, folder);
  if ("ok" in result) begin(folder, deviceId, true);
  return result;
}

export async function stopSync({ deleteData = false } = {}) {
  const native = SyncNative;
  if (!native || !doc.enabled) return;
  clearTimeout(timer);
  while (running) await new Promise((r) => setTimeout(r, 100));
  try {
    if (useSync.getState().status !== "locked") await runCycle({ retiring: true });
  } catch {}
  clearTimeout(timer);
  const folder = doc.folder;
  if (deleteData && folder) {
    try {
      await native.deleteChain(folder);
    } catch (error) {
      console.warn("[sync] deleting sync data failed", error);
    }
  }
  if (doc.deviceId) await native.forget(doc.deviceId);
  doc = { ...emptyDoc(), folder, types: doc.types };
  passwordAdapters.clear();
  extensionAdapters.clear();
  clearJournal();
  save();
  publishUi({ status: "off", error: null });
}

export function setTypeSynced(type: DataType, enabled: boolean) {
  doc.types = { ...doc.types, [type]: enabled };
  save();
  publishUi();
  scheduleSync(0);
}

export function setProfileSynced(profileId: string, enabled: boolean) {
  const link = doc.profiles[profileId];
  if (!link) return;
  doc.profiles[profileId] = enabled
    ? { syncId: link.syncId, enabled, ...(link.themeAdopting ? { themeAdopting: true as const } : {}) }
    : { ...link, enabled, retire: true };
  save();
  publishUi();
  scheduleSync(0);
}

const remoteProfileRecord = (syncId: string) => (doc.scopes[APP_SCOPE]?.records[`prof:${syncId}`]?.v ?? undefined) as ProfileRecord | undefined;

const sharedDataOwner = (syncId: string): string | null => {
  const owner = (doc.scopes[APP_SCOPE]?.records[`share:${syncId}`]?.v as ShareRecord | null | undefined)?.o;
  return owner && owner !== syncId ? owner : null;
};

const linkedProfileId = (syncId: string): string | null => {
  const profiles = useBrowser.getState().profiles;
  return Object.entries(doc.profiles).find(([id, link]) => link.syncId === syncId && !link.retire && profiles[id])?.[0] ?? null;
};

function sharedDataChain(syncId: string): { adds: string[]; sharesWith: string | null; waitingFor?: string } {
  const adds = [syncId];
  for (let at = syncId; ; ) {
    const owner = sharedDataOwner(at);
    if (!owner) return { adds, sharesWith: null };
    const here = linkedProfileId(owner);
    if (here) return { adds, sharesWith: here };
    if (!remoteProfileRecord(owner)) return { adds, sharesWith: null, waitingFor: owner };
    if (adds.includes(owner)) {
      const lowest = adds.slice(adds.indexOf(owner)).sort()[0]!;
      return { adds: adds.slice(0, adds.indexOf(lowest) + 1), sharesWith: null };
    }
    adds.push(owner);
    at = owner;
  }
}

export const appScopeRecords = () => doc.scopes[APP_SCOPE]?.records ?? {};

export function addRemoteProfile(syncId: string): string | null {
  if (!remoteProfileRecord(syncId) || linkedProfileId(syncId)) return null;
  const { adds, sharesWith, waitingFor } = sharedDataChain(syncId);
  if (waitingFor) return null;
  let shareWith = sharesWith;
  for (const add of adds.reverse()) shareWith = addLinkedProfile(add, remoteProfileRecord(add)!, shareWith);
  save();
  publishUi();
  scheduleSync(0);
  return shareWith;
}

function addLinkedProfile(syncId: string, record: ProfileRecord, shareWith: string | null): string {
  const id = useBrowser.getState().createProfile({ name: record.n, color: record.c, icon: record.i, shareWith });
  const app = doc.scopes[APP_SCOPE];
  doc.profiles[id] = { syncId, enabled: true };
  if (app) pairTheme(app, id, doc.profiles[id]!);
  else {
    const theme = legacyThemeOf(record);
    if (theme) useBrowser.getState().updateProfile(id, theme);
    doc.profiles[id]!.themeAdopting = true;
  }
  doc.scopes[`p:${syncId}`] = { ...emptyScope(), awaitRemote: true };
  return id;
}

export function startSync() {
  if (!SyncNative) return;
  load();
  publishUi({ status: doc.enabled ? "starting" : "off" });
  void watchExtensions();
  if (doc.enabled && doc.deviceId) {
    void SyncNative.unlock(doc.deviceId).then(async (ok) => {
      if (!ok) return publishUi({ status: "locked", error: "Enter your recovery phrase to keep syncing on this Mac." });
      await loadState();
      settleAppliedThemes(doc.scopes[APP_SCOPE]);
      publishUi();
      scheduleSync(500);
    });
  }
  useBrowser.subscribe((s, prev) => {
    if (!doc.enabled || running) return;
    if (s.bookmarks !== prev.bookmarks || s.settings !== prev.settings || s.profiles !== prev.profiles || s.groups !== prev.groups) scheduleSync();
  });
  if (__DEV__) {
    (globalThis as { acSync?: object }).acSync = {
      useSync, syncNow, turnOnSync, enterRecoveryPhrase, stopSync, setTypeSynced, setProfileSynced, addRemoteProfile, setSyncFolder, folderInfo,
      doc: () => doc,
      native: SyncNative,
      get menu(): typeof import("./menu") {
        return require("./menu");
      },
      get sheets(): typeof import("../components/settings/panes/SyncSheets") {
        return require("../components/settings/panes/SyncSheets");
      },
    };
  }
}
