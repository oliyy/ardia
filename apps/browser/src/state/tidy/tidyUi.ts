import { create } from "zustand";
import { useBrowser } from "../browser/store";
import { isIncognitoProfile, plural } from "../browser/model";
import { showToast } from "../app/toasts";
import { openSettings } from "../settings/settingsWindows";
import { revealSetting } from "../settings/searchState";
import { tidyKey } from "./tidyKey";
import { requestTidy, TidyError } from "./tidyRequest";
import { tidyInput, tidyingTabs, TIDY_MIN_TABS, untidyingTabs, type TidiedTabs } from "./tidyTabs";

export const useTidyRunning = create<{ profiles: Record<string, true> }>()(() => ({ profiles: {} }));

const setRunning = (profileId: string, running: boolean) =>
  useTidyRunning.setState((s) => {
    const { [profileId]: _, ...rest } = s.profiles;
    return { profiles: running ? { ...rest, [profileId]: true } : rest };
  });

export function openTidyKeySetting() {
  openSettings("tabs");
  revealSetting({ id: "tabs.openRouterKey", pane: "tabs", section: "Tidy" });
}

const keyAction = { title: "Open Settings", run: openTidyKeySetting };

function showFailure(windowId: string, e: unknown) {
  const kind = e instanceof TidyError ? e.kind : "badReply";
  const icon = "sparkles";
  if (kind === "auth") return showToast(windowId, "OpenRouter Didn't Accept Your Key", undefined, { icon, action: keyAction });
  if (kind === "timeout") return showToast(windowId, "Tidy Timed Out", "Nothing was moved.", { icon });
  if (kind === "network") return showToast(windowId, "Couldn't Reach OpenRouter", "Nothing was moved.", { icon });
  if (kind === "http") return showToast(windowId, "Tidy Failed", `OpenRouter answered ${(e as TidyError).message}. Nothing was moved.`, { icon });
  showToast(windowId, "Tidy Failed", "OpenRouter's answer wasn't usable. Nothing was moved.", { icon });
}

export async function tidyTabs(windowId: string, profileId?: string) {
  const profile = profileId ?? useBrowser.getState().windows[windowId]?.profileId;
  if (!profile || isIncognitoProfile(profile) || useTidyRunning.getState().profiles[profile]) return;
  const input = tidyInput(useBrowser.getState(), windowId, profile);
  if (!input) return showToast(windowId, "Nothing to Tidy", `Tidy sorts ${TIDY_MIN_TABS} or more tabs into folders.`, { icon: "sparkles" });
  setRunning(profile, true);
  try {
    const key = await tidyKey();
    if (!key) return showToast(windowId, "Tidy Needs an OpenRouter Key", "Add yours in Settings › Tabs.", { icon: "sparkles", action: keyAction });
    const reply = await requestTidy(key, input);
    let tidied: TidiedTabs | null = null;
    useBrowser.setState((s) => {
      const [next, done] = tidyingTabs(s, input, reply);
      tidied = done;
      return next;
    });
    const done = tidied as TidiedTabs | null;
    if (!done) return showToast(windowId, "Your Tabs Are Already Tidy", undefined, { icon: "sparkles" });
    showToast(windowId, `Tidied ${plural(done.tabs, "Tab")} into ${plural(done.folders, "Folder")}`, undefined, {
      icon: "sparkles",
      action: { title: "Undo", run: () => useBrowser.setState((s) => untidyingTabs(s, done)) },
    });
  } catch (e) {
    showFailure(windowId, e);
  } finally {
    setRunning(profile, false);
  }
}
