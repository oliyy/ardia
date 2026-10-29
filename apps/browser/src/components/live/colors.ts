import { useTheme } from "../../lib/theme";

const DARK = {
  success: "#3FB950",
  failure: "#F85149",
  pending: "#D29922",
  merged: "#A371F7",
  draft: "#8B949E",
  conflict: "#DB6D28",
  pip: "#4C8DF6",
  now: "#E5534B",
  ciTrack: "rgba(255,255,255,0.1)",
  stateOpen: "#238636",
  stateDraft: "#6E7681",
  stateMerged: "#8957E5",
  stateClosed: "#DA3633",
  stateReviewed: "#1F6FEB",
};

const LIGHT: typeof DARK = {
  success: "#1A7F37",
  failure: "#CF222E",
  pending: "#9A6700",
  merged: "#8250DF",
  draft: "#6E7781",
  conflict: "#BC4C00",
  pip: "#0969DA",
  now: "#D1242F",
  ciTrack: "rgba(0,0,0,0.08)",
  stateOpen: "#1F883D",
  stateDraft: "#6E7781",
  stateMerged: "#8250DF",
  stateClosed: "#CF222E",
  stateReviewed: "#0969DA",
};

export type LiveColors = typeof DARK;

export function useLiveColors(): LiveColors {
  return useTheme().dark ? DARK : LIGHT;
}
