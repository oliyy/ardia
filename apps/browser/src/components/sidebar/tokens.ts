import { Easing } from "react-native";
import { colorHexAlpha } from "../../lib/profileLook";
import { useTheme } from "../ui/theme";
import { colorRoles, ink, shadow, withAlpha, type ShadowLevel } from "../ui/tokens";
import { curve } from "../ui/motion";
import type { GroupColor } from "../../state/browser/types";
import { GROUP_COLORS } from "../../state/groups/tokens";
import { useAddressBarInSidebar } from "../../state/windows/layout";

const DARK = {
  fieldFill: "rgba(255,255,255,0.1)",
  selectedFill: "rgba(255,255,255,0.2)",
  favoriteActiveFill: "rgba(255,255,255,0.47)",
  favoriteActiveRim: ["rgba(255,255,255,0.72)", "rgba(255,255,255,0.65)"] as [string, string],
  spaceDivider: "rgba(255,255,255,0.05)",
  groupFill: "rgba(255,255,255,0.1)",
  groupFillEmphasized: "rgba(255,255,255,0.12)",
  groupHeaderHover: "rgba(255,255,255,0.12)",
  groupStroke: "rgba(255,255,255,0.1)",
  groupTitle: "#FFFFFF",
  countPill: "rgba(255,255,255,0.15)",
  multiSelected: "rgba(255,255,255,0.1)",
  multiSelectedStroke: "rgba(255,255,255,0.14)",
  dragBorder: "rgba(255,255,255,0.33)",
  dragSilhouette: "#0F0F14",
  switcherFocus: "rgba(255,255,255,0.3)",
  switcherOutline: "rgba(255,255,255,0.15)",
  pickerCellHover: "rgba(255,255,255,0.25)",
  badge: "rgba(255,255,255,0.9)",
  upsellButton: "rgba(255,255,255,0.08)",
  upsellButtonHover: "rgba(255,255,255,0.11)",
  newTabLabel: "#FFFFFF8C",
  newTabIcon: "#FFFFFF40",
  noGroupIcon: "#FFFFFF40",
  folderDropFill: "rgba(255,255,255,0.08)",
  folderMosaic: "rgba(255,255,255,0.1)",
  liveDotRing: "rgba(0,0,0,0.3)",
  engineMarkPlate: "#2C2C2E",
  incognitoBadge: "rgba(255,255,255,0.08)",
  tileGlow: "#FFFFFF",
  fieldButtonPlate: "rgba(255,255,255,0.08)",
};

const LIGHT: typeof DARK = {
  fieldFill: "rgba(0,0,0,0.05)",
  selectedFill: "rgba(255,255,255,0.7)",
  favoriteActiveFill: "rgba(255,255,255,0.7)",
  favoriteActiveRim: ["rgba(255,255,255,0)", "rgba(255,255,255,0)"],
  spaceDivider: "rgba(0,0,0,0.05)",
  groupFill: "rgba(0,0,0,0.05)",
  groupFillEmphasized: "rgba(0,0,0,0.07)",
  groupHeaderHover: "rgba(255,255,255,0.4)",
  groupStroke: "rgba(0,0,0,0.1)",
  groupTitle: "#000000D9",
  countPill: "rgba(0,0,0,0.15)",
  multiSelected: "rgba(0,0,0,0.1)",
  multiSelectedStroke: "rgba(0,0,0,0.08)",
  dragBorder: "rgba(0,0,0,0.28)",
  dragSilhouette: "#FFFFFF",
  switcherFocus: "rgba(0,0,0,0.18)",
  switcherOutline: "rgba(0,0,0,0.1)",
  pickerCellHover: "rgba(134,136,141,0.25)",
  badge: "rgba(0,0,0,0.75)",
  upsellButton: "rgba(0,0,0,0.08)",
  upsellButtonHover: "rgba(0,0,0,0.11)",
  newTabLabel: "#00000080",
  newTabIcon: "#00000042",
  noGroupIcon: "#00000040",
  folderDropFill: "rgba(0,0,0,0.05)",
  folderMosaic: "rgba(0,0,0,0.06)",
  liveDotRing: "rgba(0,0,0,0.1)",
  engineMarkPlate: "#FFFFFF",
  incognitoBadge: "rgba(0,0,0,0.06)",
  tileGlow: "#000000",
  fieldButtonPlate: "rgba(255,255,255,0.75)",
};

type SidebarTokens = typeof DARK;

export function useSidebarTokens(): SidebarTokens {
  return useTheme().dark ? DARK : LIGHT;
}

export const ARC_DARK_LABEL = "#FFFFFFD3";
export const ARC_DARK_SELECTED_LABEL = "#FFFFFFCC";
export const ARC_SELECTED_INACTIVE = 0.525;

export function useArcLabel(): string | null {
  const dark = useTheme().dark;
  const flat = useAddressBarInSidebar();
  return flat && dark ? ARC_DARK_LABEL : null;
}

export const arcSelectedLabel = (arcLabel: string | null) => (arcLabel ? ARC_DARK_SELECTED_LABEL : null);

export function useArcTitle(): string | null {
  const theme = useTheme();
  const supplied = useAddressBarInSidebar() ? theme.custom?.favoriteMutedColor : undefined;
  return supplied ? colorHexAlpha(theme.dark ? supplied.dark : supplied.light) : null;
}

export function sidebarTokens(theme: { dark: boolean }): SidebarTokens {
  return theme.dark ? DARK : LIGHT;
}

const panelShadow = (share: number) => ({ dark: colorRoles.dark.panelShadowOpacity * share, light: colorRoles.light.panelShadowOpacity * share });

export const SIDEBAR_SHADOW = {
  dragGhost: { color: ink.black, opacity: { dark: 0.45, light: 0.18 }, radius: 10, offset: [0, 4] },
  card: { color: ink.black, opacity: panelShadow(0.8), radius: 16, offset: [0, 6] },
  iconPicker: { color: ink.black, opacity: panelShadow(1), radius: 20, offset: [0, 8] },
  searchTabs: shadow.dialog,
  tabSwitcher: { color: ink.black, opacity: panelShadow(1), radius: 35, offset: [0, 15] },
} satisfies Record<string, ShadowLevel>;

export const SELECTED_ROW_SHADOW_OFFSET: [number, number] = [0, 0.5];

export const TILE_GLOW = { opacity: { dark: 0.15, light: 0.12 }, radius: 1.5, offset: [0, 0.5] as [number, number] };

export const SIDEBAR_MOTION = { liveFold: 360, fold: 150, listSlide: 140, listFade: 100, hoverCardFade: 100 } as const;

export const TABULAR_NUMS: ("tabular-nums")[] = ["tabular-nums"];

export const SIDEBAR_TYPE = { divider: 10, count: 10, cardAction: 10.5, compact: 12.5, searchField: 16, emoji: 18 } as const;

export function groupTint(color: GroupColor | null | undefined): string | null {
  return color && color !== "none" ? (GROUP_COLORS[color]?.hex ?? null) : null;
}

export function groupSurface(color: GroupColor | null | undefined, tokens: SidebarTokens): { fill: string; stroke: string } {
  if (color === "none") return { fill: "transparent", stroke: "transparent" };
  const tint = groupTint(color);
  return tint ? { fill: withAlpha(tint, 0.16), stroke: withAlpha(tint, 0.3) } : { fill: tokens.groupFill, stroke: tokens.groupStroke };
}

export const RESET_HINT_FADE = { duration: 100, easing: Easing.bezier(0.42, 0, 0.58, 1) } as const;
export const TILE_HOVER_FADE = { duration: 120, easing: Easing.bezier(0.25, 0.1, 0.25, 1) } as const;
export const DRAG_LIFTED_FILL = "rgba(255,255,255,0.15)";
export const SLIDE_MS = SIDEBAR_MOTION.listSlide;
export const SLIDE_EASING = curve.cssEase;
export const ADDRESS_HEADER_ICON = { dark: "#FFFFFF99", darkDisabled: "#FFFFFF40" } as const;
export const ADDRESS_PLACEHOLDER_TEXT = { light: "#0000004D", dark: "#FFFFFF4D" } as const;
export const ADDRESS_SEARCH_ICON = { rest: { light: "#00000066", dark: "#FFFFFF66" }, hover: { light: "#000000CC", dark: "#FFFFFFCC" } } as const;
export const SWITCHER_CARD_COLORS = { darkFill: "#1A1A1A", selectedUnder: { dark: "#404040", light: "#FFFFFF" }, previewEmpty: { dark: "rgba(255,255,255,0.06)", light: "rgba(0,0,0,0.05)" } } as const;
export const SIDEBAR_FOOTER_TINT = "#FFFFFF99";
export const ARC_NEW_TAB = { size: 14, icon: "#FFFFFF80", label: "#FFFFFF76" } as const;
export const PLUS_MENU_INK = { body: "#000214", surface: "#192759", label: "#FFFFFF", shortcut: "#767880" } as const;
export const SPACE_HEADER_INK = { darkName: "#FFFFFF76", darkChevron: "#FFFFFF99", darkGlyph: "#FFFFFFF2", lightGlyph: "#000000C6" } as const;
