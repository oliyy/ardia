export const GLYPH = 13;

export const TOOLBAR_MOTION = { dim: 160, progress: 200, hide: 150, show: 200, settle: 0 } as const;

export const SIDEBAR_URL_TEXT = { light: "#00000099", dark: "#FFFFFF99" } as const;

export const SIDEBAR_FIELD_BUTTONS = { box: 24, radius: 6, fade: 150, siteControlsGlyph: 18, insecureIcon: 22, translateGap: 2, translateTrail: 1.5 } as const;

export const COPY_LINK = {
  glyph: 14,
  frame: 18,
  copiedFor: 1000,
  delay: 150,
  slide: -10,
  shrink: 0.01,
  linkSpring: { response: 0.3, damping: 0.6 },
  checkSpring: { response: 0.5, damping: 0.6 },
} as const;
