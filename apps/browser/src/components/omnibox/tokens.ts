import { curve } from "../ui/motion";
import { font, radius, space, type ShadowLevel } from "../ui/tokens";

export const PANEL_TEXT_LEFT = 48;
const PANEL_ICON_LEFT = 21;
export const FIELD_TEXT_INSET = 2.5;
const ICON_SLOT = 18;

export const BAR_TYPE = {
  floatingField: font.title,
  panelField: font.body,
  goLabel: { fontSize: 15 },
  scope: { fontSize: 14 },
} as const;

export const BAR = {
  iconSlot: ICON_SLOT,
  leadingIcon: 15,
  panelFieldLift: -3,
  panel: {
    height: 55,
    iconLeft: PANEL_ICON_LEFT,
    right: 18,
    gap: PANEL_TEXT_LEFT - FIELD_TEXT_INSET - PANEL_ICON_LEFT - ICON_SLOT,
  },
  dropdown: { height: 44, left: 13, right: 9, gap: 9 },
  siteControls: { icon: 15, box: 26, radius: 13 },
  bottom: { left: 14, right: 13, height: 52, mic: 14 },
} as const;

export const ADD_CHIP = {
  height: 32,
  radius: 16,
  border: 1,
  left: 9,
  right: 12,
  gap: 5,
  glyph: 10,
  glyphBox: 14,
  otherTabs: 12,
} as const;

export const GO_BUTTON = {
  before: space.m,
  minWidth: 99,
  height: 32,
  padX: space.xl,
  radius: 16,
  hoverOpacity: 0.9,
  gap: space.s,
  glyph: 11,
  glyphBox: 14,
  glyphAlpha: "99",
} as const;

export const SCOPE_CHIP = {
  height: 26,
  radius: radius.l,
  left: 7,
  right: 9,
  gap: space.s,
  favicon: 14,
  maxWidth: 220,
} as const;

export const SUGGESTION = {
  listX: 8,
  dropdownListX: space.s,
  listBelow: space.xxs,
  dropdownListBelow: space.s,
  height: 36,
  gapY: 2,
  radius: 8,
  padX: 13,
  gap: 11,
  icon: 13,
  calcIcon: 14,
  iconBox: 16,
  remove: { glyph: 10, box: 22, radius: radius.m },
} as const;

export const SELECTED_SUGGESTION_ALPHA = { dark: 0.56, light: 0.3 } as const;

export const SUGGESTION_TEXT_SIZE = font.title.fontSize;

export const GROW = { duration: 130, easing: curve.outExpo } as const;

export const NEW_TAB_BAR = {
  widthShare: 0.364,
  maxWidth: 766,
  minWidth: 480,
  topShare: 0.348,
  windowMargin: 16,
  tallestRows: 8,
  radius: 12,
  fieldHeight: 63.5,
  iconCentre: 31.75,
  textLeft: 52,
  fieldRight: 22.5,
  fieldGap: 10,
  iconSlot: 24,
  fieldIcon: 12,
  faviconInField: 16,
  info: { box: 24, glyph: 14 },
  note: { below: 14, gap: 12, button: { height: 26, padX: 11, radius: 7 } },
  divider: { inset: 12 },
  list: { x: 10, above: 4, below: 9.5 },
  row: {
    height: 46,
    gapY: 2,
    radius: 6.5,
    iconLeft: 9.75,
    iconBox: 24,
    iconRadius: 6,
    favicon: 16,
    glyph: 13,
    textGap: 8,
    right: 13,
    accessoryGap: 7.5,
    arrow: { box: 24, radius: 4.5, glyph: 13 },
  },
  appear: { duration: 150, scale: 0.97, easing: curve.outCubic },
  selectedLift: 0.12,
} as const;

export const NEW_TAB_BAR_SHADOW: ShadowLevel = { color: "#000000", opacity: { dark: 0.5, light: 0.22 }, radius: 40, offset: [0, 14] };

export const NEW_TAB_BAR_TYPE = {
  field: { fontSize: 18, fontWeight: "500" },
  row: { fontSize: 13, fontWeight: "500" },
  url: { fontSize: 13, fontWeight: "400" },
  note: { fontSize: 13, fontWeight: "500" },
} as const;

export type NewTabBarColors = {
  tint: string;
  border: string;
  text: string;
  secondary: string;
  placeholder: string;
  hover: string;
  accessoryFill: string;
  accessoryInk: string;
  infoFill: string;
  selectedText: string;
  selectedUrl: string;
  selectedBox: string;
};

export const NEW_TAB_BAR_COLORS: { dark: NewTabBarColors; light: NewTabBarColors } = {
  dark: {
    tint: "rgba(20,22,24,0.88)",
    border: "rgba(250,251,255,0.2)",
    text: "rgba(255,255,255,0.8)",
    secondary: "rgba(255,255,255,0.33)",
    placeholder: "rgba(255,255,255,0.55)",
    hover: "rgba(255,255,255,0.05)",
    accessoryFill: "rgba(255,255,255,0.05)",
    accessoryInk: "rgba(255,255,255,0.66)",
    infoFill: "rgba(0,0,0,0.35)",
    selectedText: "#FFFFFF",
    selectedUrl: "rgba(255,255,255,0.6)",
    selectedBox: "#FFFFFF",
  },
  light: {
    tint: "rgba(250,251,255,0.88)",
    border: "rgba(14,15,16,0.1)",
    text: "rgba(0,0,0,0.8)",
    secondary: "rgba(0,0,0,0.33)",
    placeholder: "rgba(0,0,0,0.4)",
    hover: "rgba(0,0,0,0.05)",
    accessoryFill: "rgba(0,0,0,0.05)",
    accessoryInk: "rgba(0,0,0,0.5)",
    infoFill: "rgba(0,0,0,0.05)",
    selectedText: "#FFFFFF",
    selectedUrl: "rgba(255,255,255,0.7)",
    selectedBox: "#FFFFFF",
  },
};
