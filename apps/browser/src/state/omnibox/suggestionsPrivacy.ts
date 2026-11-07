import { revealSetting } from "../settings/searchState";
import { openSettings } from "../settings/settingsWindows";

export function openSuggestionSettings() {
  openSettings("search");
  revealSetting({ id: "search.suggestions", pane: "search", section: "Suggestions" });
}
