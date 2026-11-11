import { useBrowser } from "../browser/store";
import { lastActiveProfile } from "../windows/small";
import {
  newLinkRuleId,
  withDefaultDestination,
  withLinkRule,
  withLinkRuleChanged,
  withoutLinkRule,
  type LinkDestination,
  type LinkRouting,
  type LinkRule,
} from "./linkRouting";

const routing = () => useBrowser.getState().settings.linkRouting;
export const saveLinkRouting = (linkRouting: LinkRouting) => useBrowser.getState().updateSettings({ linkRouting });

export const setDefaultLinkDestination = (destination: LinkDestination) => saveLinkRouting(withDefaultDestination(routing(), destination));

export function addLinkRule() {
  const s = useBrowser.getState();
  saveLinkRouting(withLinkRule(s.settings.linkRouting, { id: newLinkRuleId(), match: "contains", text: "", destination: { kind: "profile", profileId: lastActiveProfile(s) } }));
}

export const changeLinkRule = (id: string, patch: Partial<Omit<LinkRule, "id">>) => saveLinkRouting(withLinkRuleChanged(routing(), id, patch));

export const removeLinkRule = (id: string) => saveLinkRouting(withoutLinkRule(routing(), id));
