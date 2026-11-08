import { hostOf } from "@ardia/core";
import { translation } from "../../platform/text";
import { create } from "zustand";
import { webviews } from "../../platform/webviews";
import { useBrowser } from "../browser/store";
import { changedIds } from "../browser/changes";
import { incognitoOriginal, isIncognitoProfile } from "../browser/model";
import { hideKeyedToast, showToast } from "../app/toasts";
import { PAGE_PROBE, translatorCall, type PageProbe, type Passage } from "./pageTranslator";
import { errorText } from "../../lib/errors";
import { registrableDomain } from "../../lib/url";
import { baseLanguage, defaultTarget, languageName, sourceLetters, userLanguages } from "./translateLanguages";

export { translation } from "../../platform/text";
export { baseLanguage, defaultTarget, languageName, otherLanguages, sourceLetters } from "./translateLanguages";

type TranslateState = { status: "idle"; source: string | null } | { status: "translating" | "translated"; source: string; target: string; token: string };

const IDLE: TranslateState = { status: "idle", source: null };
export const useTranslate = create<Record<string, TranslateState | undefined>>()(() => ({}));
const stateOf = (tabId: string) => useTranslate.getState()[tabId] ?? IDLE;
const set = (tabId: string, state: TranslateState) => useTranslate.setState({ [tabId]: state });
const toIdle = (tabId: string) => set(tabId, { status: "idle", source: stateOf(tabId).source });
function setSource(tabId: string, source: string | null) {
  if (stateOf(tabId).status === "idle") set(tabId, { status: "idle", source });
}
export const isTranslated = (tabId: string) => stateOf(tabId).status !== "idle";
export function translationTarget(tabId: string): string | null {
  const state = stateOf(tabId);
  return state.status === "idle" ? null : state.target;
}
export const useTranslateState = (tabId: string) => useTranslate((s) => s[tabId] ?? IDLE);

const BATCH = 8;
const BATCH_CHARS = 2000;
const WAIT_MS = 5000;
const WAIT_GRACE_MS = 2000;
const SHORT_TEXT = 40;
const SETTLED_TEXT = 200;
const LOADED_PASSES = [0, 2000] as const;
const SAME_DOCUMENT_PASSES = [700, 2000] as const;
const PROGRESS_AFTER_MS = 1200;
const RESUME_POLL_MS = 150;
const RESUME_DEADLINE_MS = 30000;
const PROGRESS_TOAST = "translate-progress";

const translatableHost = (url: string) => (/^https?:/i.test(url) ? hostOf(url) : "");
const siteOf = (url: string) => {
  const host = translatableHost(url);
  return host ? registrableDomain(host) : "";
};

type Mode = { site: string; target: string; source: string };
const modes = new Map<string, Mode>();
const resumes = new Map<string, number>();
const autoRuns = new Set<string>();

function endMode(tabId: string) {
  modes.delete(tabId);
  resumes.set(tabId, (resumes.get(tabId) ?? 0) + 1);
}

function listOwner(profileId: string): string {
  return isIncognitoProfile(profileId) ? incognitoOriginal(profileId) : profileId;
}
export function isNeverTranslated(profileId: string, url: string): boolean {
  const host = translatableHost(url);
  return !!host && (useBrowser.getState().settings.neverTranslateSites[listOwner(profileId)] ?? []).includes(host);
}
export function setNeverTranslate(tabId: string, never: boolean) {
  const s = useBrowser.getState();
  const tab = s.tabs[tabId];
  const host = tab ? translatableHost(tab.url) : "";
  if (!tab || !host || isIncognitoProfile(tab.profileId)) return;
  const all = s.settings.neverTranslateSites;
  const list = (all[tab.profileId] ?? []).filter((h) => h !== host);
  s.updateSettings({ neverTranslateSites: { ...all, [tab.profileId]: never ? [...list, host] : list } });
  if (!never) return void detect(tabId);
  endMode(tabId);
  if (stateOf(tabId).status !== "idle") void revertPage(tabId, { quiet: true });
  setSource(tabId, null);
}

type Sample = { lang: string; text: string; active: boolean };
type PageLanguage = { language: string | null; active: boolean; thin: boolean };

async function pageLanguage(tabId: string): Promise<PageLanguage | null> {
  const sample = await webviews.get(tabId)?.evaluate<Sample>(translatorCall("sample"));
  if (!sample || !translation) return null;
  const text = sample.text.trim();
  const lang = sample.lang ? String(sample.lang).slice(0, 20) : null;
  const language = text.length >= SHORT_TEXT ? await translation.detect(text.slice(0, 3000)) : lang;
  return { language, active: !!sample.active, thin: text.length < SETTLED_TEXT };
}

async function detect(tabId: string, settled = true) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!translation || !tab || !translatableHost(tab.url)) return set(tabId, IDLE);
  let page = await pageLanguage(tabId);
  if (!page) return;
  if (page.active && stateOf(tabId).status === "idle" && !modes.has(tabId)) {
    await webviews.get(tabId)?.evaluate(translatorCall("revert"));
    page = await pageLanguage(tabId);
    if (!page) return;
  }
  if (!page.active && stateOf(tabId).status === "translated" && !modes.has(tabId)) toIdle(tabId);
  if (isNeverTranslated(tab.profileId, tab.url)) return setSource(tabId, null);
  if (page.thin && !settled) return;
  const mine = new Set(userLanguages().map(baseLanguage));
  const source = page.language && !mine.has(baseLanguage(page.language)) ? page.language : null;
  if (source && (await translation.status(source, defaultTarget())) === "unsupported") return setSource(tabId, null);
  if (useBrowser.getState().tabs[tabId]?.url !== tab.url) return;
  setSource(tabId, source);
}

const passes = new Map<string, ReturnType<typeof setTimeout>[]>();

function detectSoon(tabId: string, delays: readonly number[]) {
  for (const timer of passes.get(tabId) ?? []) clearTimeout(timer);
  passes.set(
    tabId,
    delays.map((delay, i) =>
      setTimeout(() => {
        if (useBrowser.getState().live[tabId]?.isLoading) return;
        void detect(tabId, i === delays.length - 1).catch(() => {});
      }, delay),
    ),
  );
}

type Batch = { passages: Passage[]; more: boolean; gone: boolean; done: number; total: number };

type Translated = [number, string | null];

async function translatePassages(source: string, target: string, passages: Passage[]): Promise<Translated[]> {
  const texts = passages.map(([, pieces]) => pieces.map(([, text]) => text));
  const whole = await translation!.translateBlocks(source, target, texts);
  const out: Translated[] = [];
  const loose: [number, string][] = [];
  passages.forEach(([, pieces], i) => {
    const parts = whole[i];
    if (parts && parts.length === pieces.length) pieces.forEach(([id], j) => out.push([id, parts[j] ?? ""]));
    else loose.push(...pieces);
  });
  if (loose.length) {
    const texts = await translation!.translate(source, target, loose.map(([, text]) => text));
    loose.forEach(([id], i) => out.push([id, texts[i] ?? null]));
  }
  return out;
}

function cleanPassages(passages: Passage[]): Passage[] {
  return passages
    .slice(0, BATCH * 4)
    .filter((p): p is Passage => Array.isArray(p) && Array.isArray(p[1]))
    .map(([id, pieces]): Passage => [id, pieces.filter((x) => Array.isArray(x) && typeof x[1] === "string").slice(0, 40)]);
}

async function drain(tabId: string, token: string, onProgress?: (done: number, total: number) => void): Promise<boolean> {
  let previous: Promise<boolean> = Promise.resolve(true);
  for (;;) {
    const current = stateOf(tabId);
    const web = webviews.get(tabId);
    if (current.status === "idle" || current.token !== token || !web) return previous.then(() => false);
    const { source, target } = current;
    const batch = await web.evaluate<Batch>(translatorCall("next", token, BATCH, BATCH_CHARS));
    if (!batch || batch.gone || !Array.isArray(batch.passages)) return previous.then(() => false);
    const passages = cleanPassages(batch.passages);
    const translated = passages.length ? translatePassages(source, target, passages) : Promise.resolve([]);
    translated.catch(() => {});
    const step = previous.then(async (ok) => {
      if (!ok) return false;
      let results: Translated[];
      try {
        results = await translated;
      } catch (error) {
        const untranslated: Translated[] = passages.flatMap(([, pieces]) => pieces.map(([id]): Translated => [id, null]));
        await web.evaluate(translatorCall("apply", untranslated)).catch(() => {});
        throw error;
      }
      if (!holds(tabId, token)) return false;
      if (results.length) await web.evaluate(translatorCall("apply", results));
      onProgress?.(batch.done, batch.total);
      return true;
    });
    step.catch(() => {});
    if (!batch.more) return step;
    if (!(await previous)) return step.then(() => false);
    previous = step;
  }
}

function holds(tabId: string, token: string) {
  const state = stateOf(tabId);
  return state.status !== "idle" && state.token === token;
}

const stillTranslated = (tabId: string, token: string) => {
  const current = stateOf(tabId);
  return current.status === "translated" && current.token === token;
};

type Wait = "work" | "idle" | "gone";

async function waitForText(tabId: string, token: string): Promise<Wait | null> {
  const web = webviews.get(tabId);
  if (!web) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS + WAIT_GRACE_MS));
  return Promise.race([web.evaluate<Wait>(translatorCall("wait", token, WAIT_MS)).catch(() => null), timeout]);
}

async function follow(tabId: string, token: string) {
  for (;;) {
    if (!stillTranslated(tabId, token)) return;
    const found = await waitForText(tabId, token);
    if (!stillTranslated(tabId, token)) return;
    if (found === "idle") continue;
    if (found === "work") {
      try {
        if (await drain(tabId, token)) continue;
      } catch {}
    }
    if (!holds(tabId, token)) return;
    if ((await pageLanguage(tabId).catch(() => null))?.active) continue;
    if (!holds(tabId, token)) return;
    if (modes.has(tabId)) return void resume(tabId);
    toIdle(tabId);
    return;
  }
}

function toast(tabId: string, title: string, message?: string, progress = false) {
  const windowId = useBrowser.getState().tabs[tabId]?.windowId;
  if (!windowId) return;
  if (progress) showToast(windowId, title, message, { icon: "translate", key: PROGRESS_TOAST, sticky: true });
  else showToast(windowId, title, message, { icon: "translate" });
}

export async function translatePage(tabId: string, target = defaultTarget()) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!translation || !tab || !webviews.get(tabId)) return;
  endMode(tabId);
  await revertPage(tabId, { quiet: true });
  const source = stateOf(tabId).source ?? (await pageLanguage(tabId))?.language ?? null;
  if (!source) return toast(tabId, "Translation error (can't tell the page's language)");
  if (baseLanguage(source) === baseLanguage(target)) return toast(tabId, `Translation error (the page is already in ${languageName(target)})`);
  try {
    const status = await translation.status(source, target);
    if (status === "unsupported") return toast(tabId, `Translation error (${languageName(source)} to ${languageName(target)} isn't available)`);
    if (status === "supported") await translation.prepare(source, target);
  } catch (error) {
    return failed(tabId, error);
  }
  const token = newToken();
  modes.set(tabId, { site: siteOf(useBrowser.getState().tabs[tabId]?.url ?? tab.url), target, source });
  await run(tabId, token, source, target, false);
}

const newToken = () => Math.random().toString(36).slice(2);

async function failed(tabId: string, error: unknown) {
  endMode(tabId);
  await revertPage(tabId, { quiet: true });
  toast(tabId, `Translation error (${errorText(error).replace(/[.\s]+$/, "")})`);
}

async function run(tabId: string, token: string, source: string, target: string, quiet: boolean) {
  const windowId = useBrowser.getState().tabs[tabId]?.windowId;
  let shown = false;
  try {
    set(tabId, { status: "translating", source, target, token });
    if (!(await webviews.get(tabId)?.evaluate<boolean>(translatorCall("start", token, sourceLetters(source))))) throw new Error("the page isn't ready");
    const started = Date.now();
    const done = await drain(tabId, token, (n, total) => {
      if (Date.now() - started < PROGRESS_AFTER_MS || total <= 0) return;
      shown = true;
      toast(tabId, `Translating to ${languageName(target)}…`, `${Math.min(99, Math.round((n / total) * 100))}%`, true);
    });
    if (shown && windowId) hideKeyedToast(windowId, PROGRESS_TOAST);
    if (!done) {
      if (!holds(tabId, token)) return;
      if (modes.has(tabId)) return void resume(tabId);
      return toIdle(tabId);
    }
    if (!holds(tabId, token)) return;
    set(tabId, { status: "translated", source, target, token });
    if (!quiet) toast(tabId, `Translated to ${languageName(target)}`);
    void follow(tabId, token);
  } catch (error) {
    if (holds(tabId, token)) await failed(tabId, error);
  }
}

async function probe(tabId: string): Promise<PageProbe | null> {
  return (await webviews.get(tabId)?.evaluate<PageProbe>(PAGE_PROBE).catch(() => null)) ?? null;
}

const isCurrent = (tabId: string, seq: number, mode: Mode) => resumes.get(tabId) === seq && modes.get(tabId) === mode;

async function resume(tabId: string) {
  const mode = modes.get(tabId);
  if (!mode) return;
  const seq = (resumes.get(tabId) ?? 0) + 1;
  resumes.set(tabId, seq);
  for (const deadline = Date.now() + RESUME_DEADLINE_MS; Date.now() < deadline; await new Promise((r) => setTimeout(r, RESUME_POLL_MS))) {
    if (!isCurrent(tabId, seq, mode)) return;
    if (autoRuns.has(tabId)) continue;
    const page = await probe(tabId);
    if (!isCurrent(tabId, seq, mode)) return;
    const tab = useBrowser.getState().tabs[tabId];
    if (!page || !tab || page.ready === "loading") continue;
    const state = stateOf(tabId);
    const ours = page.active && state.status !== "idle" && page.token === state.token;
    if (ours) {
      if (useBrowser.getState().live[tabId]?.isLoading) continue;
      return;
    }
    return void autoTranslate(tabId, mode, page.active);
  }
}

async function autoTranslate(tabId: string, mode: Mode, stale: boolean) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!tab || isNeverTranslated(tab.profileId, tab.url)) {
    endMode(tabId);
    return set(tabId, { status: "idle", source: null });
  }
  autoRuns.add(tabId);
  const token = newToken();
  const previous = stateOf(tabId);
  const known = previous.source ?? mode.source;
  try {
    set(tabId, { status: "translating", source: known, target: mode.target, token });
    const page = stale ? null : await pageLanguage(tabId);
    if (!holds(tabId, token) || modes.get(tabId) !== mode) return;
    const detected = page?.language ?? null;
    if (detected && baseLanguage(detected) === baseLanguage(mode.target)) return set(tabId, { status: "translated", source: known, target: mode.target, token });
    const source = detected ?? known;
    const status = await translation!.status(source, mode.target);
    if (status === "unsupported") return set(tabId, { status: "translated", source: known, target: mode.target, token });
    if (!holds(tabId, token) || modes.get(tabId) !== mode) return;
    if (status === "supported") await translation!.prepare(source, mode.target);
    if (!holds(tabId, token) || modes.get(tabId) !== mode) return;
    autoRuns.delete(tabId);
    await run(tabId, token, source, mode.target, true);
  } catch (error) {
    if (holds(tabId, token)) await failed(tabId, error);
  } finally {
    autoRuns.delete(tabId);
  }
}

export async function revertPage(tabId: string, { quiet = false } = {}) {
  const { source, status } = stateOf(tabId);
  if (!quiet) endMode(tabId);
  toIdle(tabId);
  await webviews.get(tabId)?.evaluate(translatorCall("revert"));
  if (!quiet && source && status !== "idle") toast(tabId, `Translated back to ${languageName(source)}`);
}

export function toggleTranslation(tabId: string) {
  if (stateOf(tabId).status === "idle") void translatePage(tabId);
  else void revertPage(tabId);
}

export function startTranslate() {
  if (!translation) return () => {};
  return useBrowser.subscribe((s, prev) => {
    for (const id of changedIds(s.live, prev.live)) {
      const loading = !!s.live[id]?.isLoading;
      const wasLoading = !!prev.live[id]?.isLoading;
      if (loading === wasLoading || !s.live[id]) continue;
      if (modes.has(id)) void resume(id);
      if (!loading) detectSoon(id, LOADED_PASSES);
    }
    if (s.tabs === prev.tabs) return;
    for (const id of changedIds(s.tabs, prev.tabs)) {
      const url = s.tabs[id]?.url;
      const before = prev.tabs[id]?.url;
      if (!url || !before || url === before) continue;
      const mode = modes.get(id);
      if (mode && siteOf(url) === mode.site) {
        void resume(id);
        continue;
      }
      if (mode) endMode(id);
      if ((mode || translatableHost(url) !== translatableHost(before)) && useTranslate.getState()[id]) set(id, IDLE);
      if (!s.live[id]?.isLoading) detectSoon(id, SAME_DOCUMENT_PASSES);
    }
    const gone = Object.keys(useTranslate.getState()).filter((id) => !s.tabs[id]);
    for (const id of gone) endMode(id);
    for (const id of gone) resumes.delete(id);
    for (const id of gone) for (const timer of passes.get(id) ?? []) clearTimeout(timer);
    for (const id of gone) passes.delete(id);
    if (gone.length) useTranslate.setState(Object.fromEntries(gone.map((id) => [id, undefined])));
  });
}
