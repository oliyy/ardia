import type { BrowserWindow } from "./types";

const plainSwitches = new WeakSet<BrowserWindow>();

export function notePlainSpaceSwitch(window: BrowserWindow | undefined) {
  if (window) plainSwitches.add(window);
}

export const isPlainSpaceSwitch = (window: BrowserWindow | undefined) => !!window && plainSwitches.has(window);
