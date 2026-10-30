import { requireNativeViewManager } from "expo-modules-core";
import { forwardRef } from "react";
import type { ViewProps } from "react-native";
import { nativeModule } from "./nativeModules";
import { useNativePropsRef, type NativePropsRef, type NativeViewInstance } from "./nativeProps";

export type WindowProfileProps = ViewProps & {
  profile: string;
  selection?: string;
  neighbours: string[];
};
export const WindowProfile = requireNativeViewManager<WindowProfileProps>("ArdiaWindowProfile");

export const WindowDragRegion = requireNativeViewManager<
  ViewProps & { titleBarDoubleClick?: boolean; onRegionDoubleClick?: () => void; clickable?: boolean; onRegionClick?: () => void }
>("ArdiaAppWindows");

export const ExtensionPopupWindow = requireNativeViewManager<ViewProps & { shown: boolean; dark: boolean; title?: string; onClose?: () => void }>(
  "ArdiaExtensionPopupWindow",
);

export const OutsidePressArea = requireNativeViewManager<ViewProps & { onOutsidePress?: (event: { nativeEvent: { timestamp?: number } }) => void }>("ArdiaOutsidePressArea");

export type SymbolProps = ViewProps & {
  name: string;
  size?: number;
  weight?: "light" | "regular" | "medium" | "semibold" | "bold";
  color?: string;
};

export const Symbol = requireNativeViewManager<SymbolProps>("ArdiaSymbol");

export type FolderShapeProps = ViewProps & {
  front: string;
  frontExtendedSRGB?: [number, number, number];
  back: string;
  stroke: string;
  open?: boolean;
  mark?: { kind: "dots" } | { kind: "symbol"; name: string } | { kind: "image"; uri: string } | { kind: "emoji"; text: string } | null;
};

export const FolderShape = requireNativeViewManager<FolderShapeProps>("ArdiaFolderShape");

export type ArcFavoriteBackgroundProps = ViewProps & {
  source?: { uri: string; profileId: string } | null;
  cornerRadius?: number;
  hovered?: boolean;
  logicalWidth?: number;
  dark?: boolean;
  mutedColor?: string | null;
};

const NativeArcFavoriteBackground = requireNativeViewManager<ArcFavoriteBackgroundProps & { ref?: NativePropsRef }>("ArdiaArcFavoriteBackground");

export const ArcFavoriteBackground = forwardRef<NativeViewInstance, ArcFavoriteBackgroundProps>(function ArcFavoriteBackground(props, ref) {
  const attach = useNativePropsRef(ref);
  return <NativeArcFavoriteBackground {...props} ref={attach} />;
});

export type ArcTabRowBackgroundProps = ViewProps & {
  dark: boolean;
  current?: boolean;
  contentVisible?: boolean;
  multiSelected?: boolean;
  hovered?: boolean;
  canReset?: boolean;
  iconMinX?: number;
  iconWidth?: number;
  regionHovered?: boolean;
  regionPressed?: boolean;
  onSeparateKey?: (event: { nativeEvent: { held: boolean } }) => void;
};

export const ArcTabRowBackground = requireNativeViewManager<ArcTabRowBackgroundProps>("ArdiaTabRowBackground");

export type ArcUrlFieldBackgroundProps = ViewProps & {
  dark: boolean;
  hovered?: boolean;
};

export const ArcUrlFieldBackground = requireNativeViewManager<ArcUrlFieldBackgroundProps>("ArdiaUrlFieldBackground");

export type ArcUrlFieldTextProps = ViewProps & {
  text: string;
  placeholder?: string;
  alignment?: "leading" | "trailing";
  color: string;
  hoverButtonsWidth?: number;
};

export const ArcUrlFieldText = requireNativeViewManager<ArcUrlFieldTextProps>("ArdiaUrlFieldText");

export type ArcUrlInsecureIconProps = ViewProps & {
  dark?: boolean;
  hovered?: boolean;
};

export const ArcUrlInsecureIcon = requireNativeViewManager<ArcUrlInsecureIconProps>("ArdiaUrlInsecureIcon");

export type FadeLabelProps = ViewProps & {
  text: string;
  fontSize?: number;
  weight?: "light" | "regular" | "medium" | "semibold" | "bold";
  color?: string;
  fadeWidth?: number;
  letterSpacing?: number;
  glyphs?: FadeLabelGlyph[];
  transitions?: boolean;
};

export type FadeLabelGlyph = { image: string; color?: string; label?: string };

export const FadeLabel = requireNativeViewManager<FadeLabelProps>("ArdiaFadeLabel");

export type ActivitySpinnerProps = ViewProps & {
  visible?: boolean;
  color?: string;
  period?: number;
};

export const ActivitySpinner = requireNativeViewManager<ActivitySpinnerProps>("ArdiaActivitySpinner");

export type PulseDotProps = ViewProps & {
  color: string;
  pulsing?: boolean;
};

export const PulseDot = requireNativeViewManager<PulseDotProps>("ArdiaPulseDot");

export type ContextMenuAreaProps = ViewProps & {
  onContextMenu?: () => void;
  captureDescendants?: boolean;
};

const NativeContextMenuArea = requireNativeViewManager<Omit<ContextMenuAreaProps, "onContextMenu"> & { onContextMenu?: () => void }>(
  "ArdiaContextMenuArea",
);

export function ContextMenuArea(props: ContextMenuAreaProps) {
  return <NativeContextMenuArea {...props} />;
}

export type SurfaceProps = ViewProps & {
  fill?: string;
  cornerRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  borderColors?: string[];
  shadowColor?: string;
  shadowOpacity?: number;
  shadowRadius?: number;
  shadowOffset?: [number, number];
  cutout?: [number, number, number];
  inactiveOpacity?: number;
  inactiveFillOpacity?: number;
  inactiveBorderColors?: string[];
  hidesAccessibility?: boolean;
  logicalWidth?: number;
  refreshRasterOnRest?: boolean;
  fadeMask?: SurfaceFadeMask | null;
};

export type SurfaceFadeMask = {
  edgeInset: number;
  edgeShare: number;
  rampShare: number;
  baseInset: number;
  times: number[];
  offsetShares: number[];
  fades: number[];
  token: number;
};

type NativeSurfaceProps = Omit<SurfaceProps, "shadowColor" | "shadowOpacity" | "shadowRadius" | "shadowOffset"> & {
  surfaceShadowColor?: string;
  surfaceShadowOpacity?: number;
  surfaceShadowRadius?: number;
  surfaceShadowOffset?: [number, number];
  ref?: NativePropsRef;
};

const NativeSurface = requireNativeViewManager<NativeSurfaceProps>("ArdiaSurface");

const SURFACE_SHADOW_PROPS = new Map([
  ["shadowColor", "surfaceShadowColor"],
  ["shadowOpacity", "surfaceShadowOpacity"],
  ["shadowRadius", "surfaceShadowRadius"],
  ["shadowOffset", "surfaceShadowOffset"],
]);

const surfaceNativeProps = (props: Record<string, unknown>) =>
  Object.keys(props).some((key) => SURFACE_SHADOW_PROPS.has(key))
    ? Object.fromEntries(Object.entries(props).map(([key, value]) => [SURFACE_SHADOW_PROPS.get(key) ?? key, value]))
    : props;

export const Surface = forwardRef<NativeViewInstance, SurfaceProps>(function Surface({ shadowColor, shadowOpacity, shadowRadius, shadowOffset, ...props }, ref) {
  const attach = useNativePropsRef(ref, surfaceNativeProps);
  return (
    <NativeSurface
      {...props}
      ref={attach}
      surfaceShadowColor={shadowColor}
      surfaceShadowOpacity={shadowOpacity}
      surfaceShadowRadius={shadowRadius}
      surfaceShadowOffset={shadowOffset}
    />
  );
});

export type VisualEffectProps = ViewProps & {
  material?: string;
  blendingMode?: "withinWindow" | "behindWindow";
  cornerRadius?: number;
};

export const VisualEffect = requireNativeViewManager<VisualEffectProps>("ArdiaVisualEffect");

export type GlassEffectProps = ViewProps & {
  cornerRadius?: number;
  tint?: string;
  glassStyle?: "regular" | "clear";
  dark?: boolean;
};

export type GlassEffectNative = { isLiquidGlass(): boolean };

const GlassEffectModule = nativeModule("ArdiaGlassEffect");

export const isLiquidGlass = (): boolean => GlassEffectModule.isLiquidGlass();

export const GlassEffect = requireNativeViewManager<GlassEffectProps>("ArdiaGlassEffect");

export type PopoverBubbleProps = ViewProps & {
  material?: "popover" | "menu" | "hudWindow" | "sheet" | "toolTip";
  dark?: boolean;
  cornerRadius?: number;
  arrowEdge?: "top" | "bottom" | "none";
  arrowX?: number;
  arrowWidth?: number;
  arrowHeight?: number;
  tint?: string;
  edgeColor?: string;
  edgeWidth?: number;
  shadowOpacity?: number;
  shadowRadius?: number;
  shadowOffsetY?: number;
  glass?: boolean;
};

type NativePopoverBubbleProps = Omit<PopoverBubbleProps, "shadowOpacity" | "shadowRadius" | "shadowOffsetY"> & {
  bubbleShadowOpacity?: number;
  bubbleShadowRadius?: number;
  bubbleShadowOffsetY?: number;
};

const NativePopoverBubble = requireNativeViewManager<NativePopoverBubbleProps>("ArdiaPopoverBubble");

export function PopoverBubble({ shadowOpacity, shadowRadius, shadowOffsetY, ...props }: PopoverBubbleProps) {
  return <NativePopoverBubble {...props} bubbleShadowOpacity={shadowOpacity} bubbleShadowRadius={shadowRadius} bubbleShadowOffsetY={shadowOffsetY} />;
}

export type IconTheme = { kind: "blur" } | { kind: "template"; fill: string; stroke?: string };

export type DockSelectionNative = {
  iconTheme(uri: string | null, emoji: string | null): Promise<IconTheme | null>;
};

const DockSelectionModule = nativeModule("ArdiaDockSelection");

export const iconTheme = (source: { uri: string } | { emoji: string }): Promise<IconTheme | null> =>
  DockSelectionModule.iconTheme("uri" in source ? source.uri : null, "emoji" in source ? source.emoji : null);

export type DockSelectionProps = ViewProps & {
  image?: string;
  emoji?: string;
  theme?: IconTheme["kind"];
  fill?: string;
  stroke?: string;
  cornerRadius?: number;
  strokeWidth?: number;
  iconSize?: number;
  dark: boolean;
  glass?: boolean;
  colorRing?: boolean;
};

const NativeDockSelection = requireNativeViewManager<DockSelectionProps & { ref?: NativePropsRef }>("ArdiaDockSelection");

export const DockSelection = forwardRef<NativeViewInstance, DockSelectionProps>(function DockSelection(props, ref) {
  const attach = useNativePropsRef(ref);
  return <NativeDockSelection {...props} ref={attach} />;
});
