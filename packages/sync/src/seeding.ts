import { canonical } from "./canon.ts";
import { pullSettled } from "./fileHealth.ts";
import type { Clock, HLC } from "./hlc.ts";
import { covered, type Adapter, type Op, type Origin, type ScopeOptions, type ScopeState, type SyncRecord } from "./scopeState.ts";

const CLAIM = "seeding:";
const SEEDED = "seeded:";
export const isSeedKey = (key: string) => key.startsWith(CLAIM) || key.startsWith(SEEDED);
export const authority = (state: ScopeState): HLC | undefined => state.claims?.[0];
export const losing = (state: ScopeState, record: SyncRecord) => record.s !== undefined && record.s !== authority(state);
const rank = (state: ScopeState, record: SyncRecord) => (record.s === undefined ? 2 : losing(state, record) ? 0 : 1);

export function outranks(state: ScopeState, incoming: SyncRecord, current: SyncRecord) {
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

export function noteClaims(state: ScopeState, key: string, record: SyncRecord) {
  if (record.s !== undefined) noteClaim(state, record.s);
  if (key.startsWith(CLAIM)) noteClaim(state, key.slice(CLAIM.length));
}

export function restoreClaim(state: ScopeState, op: Op) {
  if (op.s !== undefined) state.claim ??= op.s;
  if (op.k.startsWith(CLAIM)) state.claim ??= op.k.slice(CLAIM.length);
}

export function revokedOnRestore(state: ScopeState, key: string, record: SyncRecord) {
  if (!losing(state, record)) return false;
  if (record.s === state.claim) revoke(state, key);
  return true;
}

export function clearRevoked(state: ScopeState, prefix: string) {
  const left = state.revoked?.filter((k) => !k.startsWith(prefix)) ?? [];
  if (left.length) state.revoked = left;
  else delete state.revoked;
}

export function purgeLosing(state: ScopeState, changed: Set<string>) {
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

export const opRecord = (op: Op, origin: Origin): SyncRecord => ({ h: op.h, v: op.v, o: origin, ...(op.s === undefined ? {} : { s: op.s }) });

export function fencing(state: ScopeState, adapters: Adapter[], options?: ScopeOptions) {
  const isFenced = (adapter: Adapter) => !!(options?.adoptBeforePublish || adapter.adoptBeforePublish);
  return {
    isFenced,
    fenced: adapters.filter(isFenced),
    publishable: (adapter: Adapter) => !isFenced(adapter) || !!state.adopted?.[adapter.prefix],
    seedOf: (adapter: Adapter) => (state.seedDue?.[adapter.prefix] && state.claim === authority(state) ? state.claim : undefined),
  };
}

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

export function joinMode(state: ScopeState, adapter: Adapter, fenced: boolean): "free" | "hold" | "join" | "absent" {
  const leader = authority(state);
  if (!fenced || state.adopted?.[adapter.prefix]) return "free";
  if (leader === undefined) return state.awaitSeed ? "hold" : "free";
  if (leader === state.claim) return "free";
  if (!pullSettled(state)) return "hold";
  const seed = seedState(state, leader, adapter.prefix);
  return seed === "seeded" ? "join" : seed === "absent" ? "absent" : "hold";
}

export function followAuthority(state: ScopeState) {
  const leader = authority(state);
  for (const [prefix, claim] of Object.entries(state.adopted ?? {})) if (claim !== leader) delete state.adopted![prefix];
  if (state.claim !== undefined && state.claim !== leader) delete state.seedDue;
}

export function adoptApplied(state: ScopeState, fenced: Adapter[], clock: Clock, failed: Set<string>): number {
  if (!fenced.length || !pullSettled(state)) return 0;
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

export function markSeeds(state: ScopeState, fenced: Adapter[], extracted: Set<string>, clock: Clock, device: string) {
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
