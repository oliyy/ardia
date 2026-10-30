import { memo, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { markHoverProps } from "../../lib/hoverMarks";
import { layout, useTheme } from "../ui/theme";
import { ContextMenuArea, Symbol, useHover, weight } from "../ui";
import { SIDEBAR_TYPE, useSidebarTokens } from "./tokens";
import { HoverSlot } from "../ui/HoverSlot";
import { closeAllTabs } from "../../state/sidebar/clearTabs";
import { tidyPins } from "../../state/sidebar/tidyPinsUi";
import { openSidebarMenu } from "../../state/sidebar/menus";
import { PINNED_FOLD_TITLES, togglePinnedFold } from "../../state/sidebar/pinnedFold";

const CLEAR_DIVIDER_HEIGHT = 16;
const PADDING = 9;
const SPACED_TOP = 7;
const SPACE_DIVIDER_HEIGHT = 2;
const PINNED_DIVIDER = { inset: 18, height: 22, line: 0.5, top: 10.5 } as const;

export const dividerHeight = (spaced: boolean, flush: boolean, lift = 0) =>
  flush ? (spaced ? PINNED_DIVIDER.height : SPACE_DIVIDER_HEIGHT) : CLEAR_DIVIDER_HEIGHT + (spaced ? SPACED_TOP * 2 : -lift);

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

export const useSidebarHovered = (windowId: string) => useSyncExternalStore(subscribeSidebarHover, () => hoveredSidebars.has(windowId));

type PinnedFold = { collapsed: boolean; open: Animated.Value };

type DividerProps = { windowId: string; profileId: string; spaced: boolean; lift?: number; clear: boolean; tidy: boolean; pinned?: PinnedFold | null; flush?: boolean };

export const ClearDivider = memo(function ClearDivider({ windowId, profileId, spaced, lift = 0, clear, tidy, pinned = null, flush = false }: DividerProps) {
  if (flush) return <SpaceDivider windowId={windowId} profileId={profileId} spaced={spaced} clear={clear} tidy={tidy} />;
  return <DiaDivider windowId={windowId} profileId={profileId} spaced={spaced} lift={lift} clear={clear} tidy={tidy} pinned={pinned} />;
});

function DividerActions({ windowId, profileId, clear, tidy }: { windowId: string; profileId: string; clear: boolean; tidy: boolean }) {
  const theme = useTheme();
  return (
    <>
      {tidy ? <DividerButton title="Tidy" symbol="sparkles" iconWidth={10} label="Tidy pinned tabs" onPress={() => tidyPins(windowId, profileId)} /> : null}
      {tidy && clear ? <View style={{ width: 1, height: 9, marginLeft: 8, backgroundColor: theme.divider }} /> : null}
      {clear ? <DividerButton title="Clear" symbol="arrow.down" iconWidth={8} label="Clear unpinned tabs" onPress={() => closeAllTabs(windowId)} /> : null}
    </>
  );
}

function SpaceDivider({ windowId, profileId, spaced, clear, tidy }: { windowId: string; profileId: string; spaced: boolean; clear: boolean; tidy: boolean }) {
  const tokens = useSidebarTokens();
  const shown = useSidebarHovered(windowId);
  const buttons: ReactNode = (
    <View pointerEvents={shown ? "auto" : "none"} style={{ flexDirection: "row", alignItems: "center", opacity: shown ? 1 : 0 }}>
      <DividerActions windowId={windowId} profileId={profileId} clear={clear} tidy={tidy} />
    </View>
  );
  if (spaced) {
    return (
      <View style={{ height: PINNED_DIVIDER.height, marginHorizontal: PINNED_DIVIDER.inset - layout.sidebarInset }}>
        <View style={{ position: "absolute", left: 0, right: 0, top: PINNED_DIVIDER.top, height: PINNED_DIVIDER.line, backgroundColor: tokens.spaceDivider }} />
        <View style={{ position: "absolute", right: 0, top: PINNED_DIVIDER.top + PINNED_DIVIDER.line / 2 - CLEAR_DIVIDER_HEIGHT / 2 }}>{buttons}</View>
      </View>
    );
  }
  return (
    <View style={{ height: SPACE_DIVIDER_HEIGHT, marginHorizontal: -layout.sidebarInset }}>
      <View style={{ height: 1, backgroundColor: tokens.spaceDivider }} />
      <View style={{ position: "absolute", right: layout.sidebarInset + PADDING, top: (1 - CLEAR_DIVIDER_HEIGHT) / 2 }}>{buttons}</View>
    </View>
  );
}

function DiaDivider({ windowId, profileId, spaced, lift, clear, tidy, pinned }: { windowId: string; profileId: string; spaced: boolean; lift: number; clear: boolean; tidy: boolean; pinned: PinnedFold | null }) {
  const theme = useTheme();
  const { hovered: shown, hoverProps } = useHover();
  const [lineWidth, setLineWidth] = useState(0);
  const foldShown = !!pinned && (shown || pinned.collapsed);
  const actions = tidy || clear;
  return (
    <ContextMenuArea onContextMenu={() => void openSidebarMenu(windowId)}>
      <View
        {...hoverProps}
        onLayout={(e) => setLineWidth(Math.max(0, e.nativeEvent.layout.width - 2 * PADDING))}
        style={{
          height: CLEAR_DIVIDER_HEIGHT,
          marginTop: spaced ? SPACED_TOP : -lift,
          marginBottom: spaced ? SPACED_TOP : 0,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: PADDING,
          paddingRight: PADDING,
        }}
      >
        {pinned ? <HoverSlot hovered={foldShown} width="content" reserve="hover" align="start" hover={<FoldButton pinned={pinned} onPress={() => togglePinnedFold(profileId)} />} /> : null}
        <View style={{ flex: 1, height: 1, overflow: "hidden" }}>
          {lineWidth ? (
            <View style={{ position: "absolute", left: 0, top: -1, width: lineWidth, height: 2, borderBottomWidth: 1, borderStyle: "dashed", borderColor: theme.divider }} />
          ) : null}
        </View>
        {actions ? <HoverSlot hovered={shown} width="content" reserve="hover" hover={<DividerActions windowId={windowId} profileId={profileId} clear={clear} tidy={tidy} />} /> : null}
      </View>
    </ContextMenuArea>
  );
}

function FoldButton({ pinned, onPress }: { pinned: PinnedFold; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const label = pinned.collapsed ? PINNED_FOLD_TITLES.expand : PINNED_FOLD_TITLES.collapse;
  const rotate = pinned.open.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] });
  return (
    <View {...hoverProps}>
      <Pressable tooltip={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: !pinned.collapsed }} onAccessibilityTap={onPress} onPress={onPress}>
        {({ pressed }) => {
          const color = pressed ? theme.textSecondary : hovered ? theme.textPrimary : theme.textTertiary;
          return (
            <View style={{ height: CLEAR_DIVIDER_HEIGHT, flexDirection: "row", alignItems: "center", paddingRight: 8 }}>
              <Animated.View style={{ width: 10, height: 10, marginRight: 3, alignItems: "center", justifyContent: "center", transform: [{ rotate }] }}>
                <Symbol name="chevron.down" size={8} weight="semibold" color={color} style={{ width: 10, height: 10 }} />
              </Animated.View>
              <Text style={{ fontSize: SIDEBAR_TYPE.divider, fontWeight: weight.medium, color }}>Pinned</Text>
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}

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
              <Text style={{ fontSize: SIDEBAR_TYPE.divider, fontWeight: weight.medium, color }}>{title}</Text>
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}
