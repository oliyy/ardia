import { create } from "zustand";
import { orWarn } from "../../lib/fallback";
import { engineInfo } from "../../platform/app";
import { applyExtensionsSync } from "../../platform/extensions";
import { useBrowser } from "../browser/store";
import { engineProfile } from "../browser/model";
import { readLocal as readExtensionState } from "../sync/extensions";
import type { ImportedExtension } from "./apply";

export type ExtensionInstallState = "installing" | "installed" | "present" | "failed" | "unavailable";

export type ExtensionInstall = ImportedExtension & { batch: number; profileId: string; state: ExtensionInstallState; reason?: string; storeLink?: boolean };

export const useExtensionInstalls = create<{ list: ExtensionInstall[] }>()(() => ({ list: [] }));

export const clearExtensionInstalls = () => useExtensionInstalls.setState({ list: [] });

type StoreAnswer = { kind: "served" | "unknown" | "malware" | "unserved"; size: number };
type ExtensionRecord = { on: boolean; inc: boolean; pin: boolean };

const UPDATE_URL = "https://clients2.google.com/service/update2/crx";
const STORE_BATCH = 25;
const STORE_TIMEOUT_MS = 15_000;
const READY_TIMEOUT_MS = 15_000;
const POLL_MS = 1_000;
const INSTALL_MS = 20_000;
const SLOWEST_BYTES_PER_MS = 250;
const GONE_POLLS = 2;
const BUSY_UPDATER_MS = 240_000;
const NUDGE_MS = 15_000;

const UNAVAILABLE: Record<Exclude<ImportedExtension["source"], "webStore">, string> = {
  unpacked: "Loaded unpacked, so it can't be downloaded. Load its folder again in Settings › Extensions",
  policy: "Installed by your organization's policy",
  sideloaded: "Not from the Chrome Web Store, so it can't be downloaded",
};

const REFUSED: { [kind in StoreAnswer["kind"]]: string } = {
  unknown: "Not in the Chrome Web Store",
  malware: "Removed from the Chrome Web Store as malware",
  unserved: "No longer offered for this version of Chrome",
  served: "Couldn't finish installing it",
};

let batches = 0;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function update(batch: number, profile: string, id: string, patch: Partial<ExtensionInstall>) {
  useExtensionInstalls.setState((s) => ({
    list: s.list.map((x) => (x.batch === batch && x.id === id && engineProfile(useBrowser.getState(), x.profileId) === profile ? { ...x, ...patch } : x)),
  }));
}

async function askStore(ids: string[]): Promise<Map<string, StoreAnswer> | null> {
  const version = await engineInfo()
    .then((info) => info.chromiumVersion)
    .catch(orWarn(null));
  if (!version || !ids.length) return null;
  const answers = new Map<string, StoreAnswer>();
  try {
    for (let i = 0; i < ids.length; i += STORE_BATCH) {
      const query = ids
        .slice(i, i + STORE_BATCH)
        .map((id) => `&x=${encodeURIComponent(`id=${id}&uc`)}`)
        .join("");
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), STORE_TIMEOUT_MS);
      const response = await fetch(`${UPDATE_URL}?response=updatecheck&acceptformat=crx3&prodversion=${version}${query}`, { signal: abort.signal }).finally(() =>
        clearTimeout(timer),
      );
      if (!response.ok) return null;
      for (const [, id, app] of (await response.text()).matchAll(/<app appid="([a-p]{32})"([\s\S]*?)(?:\/>|<\/app>)/g)) {
        const kind = /_malware="true"/.test(app!) ? "malware" : /codebase="/.test(app!) ? "served" : /^[^>]*status="error-/.test(app!) ? "unknown" : "unserved";
        answers.set(id!, { kind, size: Number(/ size="(\d+)"/.exec(app!)?.[1] ?? 0) });
      }
    }
  } catch {
    return null;
  }
  return answers;
}

async function readyState(profile: string) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const local = await readExtensionState(profile);
    if (local?.ready || Date.now() > deadline) return local?.ready ? local : null;
    await delay(POLL_MS);
  }
}

async function apply(profile: string, id: string, record: ExtensionRecord | { removed: true }, approval?: { v: string; fps: string[] }): Promise<string> {
  return applyExtensionsSync(profile, { id, record, ...(approval ? { approval } : {}) })
    .then((r): string => r.state)
    .catch(orWarn("invalid"));
}

async function arrival(profile: string, id: string, record: ExtensionRecord, size: number, patientUntil: number) {
  const deadline = Date.now() + INSTALL_MS + size / SLOWEST_BYTES_PER_MS;
  let gone = 0;
  let nudged = 0;
  for (;;) {
    await delay(POLL_MS);
    const local = await readExtensionState(profile);
    const installed = local?.extensions.find((e) => e.id === id);
    if (installed) return installed;
    const pending = !!local?.pending.includes(id);
    gone = local && !pending ? gone + 1 : 0;
    if (gone >= GONE_POLLS) return null;
    if (Date.now() < deadline) continue;
    if (!pending || Date.now() > patientUntil) return null;
    if (Date.now() - nudged < NUDGE_MS) continue;
    nudged = Date.now();
    await apply(profile, id, { removed: true });
    await apply(profile, id, record);
  }
}

async function installInto(batch: number, profile: string, list: ImportedExtension[], answers: Map<string, StoreAnswer> | null) {
  const fail = (id: string, reason: string, storeLink = false) => update(batch, profile, id, { state: "failed", reason, storeLink });
  const local = await readyState(profile);
  if (!local) return list.forEach((e) => fail(e.id, "Ardia's extensions aren't ready. Try importing them again", true));
  const have = new Set(local.extensions.map((e) => e.id));
  const patientUntil = Date.now() + BUSY_UPDATER_MS;
  for (const e of list) {
    if (have.has(e.id)) {
      update(batch, profile, e.id, { state: "present" });
      continue;
    }
    const answer = answers?.get(e.id);
    if (answer && answer.kind !== "served") {
      fail(e.id, REFUSED[answer.kind], answer.kind === "unserved");
      continue;
    }
    const record = { on: e.enabled, inc: e.incognito, pin: e.pinned };
    const state = await apply(profile, e.id, record);
    if (state === "installed" || state === "kept" || state === "updating") {
      update(batch, profile, e.id, { state: "present" });
      continue;
    }
    if (state !== "pending") {
      fail(e.id, state === "blocked" ? "Extensions are blocked by a policy on this Mac" : "Ardia couldn't add it", state !== "blocked");
      continue;
    }
    const installed = await arrival(profile, e.id, record, answer?.size ?? 0, patientUntil);
    if (!installed) {
      fail(e.id, answers ? REFUSED.served : "Couldn't download it from the Chrome Web Store", true);
      void apply(profile, e.id, { removed: true });
      continue;
    }
    if (!e.needsApproval && !installed.approved && installed.version && installed.fingerprint !== undefined) {
      await apply(profile, e.id, record, { v: installed.version, fps: [installed.fingerprint] });
    }
    update(batch, profile, e.id, { state: "installed" });
  }
}

export async function installImportedExtensions(groups: { profileId: string; list: ImportedExtension[] }[]) {
  const batch = ++batches;
  const byProfile = new Map<string, { profileId: string; list: ImportedExtension[] }>();
  for (const g of groups) {
    const profile = engineProfile(useBrowser.getState(), g.profileId);
    const into = byProfile.get(profile) ?? { profileId: g.profileId, list: [] };
    for (const e of g.list) if (!into.list.some((x) => x.id === e.id)) into.list.push(e);
    byProfile.set(profile, into);
  }
  const entries = [...byProfile.values()].flatMap(({ profileId, list }) =>
    list.map(
      (e): ExtensionInstall =>
        e.source === "webStore" ? { ...e, batch, profileId, state: "installing" } : { ...e, batch, profileId, state: "unavailable", reason: UNAVAILABLE[e.source] },
    ),
  );
  useExtensionInstalls.setState({ list: [...entries.filter((e) => e.state !== "unavailable"), ...entries.filter((e) => e.state === "unavailable")] });
  const fromStore = (list: ImportedExtension[]) => list.filter((e) => e.source === "webStore");
  const answers = await askStore([...new Set([...byProfile.values()].flatMap((g) => fromStore(g.list).map((e) => e.id)))]);
  await Promise.all([...byProfile].map(([profile, g]) => installInto(batch, profile, fromStore(g.list), answers)));
}
