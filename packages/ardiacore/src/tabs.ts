import type { TabGroupColor } from "@ardia/core";
import { call } from "./engine/call";

export type StripTab = {
  key: string | null;
  browser: number;
  index: number;
  active: boolean;
  pinned: boolean;
  group?: string | null;
};

export type StripGroup = {
  id: string;
  title: string;
  color: TabGroupColor;
  collapsed: boolean;
};

export type StripState = {
  strip: number;
  window: number;
  appWindow?: string;
  profile: string;
  tabs: StripTab[];
  activePickedOnClose?: boolean;
  groups?: StripGroup[];
  closed?: boolean;
};

export type TabStripTransaction = {
  rev: number;
  cmd: number | null;
  strips: StripState[];
  rejected?: boolean;
};

export type TabStripCommand =
  | { op: "activate"; strip: number; key: string }
  | { op: "arrange"; strip: number; keys: string[]; pinned: number }
  | {
      op: "group";
      strip: number;
      keys: string[];
      group: string | null;
      title?: string;
      color?: StripGroup["color"];
      collapsed?: boolean;
    };

let lastCommand = Math.floor(Math.random() * 1e6) * 1e3;

export function sendTabStripCommand(command: TabStripCommand): number {
  const id = ++lastCommand;
  void call("tabs.stripCommand", { id, command });
  return id;
}

export type LinkRoutingDestination = { kind: "little" } | { kind: "recent" } | { kind: "profile"; profileId: string };
export type LinkRoutingConfig = {
  rules: { match: "contains" | "equals"; text: string; destination: LinkRoutingDestination }[];
  defaultDestination: LinkRoutingDestination;
  profiles: Record<string, string>;
  recent: string;
};
export type LinkAction = "tab" | "little";
export type LinkDecision = { action: "none" } | { action: "same" | LinkAction; profileId: string; engine: string };
export type ExternalLink = { action: LinkAction; profileId: string; engine: string; adoptId?: string; requiresAdoption?: boolean } | { dismissed: true };
