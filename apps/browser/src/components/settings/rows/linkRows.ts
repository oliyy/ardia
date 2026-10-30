import type { SettingSection } from "./types";
import type { SettingsPane } from "../../../state/settings/settingsWindows";

export const linkRows = {
  links: [
    {
      section: "Air Traffic Control",
      rows: {
        routes: {
          title: "Routes",
          description: "A link that matches a route opens in its profile or in Little Ardia.",
          keywords: ["air traffic control", "atc", "route", "rules", "link preferences", "open link preferences", "spaces", "contains", "equal"],
        },
      },
    },
    {
      section: "Links from other apps",
      rows: {
        otherApps: { title: "Open links from other apps in", keywords: ["little ardia", "external links", "most recent", "default", "discord", "slack", "mail"] },
      },
    },
  ],
} satisfies Pick<Record<SettingsPane, SettingSection[]>, "links">;
