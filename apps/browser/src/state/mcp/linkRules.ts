import type { BrowserState } from "../browser/store";
import {
  LITTLE_DESTINATION,
  newLinkRuleId,
  RECENT_DESTINATION,
  withDefaultDestination,
  withLinkRule,
  withLinkRuleChanged,
  withLinkRuleMoved,
  withoutLinkRule,
  type LinkDestination,
  type LinkRouting,
  type LinkRule,
} from "../settings/linkRouting";
import { fail, resolveSpace } from "./spaces";
import type { Args } from "./writes";

export type RoutingChange = [LinkRouting, Record<string, unknown>];

const TEXT_LIMIT = 2048;
const MATCHES: readonly LinkRule["match"][] = ["contains", "equals"];

function onlyArgs(a: Args, keys: string[]) {
  const unknown = Object.keys(a).filter((k) => !keys.includes(k));
  if (unknown.length) fail(`Unknown argument ${unknown.join(", ")}; this tool takes ${keys.join(", ")}`);
}

function destinationOf(s: BrowserState, value: unknown, key: string): LinkDestination {
  if (typeof value !== "string" || !value.trim()) return fail(`${key} must be a space id or name from list_spaces, recent or little`);
  const word = value.trim().toLowerCase();
  if (word === "recent") return RECENT_DESTINATION;
  if (word === "little") return LITTLE_DESTINATION;
  return { kind: "profile", profileId: resolveSpace(s, value) };
}

function matchOf(value: unknown): LinkRule["match"] {
  if (typeof value === "string" && (MATCHES as readonly string[]).includes(value)) return value as LinkRule["match"];
  return fail("match must be contains or equals");
}

function textOf(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) fail("text must be the part of a URL to match, such as github.com");
  if (text.length > TEXT_LIMIT) fail(`text must be at most ${TEXT_LIMIT} characters`);
  return text;
}

function ruleIndex(routing: LinkRouting, id: unknown, key = "id"): number {
  if (typeof id !== "string" || !id) return fail(`${key} must be a rule id from list_link_rules`);
  const index = routing.rules.findIndex((r) => r.id === id);
  if (index < 0) fail(`No rule ${id}; list_link_rules names them`);
  return index;
}

function indexOf(value: unknown, last: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > last) return fail(`index must be a whole number from 0 to ${last}`);
  return value;
}

function destinationEntry(s: BrowserState, d: LinkDestination) {
  if (d.kind === "recent") return { destination: "recent", destinationName: "Most Recent Profile" };
  if (d.kind === "little") return { destination: "little", destinationName: "Little Ardia" };
  const profile = s.profiles[d.profileId];
  return profile ? { destination: d.profileId, destinationName: profile.name } : { destination: d.profileId, destinationName: null, missing: true };
}

const ruleEntry = (s: BrowserState, rule: LinkRule, index: number) => ({
  id: rule.id,
  index,
  match: rule.match,
  text: rule.text,
  ...destinationEntry(s, rule.destination),
  ...(rule.text.trim() ? {} : { blank: true }),
});

export function listLinkRules(s: BrowserState, routing: LinkRouting = s.settings.linkRouting) {
  return {
    rules: routing.rules.map((rule, i) => ruleEntry(s, rule, i)),
    default: destinationEntry(s, routing.defaultDestination),
  };
}

const withList = (s: BrowserState, routing: LinkRouting, result: Record<string, unknown>): RoutingChange => [routing, { ...result, ...listLinkRules(s, routing) }];

export function addLinkRule(s: BrowserState, a: Args): RoutingChange {
  onlyArgs(a, ["match", "text", "destination", "index"]);
  const routing = s.settings.linkRouting;
  const rule: LinkRule = { id: newLinkRuleId(), match: matchOf(a.match), text: textOf(a.text), destination: destinationOf(s, a.destination, "destination") };
  const index = a.index === undefined || a.index === null ? routing.rules.length : indexOf(a.index, routing.rules.length);
  return withList(s, withLinkRuleMoved(withLinkRule(routing, rule), rule.id, index), { added: rule.id });
}

export function updateLinkRule(s: BrowserState, a: Args): RoutingChange {
  onlyArgs(a, ["id", "match", "text", "destination"]);
  const routing = s.settings.linkRouting;
  const rule = routing.rules[ruleIndex(routing, a.id)]!;
  if (a.match === undefined && a.text === undefined && a.destination === undefined) fail("Give at least one of match, text or destination");
  const patch: Partial<Omit<LinkRule, "id">> = {
    ...(a.match !== undefined ? { match: matchOf(a.match) } : {}),
    ...(a.text !== undefined ? { text: textOf(a.text) } : {}),
    ...(a.destination !== undefined ? { destination: destinationOf(s, a.destination, "destination") } : {}),
  };
  return withList(s, withLinkRuleChanged(routing, rule.id, patch), { updated: rule.id });
}

export function moveLinkRule(s: BrowserState, a: Args): RoutingChange {
  onlyArgs(a, ["id", "index", "before", "after"]);
  const routing = s.settings.linkRouting;
  const from = ruleIndex(routing, a.id);
  const id = routing.rules[from]!.id;
  const given = (["index", "before", "after"] as const).filter((k) => a[k] !== undefined && a[k] !== null);
  if (given.length !== 1) fail("Give exactly one of index, before or after");
  const rest = routing.rules.filter((r) => r.id !== id);
  const anchor = (key: "before" | "after") => {
    if (a[key] === id) fail(`${key} must be another rule's id`);
    return rest.findIndex((r) => r.id === routing.rules[ruleIndex(routing, a[key], key)]!.id);
  };
  const index = given[0] === "index" ? indexOf(a.index, rest.length) : given[0] === "before" ? anchor("before") : anchor("after") + 1;
  return withList(s, withLinkRuleMoved(routing, id, index), { moved: id });
}

export function deleteLinkRule(s: BrowserState, a: Args): RoutingChange {
  onlyArgs(a, ["id"]);
  const routing = s.settings.linkRouting;
  const id = routing.rules[ruleIndex(routing, a.id)]!.id;
  return withList(s, withoutLinkRule(routing, id), { deleted: id });
}

export function setDefaultLinkDestination(s: BrowserState, a: Args): RoutingChange {
  onlyArgs(a, ["destination"]);
  return withList(s, withDefaultDestination(s.settings.linkRouting, destinationOf(s, a.destination, "destination")), {});
}
