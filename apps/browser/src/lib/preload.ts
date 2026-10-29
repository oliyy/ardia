import { engineCall } from "@ardia/ardiacore";
import { useEffect, useState, useSyncExternalStore } from "react";
import { switchOn } from "./killSwitches";

let engine: "unknown" | "asking" | "yes" | "no" = "unknown";
const ENGINE_PROBE_DELAY_MS = 1500;
const prewarmListeners = new Set<() => void>();
const notifyPrewarm = () => prewarmListeners.forEach((listener) => listener());
const subscribePrewarm = (listener: () => void) => {
  prewarmListeners.add(listener);
  return () => void prewarmListeners.delete(listener);
};
const settleEngine = (answer: typeof engine) => {
  engine = answer;
  notifyPrewarm();
};
export const engineHasPrewarmFixes = () => engine === "yes";
function askEngine(tries = 5) {
  if (engine !== "unknown") return;
  engine = "asking";
  engineCall<{ prewarm?: number }>("ac_omnibox_opened", "", {}).then(
    (r) => settleEngine((r?.prewarm ?? 0) >= 2 ? "yes" : "no"),
    (e: unknown) => {
      if (/not an engine call|the engine has no/.test(String(e))) settleEngine("no");
      else {
        engine = "unknown";
        if (tries > 1) setTimeout(() => askEngine(tries - 1), ENGINE_PROBE_DELAY_MS);
      }
    },
  );
}
setTimeout(askEngine, ENGINE_PROBE_DELAY_MS);
export const setEngineForTests = (has: boolean) => settleEngine(has ? "yes" : "no");

const PREWARM_DELAY_MS = 120;
let prewarmOn = true;
export const setNewTabPrewarm = (on: boolean) => {
  prewarmOn = on;
  notifyPrewarm();
};
export const newTabPrewarmOn = () => prewarmOn && engineHasPrewarmFixes() && switchOn("newTabPrewarm");
export function usePrewarm(want: boolean, settled: boolean) {
  const [ready, setReady] = useState(false);
  const on = useSyncExternalStore(subscribePrewarm, newTabPrewarmOn);
  useEffect(() => {
    if (!want || !on) {
      setReady(false);
      return;
    }
    if (!settled) return;
    const timer = setTimeout(() => setReady(true), PREWARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [want, settled, on]);
  return want && on && ready;
}
