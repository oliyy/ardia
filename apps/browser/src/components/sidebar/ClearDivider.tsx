import { Symbol } from "@ardia/shell";
import { memo, useEffect, useMemo, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { markHoverProps } from "../../lib/hoverShift";
import { layout, useTheme } from "../../lib/theme";
import { useHover } from "../primitives";
import { closeAllTabs } from "./menus";
import { tidyPins } from "./tidyPinsUi";
import { useSidebarTokens } from "./tokens";

const CLEAR_DIVIDER_HEIGHT = 16;
const PADDING = 9;
const SPACE_DIVIDER_HEIGHT = 2;
const PINNED_DIVIDER = { inset: 18, height: 22, line: 0.5, top: 10.5 } as const;
const SPACED_GAP = 7;

export const dividerHeight = (spaced: boolean, flush: boolean) => (flush ? (spaced ? PINNED_DIVIDER.height : SPACE_DIVIDER_HEIGHT) : CLEAR_DIVIDER_HEIGHT + (spaced ? SPACED_GAP : 0));

const hoveredSidebars = new Set<string>();
const hoverListeners = new Set<() => void>();

function setSidebarHovered(windowId: string, hovered: boolean) {
  if (hovered === hoveredSidebars.has(windowId)) return;
  if (hovered) hoveredSidebars.add(windowId);
  else hoveredSidebars.delete(windowId);
  for (const listener of hoverListeners) listener();
}

const subscribeSidebarHover = (listener: () => void) => {
  hoverListeners.add(listener);
  return () => void hoverListeners.delete(listener);
};

export function useSidebarHoverProps(windowId: string) {
  const props = useMemo(() => markHoverProps({ onMouseEnter: () => setSidebarHovered(windowId, true), onMouseLeave: () => setSidebarHovered(windowId, false) }), [windowId]);
  useEffect(() => () => setSidebarHovered(windowId, false), [windowId]);
  return props;
}

const useSidebarHovered = (windowId: string) => useSyncExternalStore(subscribeSidebarHover, () => hoveredSidebars.has(windowId));

type DividerProps = { windowId: string; profileId: string; spaced: boolean; clear: boolean; tidy: boolean; flush?: boolean };

export const ClearDivider = memo(function ClearDivider({ windowId, profileId, spaced, clear, tidy, flush = false }: DividerProps) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const shown = useSidebarHovered(windowId);
  const buttons = (
    <View pointerEvents={shown ? "auto" : "none"} style={{ flexDirection: "row", alignItems: "center", opacity: shown ? 1 : 0 }}>
      {tidy ? <DividerButton title="Tidy" symbol="sparkles" iconWidth={10} label="Tidy pinned tabs" onPress={() => tidyPins(windowId, profileId)} /> : null}
      {tidy && clear ? <View style={{ width: 1, height: 9, marginLeft: 8, backgroundColor: theme.divider }} /> : null}
      {clear ? <DividerButton title="Clear" symbol="arrow.down" iconWidth={8} label="Clear unpinned tabs" onPress={() => closeAllTabs(windowId)} /> : null}
    </View>
  );
  if (flush && spaced) {
    return (
      <View style={{ height: PINNED_DIVIDER.height, marginHorizontal: PINNED_DIVIDER.inset - layout.sidebarInset }}>
        <View style={{ position: "absolute", left: 0, right: 0, top: PINNED_DIVIDER.top, height: PINNED_DIVIDER.line, backgroundColor: tokens.spaceDivider }} />
        <View style={{ position: "absolute", right: 0, top: PINNED_DIVIDER.top + PINNED_DIVIDER.line / 2 - CLEAR_DIVIDER_HEIGHT / 2 }}>{buttons}</View>
      </View>
    );
  }
  if (flush) {
    return (
      <View style={{ height: SPACE_DIVIDER_HEIGHT, marginHorizontal: -layout.sidebarInset }}>
        <View style={{ height: 1, backgroundColor: tokens.spaceDivider }} />
        <View style={{ position: "absolute", right: layout.sidebarInset + PADDING, top: (1 - CLEAR_DIVIDER_HEIGHT) / 2 }}>{buttons}</View>
      </View>
    );
  }
  return (
    <View style={{ height: CLEAR_DIVIDER_HEIGHT, marginTop: spaced ? SPACED_GAP : 0, flexDirection: "row", alignItems: "center", paddingLeft: PADDING, paddingRight: PADDING }}>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.divider }} />
      <View style={shown ? null : { position: "absolute", right: PADDING }}>{buttons}</View>
    </View>
  );
});

function DividerButton({ title, symbol, iconWidth, label, onPress }: { title: string; symbol: string; iconWidth: number; label: string; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable tooltip={label} accessibilityRole="button" accessibilityLabel={label} onAccessibilityTap={onPress} onPress={onPress}>
        {({ pressed }) => {
          const color = pressed ? theme.textSecondary : hovered ? theme.textPrimary : theme.textTertiary;
          return (
            <View style={{ height: CLEAR_DIVIDER_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 8 }}>
              <Symbol name={symbol} size={9} weight="semibold" color={color} style={{ width: iconWidth, height: 11, marginRight: 3 }} />
              <Text style={{ fontSize: 10, fontWeight: "500", color }}>{title}</Text>
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}
