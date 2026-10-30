import { useBrowser } from "../browser/store";
import { dismissOnboarding, finishOnboarding, useOnboarding } from "./onboarding";

let watching = false;

export function watchOnboardingWindow() {
  if (watching) return;
  watching = true;
  useBrowser.subscribe((s, prev) => {
    const { windowId, session } = useOnboarding.getState();
    if (s.windows === prev.windows || !windowId || s.windows[windowId]) return;
    finishOnboarding();
    dismissOnboarding(session);
  });
}
