import { AccessibilityInfo } from "react-native";

let reduce: boolean | null = null;

export const reduceMotionKnown: Promise<boolean> = AccessibilityInfo.isReduceMotionEnabled().then(
  (on) => (reduce = on),
  () => (reduce = false),
);
const watchers = new Set<(on: boolean) => void>();

AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => {
  reduce = on;
  for (const changed of [...watchers]) changed(on);
});

export const reduceMotion = () => reduce;

export function watchReduceMotion(changed: (on: boolean) => void): () => void {
  watchers.add(changed);
  return () => void watchers.delete(changed);
}
