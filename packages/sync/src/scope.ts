import { canonical } from "./canon.ts";
import { hlcWall, type Clock, type HLC } from "./hlc.ts";

export type Origin = [device: string, seq: number];
export type SyncRecord = { h: HLC; v: unknown; o: Origin; s?: HLC };
export type Op = { k: string; h: HLC; v: unknown; s?: HLC };

export type LogFile = { v: 1; kind: "log"; device: string; seq: number; at: number; ops: Op[] };
export type SnapshotFile = {
  v: 1;
  kind: "snapshot";
  device: string;
  at: number;
  vv: Record<string, number>;
  seen: Record<string, number>;
  records: Record<string, SyncRecord>;
};
export type SyncFile = LogFile | SnapshotFile;

type FileMeta = { d: string; k: "log" | "snapshot" | "bad"; s?: number; vv?: Record<string, number>; at: number };

export type ScopeState = {
  records: Record<string, SyncRecord>;
  base: Record<string, string>;
  unapplied: string[];
  vv: Record<string, number>;
  extra: Record<string, number[]>;
  files: Record<string, FileMeta>;
  damaged: Record<string, number>;
  pendingSince?: Record<string, number>;
  seq: number;
  outbox: Op[];
  journal?: LogFile[];
  seen: Record<string, number>;
  joined: boolean;
  awaitRemote?: boolean;
  applyAs?: Record<string, "joined" | "joining">;
  adopted?: Record<string, HLC>;
  awaitSeed?: true;
  seedDue?: Record<string, true>;
  claims?: HLC[];
  claim?: HLC;
  revoked?: string[];
  snapshotAt: number;
  pending: number;
};

export const emptyScope = (): ScopeState => ({
  records: {},
  base: {},
  unapplied: [],
  vv: {},
  extra: {},
  files: {},
  damaged: {},
  seq: 0,
  outbox: [],
  seen: {},
  joined: false,
  snapshotAt: 0,
  pending: 0,
});

export interface Transport {
  write(scope: string, payload: string): Promise<string>;
  read(scope: string, known: string[]): Promise<Listing>;
  remove(scope: string, ids: string[]): Promise<void>;
}

export type Listing = {
  files: { id: string; payload: string }[];
  pending: string[];
  damaged: { id: string; age: number }[];
  present: string[];
};

export type Extraction = {
  values: Map<string, unknown>;
  ignore?: (key: string) => boolean;
  republish?: (key: string) => boolean;
  published?: (keys: Set<string>) => void;
};

export type ApplyRecords = {
  known(key: string): boolean;
  now: number;
  horizon: number;
  joined: boolean;
};

export interface Adapter {
  prefix: string;
  extract(
    base: (key: string) => unknown,
    queued: (key: string) => boolean,
    now: number,
    known: (key: string) => boolean,
    remote: (key: string) => unknown,
    stamp: (key: string) => HLC | undefined,
  ): Extraction | null | Promise<Extraction | null>;
  apply(visible: Map<string, unknown>, changed: Set<string>, base: (key: string) => unknown, records: ApplyRecords): boolean | void | Promise<boolean | void>;
  editedAt?(value: unknown): number | undefined;
  adoptRemoteOnJoin?: boolean;
  publishAfterPull?: boolean;
  adoptBeforePublish?: boolean;
}

export type ScopeOptions = {
  expired?: (key: string, value: unknown, now: number) => boolean;
  tombstoneTTL?: number;
  compactAfterFiles?: number;
  compactInterval?: number;
  pruneGrace?: number;
  damagedGiveUp?: number;
  persist?: (batches: LogFile[]) => Promise<void>;
  adoptBeforePublish?: boolean;
};

const DEFAULTS: Required<Omit<ScopeOptions, "persist" | "adoptBeforePublish">> = {
  expired: () => false,
  tombstoneTTL: 45 * 86_400_000,
  compactAfterFiles: 40,
  compactInterval: 10 * 60_000,
  pruneGrace: 60 * 60_000,
  damagedGiveUp: 86_400_000,
};

export const covered = (vv: Record<string, number>, [device, seq]: Origin) => (vv[device] ?? 0) >= seq;

function markApplied(state: ScopeState, device: string, seq: number) {
  if (covered(state.vv, [device, seq])) return;
  const extra = new Set(state.extra[device] ?? []);
  extra.add(seq);
  let top = state.vv[device] ?? 0;
  while (extra.delete(top + 1)) top++;
  state.vv[device] = top;
  if (extra.size) state.extra[device] = [...extra].sort((a, b) => a - b);
  else delete state.extra[device];
}

const isApplied = (state: ScopeState, [device, seq]: Origin) =>
  covered(state.vv, [device, seq]) || (state.extra[device]?.includes(seq) ?? false);

function see(state: ScopeState, device: string, at: number) {
  if (!(device in state.seen) || at > state.seen[device]!) state.seen[device] = at;
}

const CLAIM = "seeding:";
const SEEDED = "seeded:";
const isSeedKey = (key: string) => key.startsWith(CLAIM) || key.startsWith(SEEDED);
const authority = (state: ScopeState): HLC | undefined => state.claims?.[0];
const losing = (state: ScopeState, record: SyncRecord) => record.s !== undefined && record.s !== authority(state);
const rank = (state: ScopeState, record: SyncRecord) => (record.s === undefined ? 2 : losing(state, record) ? 0 : 1);

function outranks(state: ScopeState, incoming: SyncRecord, current: SyncRecord) {
  const [a, b] = [rank(state, incoming), rank(state, current)];
  return a !== b ? a > b : incoming.h > current.h;
}

function noteClaim(state: ScopeState, claim: HLC) {
  if (state.claims?.includes(claim)) return;
  state.claims = [...(state.claims ?? []), claim].sort();
}

function revoke(state: ScopeState, key: string) {
  if (!state.revoked?.includes(key)) state.revoked = [...(state.revoked ?? []), key];
}

function clearRevoked(state: ScopeState, prefix: string) {
  const left = state.revoked?.filter((k) => !k.startsWith(prefix)) ?? [];
  if (left.length) state.revoked = left;
  else delete state.revoked;
}

function purgeLosing(state: ScopeState, changed: Set<string>) {
  for (const [key, record] of Object.entries(state.records)) {
    if (!losing(state, record)) continue;
    delete state.records[key];
    if (record.s !== state.claim) changed.add(key);
    else {
      if (key in state.base) revoke(state, key);
      delete state.base[key];
      changed.delete(key);
    }
  }
}

const opRecord = (op: Op, origin: Origin): SyncRecord => ({ h: op.h, v: op.v, o: origin, ...(op.s === undefined ? {} : { s: op.s }) });

function mergeRecord(state: ScopeState, key: string, record: SyncRecord, clock: Clock): boolean {
  clock.observe(record.h);
  if (record.s !== undefined) noteClaim(state, record.s);
  if (key.startsWith(CLAIM)) noteClaim(state, key.slice(CLAIM.length));
  if (losing(state, record)) return false;
  const current = state.records[key];
  if (current && !outranks(state, record, current)) return false;
  state.records[key] = record;
  return true;
}

function ingestLog(state: ScopeState, file: LogFile, clock: Clock, changed: Set<string>) {
  see(state, file.device, file.at);
  if (isApplied(state, [file.device, file.seq])) return;
  for (const op of file.ops) {
    if (mergeRecord(state, op.k, opRecord(op, [file.device, file.seq]), clock)) changed.add(op.k);
  }
  markApplied(state, file.device, file.seq);
}

export function ingestSnapshot(state: ScopeState, file: SnapshotFile, clock: Clock, changed: Set<string>) {
  for (const [device, at] of Object.entries(file.seen)) see(state, device, at);
  see(state, file.device, file.at);
  for (const [key, record] of Object.entries(file.records)) {
    if (!(key in state.records) && isApplied(state, record.o)) continue;
    if (mergeRecord(state, key, record, clock)) changed.add(key);
  }
  for (const [key, record] of Object.entries(state.records)) {
    if (!(key in file.records) && covered(file.vv, record.o)) {
      delete state.records[key];
      changed.add(key);
    }
  }
  for (const [device, seq] of Object.entries(file.vv)) {
    if (seq > (state.vv[device] ?? 0)) {
      state.vv[device] = seq;
      const extra = (state.extra[device] ?? []).filter((s) => s > seq);
      for (let top = seq; extra[0] === top + 1; top++) state.vv[device] = extra.shift()!;
      if (extra.length) state.extra[device] = extra;
      else delete state.extra[device];
    }
  }
}

export function visible(state: ScopeState, prefix: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, record] of Object.entries(state.records)) {
    if (record.v !== null && key.startsWith(prefix)) out.set(key, record.v);
  }
  return out;
}

const parseBase = (json: string | undefined) => (json === undefined ? undefined : (JSON.parse(json) as unknown));

const settling = new WeakMap<ScopeState, (() => void)[]>();
const waitingAfterPull = new WeakMap<ScopeState, boolean>();
const unreadAfterPull = new WeakMap<ScopeState, number>();

function settleWhenDurable(state: ScopeState, settle: () => void) {
  const queue = settling.get(state);
  if (queue) queue.push(settle);
  else settling.set(state, [settle]);
}

function settleDurable(state: ScopeState) {
  const queue = settling.get(state);
  if (!queue) return;
  settling.delete(state);
  for (const settle of queue) settle();
}

async function publishAdapter(state: ScopeState, adapter: Adapter, clock: Clock, device: string, now: number, seed?: HLC): Promise<Set<string> | null> {
  const published = new Set<string>();
  if (adapter.adoptRemoteOnJoin && !state.joined) return null;
  if (adapter.publishAfterPull && waitingAfterPull.get(state) !== false) return null;
  let pending: Set<string> | null = null;
  const queued = (key: string) => (pending ??= new Set([...state.outbox, ...(state.journal ?? []).flatMap((f) => f.ops)].map((op) => op.k))).has(key);
  const extraction = await adapter.extract((key) => parseBase(state.base[key]), queued, now, (key) => key in state.records, (key) => state.records[key]?.v, (key) => state.records[key]?.h);
  if (!extraction) return null;
  const put = (key: string, value: unknown) => {
    const known = state.records[key];
    const editedAt = !known && value !== null ? adapter.editedAt?.(value) : undefined;
    const h = editedAt !== undefined ? clock.at(editedAt) : clock.tick();
    const stamp = seed === undefined ? {} : { s: seed };
    const record: SyncRecord = { h, v: value, o: [device, state.seq + 1], ...stamp };
    if (known && !outranks(state, record, known)) return;
    state.records[key] = record;
    state.outbox.push({ k: key, h, v: value, ...stamp });
    published.add(key);
  };
  for (const [key, value] of extraction.values) {
    if (value === null || value === undefined) throw new Error(`[sync] ${key}: a live value can't be null`);
    const json = canonical(value);
    if (state.base[key] === json && !extraction.republish?.(key)) continue;
    state.base[key] = json;
    put(key, value);
  }
  for (const key of Object.keys(state.base)) {
    if (!key.startsWith(adapter.prefix) || extraction.values.has(key) || extraction.ignore?.(key)) continue;
    delete state.base[key];
    put(key, null);
  }
  const { published: settle } = extraction;
  if (settle && published.size) settleWhenDurable(state, () => settle(published));
  return published;
}

export async function publish(state: ScopeState, adapters: Adapter[], clock: Clock, device: string, now = Date.now()): Promise<Set<string>> {
  const published = new Set<string>();
  for (const adapter of adapters) for (const key of (await publishAdapter(state, adapter, clock, device, now)) ?? []) published.add(key);
  return published;
}

export async function flush(state: ScopeState, transport: Transport, scope: string, device: string, now: number, options: ScopeOptions = {}) {
  if (state.outbox.length) {
    state.seq++;
    (state.journal ??= []).push({ v: 1, kind: "log", device, seq: state.seq, at: now, ops: state.outbox });
    state.outbox = [];
  }
  if (!state.journal?.length) return;
  if (options.persist) {
    await options.persist(state.journal);
    settleDurable(state);
  }
  while (state.journal.length) {
    const file = state.journal[0]!;
    const id = await transport.write(scope, JSON.stringify(file));
    state.files[id] = { d: file.device, k: "log", s: file.seq, at: file.at };
    state.journal.shift();
    markApplied(state, file.device, file.seq);
    see(state, file.device, now);
  }
  delete state.journal;
  settleDurable(state);
}

export function restoreJournal(state: ScopeState, batches: LogFile[], clock: Clock, written = 0) {
  const saved = state.seq;
  for (const file of [...batches].sort((a, b) => a.seq - b.seq)) {
    if (file.seq <= state.seq) continue;
    if (file.seq === saved + 1) state.outbox = [];
    for (const op of file.ops) {
      const record = opRecord(op, [file.device, file.seq]);
      if (op.s !== undefined) state.claim ??= op.s;
      if (op.k.startsWith(CLAIM)) state.claim ??= op.k.slice(CLAIM.length);
      mergeRecord(state, op.k, record, clock);
      if (losing(state, record)) {
        if (record.s === state.claim) revoke(state, op.k);
        continue;
      }
      if (op.v === null) delete state.base[op.k];
      else state.base[op.k] = canonical(op.v);
    }
    state.seq = file.seq;
    if (file.seq <= written) markApplied(state, file.device, file.seq);
    else (state.journal ??= []).push(file);
  }
  state.seq = Math.max(state.seq, written);
}

export const writtenSeq = (state: ScopeState) => state.seq - (state.journal?.length ?? 0);

export async function pull(state: ScopeState, transport: Transport, scope: string, clock: Clock, now: number, options: ScopeOptions = {}) {
  const { damagedGiveUp } = { ...DEFAULTS, ...options };
  const listing = await transport.read(scope, Object.keys(state.files));
  const changed = new Set<string>();
  const leader = authority(state);
  const parsed: { id: string; file: SyncFile }[] = [];
  const bad = (id: string) => {
    state.damaged[id] = Math.min(state.damaged[id] ?? now, now);
    if (now - state.damaged[id]! > damagedGiveUp) {
      state.files[id] = { d: "", k: "bad", at: now };
      delete state.damaged[id];
    }
  };
  for (const { id, payload } of listing.files) {
    try {
      const file = JSON.parse(payload) as SyncFile;
      if (file.v !== 1 || (file.kind !== "log" && file.kind !== "snapshot")) throw new Error("unknown file");
      parsed.push({ id, file });
    } catch {
      bad(id);
    }
  }
  for (const { id } of listing.damaged) bad(id);
  parsed.sort((a, b) => (a.file.kind === b.file.kind ? 0 : a.file.kind === "snapshot" ? -1 : 1));
  for (const { id, file } of parsed) {
    if (file.kind === "snapshot") {
      ingestSnapshot(state, file, clock, changed);
      state.files[id] = { d: file.device, k: "snapshot", vv: file.vv, at: file.at };
    } else {
      ingestLog(state, file, clock, changed);
      state.files[id] = { d: file.device, k: "log", s: file.seq, at: file.at };
    }
    delete state.damaged[id];
  }
  if (authority(state) !== leader) purgeLosing(state, changed);
  const present = new Set(listing.present);
  for (const id of Object.keys(state.files)) if (!present.has(id)) delete state.files[id];
  for (const id of Object.keys(state.damaged)) if (!present.has(id)) delete state.damaged[id];
  state.pending = listing.pending.length;
  const pendingSince: Record<string, number> = {};
  for (const id of listing.pending) pendingSince[id] = Math.min(state.pendingSince?.[id] ?? now, now);
  if (listing.pending.length) state.pendingSince = pendingSince;
  else delete state.pendingSince;
  const downloading = Object.values(pendingSince).some((at) => now - at <= damagedGiveUp);
  waitingAfterPull.set(state, downloading || Object.keys(state.damaged).length > 0);
  unreadAfterPull.set(state, listing.pending.length + Object.keys(state.damaged).length + Object.values(state.files).filter((f) => f.k === "bad").length);
  return changed;
}

async function applyAdapter(state: ScopeState, adapter: Adapter, keys: Set<string>, now: number, horizon: number, adopting = false): Promise<boolean> {
  const mine = new Set([...keys].filter((k) => k.startsWith(adapter.prefix)));
  if (!mine.size && !adopting) return true;
  const view = visible(state, adapter.prefix);
  if (adopting) for (const key of [...view.keys(), ...Object.keys(state.base), ...(state.revoked ?? [])]) if (key.startsWith(adapter.prefix)) mine.add(key);
  const applyAs = (state.applyAs ??= {});
  if (adopting) applyAs[adapter.prefix] = "joining";
  else applyAs[adapter.prefix] ??= state.joined ? "joined" : "joining";
  let ok: boolean | void = false;
  try {
    ok = await adapter.apply(view, mine, (key) => parseBase(state.base[key]), { known: (key) => key in state.records, now, horizon, joined: applyAs[adapter.prefix] === "joined" });
  } catch (error) {
    console.warn(`[sync] applying ${adapter.prefix} failed`, error);
  }
  if (ok === false) return false;
  applyAs[adapter.prefix] = "joined";
  if (adopting) clearRevoked(state, adapter.prefix);
  for (const key of mine) {
    if (view.has(key)) state.base[key] = canonical(view.get(key));
    else delete state.base[key];
  }
  return true;
}

export async function compact(state: ScopeState, transport: Transport, scope: string, device: string, now: number, options: ScopeOptions = {}, force = false) {
  const o = { ...DEFAULTS, ...options };
  const count = Object.keys(state.files).length;
  const newestSnapshot = Math.max(state.snapshotAt, ...Object.values(state.files).filter((f) => f.k === "snapshot").map((f) => f.at));
  if (!force && (count <= o.compactAfterFiles || now - newestSnapshot < o.compactInterval)) return false;
  await flush(state, transport, scope, device, now, options);
  const records: Record<string, SyncRecord> = {};
  const tombstoneTTL = Object.keys(state.extra).length ? 2 * o.tombstoneTTL : o.tombstoneTTL;
  for (const [key, record] of Object.entries(state.records)) {
    const drop = record.v === null ? now - hlcWall(record.h) > tombstoneTTL : o.expired(key, record.v, now);
    if (drop) delete state.records[key];
    else records[key] = record;
  }
  const vv = { ...state.vv };
  const file: SnapshotFile = { v: 1, kind: "snapshot", device, at: now, vv, seen: { ...state.seen }, records };
  const id = await transport.write(scope, JSON.stringify(file));
  state.files[id] = { d: device, k: "snapshot", vv, at: now };
  state.snapshotAt = now;
  const dominated = (other: Record<string, number>) => Object.entries(other).every(([d, s]) => (vv[d] ?? 0) >= s);
  const prune = Object.entries(state.files)
    .filter(([fileId, f]) => {
      if (fileId === id || now - f.at < o.pruneGrace) return false;
      if (f.k === "log") return covered(vv, [f.d, f.s ?? Infinity]);
      if (f.k === "snapshot") return dominated(f.vv ?? {});
      return false;
    })
    .map(([fileId]) => fileId);
  if (prune.length) {
    await transport.remove(scope, prune);
    for (const fileId of prune) delete state.files[fileId];
  }
  return true;
}

export type CycleResult = { published: number; changed: number; pending: number; compacted: boolean; adopted: number };

const declaredPrefixes = (value: unknown): string[] | null => {
  const prefixes = (value as { p?: unknown } | null)?.p;
  return Array.isArray(prefixes) && prefixes.every((p) => typeof p === "string") ? (prefixes as string[]) : null;
};

const coveredRecord = (state: ScopeState, key: string) => {
  const record = state.records[key];
  return !!record && record.v !== null && covered(state.vv, record.o);
};

function seedState(state: ScopeState, leader: HLC, prefix: string): "seeded" | "absent" | "incomplete" {
  if (!coveredRecord(state, CLAIM + leader)) return "incomplete";
  if (coveredRecord(state, `${SEEDED}${leader}:${prefix}`)) return "seeded";
  const declared = declaredPrefixes(state.records[CLAIM + leader]!.v);
  return declared && !declared.includes(prefix) ? "absent" : "incomplete";
}

function claimScope(state: ScopeState, clock: Clock): HLC {
  const claim = clock.tick();
  state.claim = claim;
  noteClaim(state, claim);
  return claim;
}

function joinMode(state: ScopeState, adapter: Adapter, fenced: boolean): "free" | "hold" | "join" | "absent" {
  const leader = authority(state);
  if (!fenced || state.adopted?.[adapter.prefix]) return "free";
  if (leader === undefined) return state.awaitSeed ? "hold" : "free";
  if (leader === state.claim) return "free";
  if (unreadAfterPull.get(state) !== 0) return "hold";
  const seed = seedState(state, leader, adapter.prefix);
  return seed === "seeded" ? "join" : seed === "absent" ? "absent" : "hold";
}

function followAuthority(state: ScopeState) {
  const leader = authority(state);
  for (const [prefix, claim] of Object.entries(state.adopted ?? {})) if (claim !== leader) delete state.adopted![prefix];
  if (state.claim !== undefined && state.claim !== leader) delete state.seedDue;
}

function adoptApplied(state: ScopeState, fenced: Adapter[], clock: Clock, failed: Set<string>): number {
  if (!fenced.length || unreadAfterPull.get(state) !== 0) return 0;
  let adopted = 0;
  for (const { prefix } of fenced) {
    if (state.adopted?.[prefix] || failed.has(prefix) || state.unapplied.some((k) => k.startsWith(prefix))) continue;
    const leader = authority(state);
    if (leader === undefined ? state.awaitSeed : leader !== state.claim && seedState(state, leader, prefix) === "incomplete") continue;
    const claim = leader ?? claimScope(state, clock);
    (state.adopted ??= {})[prefix] = claim;
    if (claim === state.claim && !state.records[`${SEEDED}${claim}:${prefix}`]) (state.seedDue ??= {})[prefix] = true;
    adopted++;
  }
  return adopted;
}

function putSeedRecord(state: ScopeState, key: string, value: unknown, clock: Clock, device: string) {
  const h = clock.tick();
  state.records[key] = { h, v: value, o: [device, state.seq + 1] };
  state.outbox.push({ k: key, h, v: value });
}

function markSeeds(state: ScopeState, fenced: Adapter[], extracted: Set<string>, clock: Clock, device: string) {
  const claim = state.claim;
  if (claim === undefined || claim !== authority(state)) return;
  const declared = fenced.map((a) => a.prefix).sort();
  if (canonical(declared) !== canonical(declaredPrefixes(state.records[CLAIM + claim]?.v))) putSeedRecord(state, CLAIM + claim, { p: declared }, clock, device);
  for (const { prefix } of fenced) {
    const marker = `${SEEDED}${claim}:${prefix}`;
    if (!state.seedDue?.[prefix] || (!state.records[marker] && !extracted.has(prefix))) continue;
    if (!state.records[marker]) putSeedRecord(state, marker, { c: claim }, clock, device);
    delete state.seedDue[prefix];
  }
}

export async function syncScope(args: {
  scope: string;
  state: ScopeState;
  transport: Transport;
  adapters: Adapter[];
  clock: Clock;
  device: string;
  now?: () => number;
  options?: ScopeOptions;
}): Promise<CycleResult> {
  const { scope, state, transport, adapters, clock, device, options } = args;
  const now = args.now ?? Date.now;
  if (state.awaitRemote) state.awaitSeed = true;
  const isFenced = (adapter: Adapter) => !!(options?.adoptBeforePublish || adapter.adoptBeforePublish);
  const fenced = adapters.filter(isFenced);
  const publishable = (adapter: Adapter) => !isFenced(adapter) || !!state.adopted?.[adapter.prefix];
  const seedOf = (adapter: Adapter) => (state.seedDue?.[adapter.prefix] && state.claim === authority(state) ? state.claim : undefined);
  let published = 0;
  const extracted = new Set<string>();
  for (const adapter of adapters.filter(publishable)) {
    const batch = await publishAdapter(state, adapter, clock, device, now(), seedOf(adapter));
    if (!batch) continue;
    extracted.add(adapter.prefix);
    published += batch.size;
  }
  markSeeds(state, fenced, extracted, clock, device);
  await flush(state, transport, scope, device, now(), options);
  const changed = await pull(state, transport, scope, clock, now(), options);
  followAuthority(state);
  const keys = new Set([...state.unapplied, ...changed]);
  const unapplied: string[] = [];
  const failedJoins = new Set<string>();
  const extractedLate = new Set<string>();
  for (const adapter of adapters) {
    const late = publishable(adapter) ? await publishAdapter(state, adapter, clock, device, now(), seedOf(adapter)) : null;
    if (late) {
      extractedLate.add(adapter.prefix);
      published += late.size;
      for (const key of late) keys.delete(key);
    }
    const mine = [...keys].filter((k) => k.startsWith(adapter.prefix));
    const mode = joinMode(state, adapter, isFenced(adapter));
    if (mode === "hold") {
      unapplied.push(...mine);
      continue;
    }
    if (mode === "absent" && mine.length) (state.applyAs ??= {})[adapter.prefix] = "joining";
    if (await applyAdapter(state, adapter, keys, now(), 2 * (options?.tombstoneTTL ?? DEFAULTS.tombstoneTTL), mode === "join")) {
      if (mode === "absent") clearRevoked(state, adapter.prefix);
      continue;
    }
    unapplied.push(...mine);
    if (mode === "join") failedJoins.add(adapter.prefix);
  }
  markSeeds(state, fenced, extractedLate, clock, device);
  state.unapplied = [...unapplied, ...[...keys].filter((k) => !isSeedKey(k) && !adapters.some((a) => k.startsWith(a.prefix)))];
  const adopted = adoptApplied(state, fenced, clock, failedJoins);
  if (!state.awaitRemote || Object.keys(state.seen).some((d) => d !== device)) {
    state.joined = true;
    delete state.awaitRemote;
  }
  await flush(state, transport, scope, device, now(), options);
  const compacted = await compact(state, transport, scope, device, now(), options);
  return { published, changed: changed.size, pending: state.pending, compacted, adopted };
}
