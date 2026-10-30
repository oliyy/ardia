import { useEffect, useState, useSyncExternalStore } from "react";
import { switchOn } from "../../platform/killSwitches";

const prewarmListeners = new Set<() => void>();
const notifyPrewarm = () => prewarmListeners.forEach((listener) => listener());
const subscribePrewarm = (listener: () => void) => {
  prewarmListeners.add(listener);
  return () => void prewarmListeners.delete(listener);
};

const PREWARM_AFTER_LAUNCH_MS = 1500;
let launchSettled = false;
const settleLaunch = (settled: boolean) => {
  launchSettled = settled;
  notifyPrewarm();
};
setTimeout(() => settleLaunch(true), PREWARM_AFTER_LAUNCH_MS);
export const prewarmAllowed = () => launchSettled;
export const setLaunchSettledForTests = (settled: boolean) => settleLaunch(settled);

const PREWARM_DELAY_MS = 120;
let prewarmOn = true;
export const setNewTabPrewarm = (on: boolean) => {
  prewarmOn = on;
  notifyPrewarm();
};
export const newTabPrewarmOn = () => prewarmOn && prewarmAllowed() && switchOn("newTabPrewarm");
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
