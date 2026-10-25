import { ActivitySpinner, ArcTabRowBackground, ContextMenuArea, FadeLabel, MouseArea, Surface, Symbol } from "@ardia/shell";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Animated, PlatformColor, Pressable, StyleSheet, TextInput, View, type GestureResponderEvent } from "react-native";
import { toggleMute } from "../../lib/actions";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsActiveTab, usePageProfileId, useTab, useWindowId } from "../../store/hooks";
import { HoverSlot } from "../HoverSlot";
import { useAddressBarInSidebar } from "../layout/windowLayout";
import { IconButton, useHover } from "../primitives";
import { splitRowPanes } from "../../store/splits";
import { isPinnedRow } from "../../store/model";
import { awayFromPin } from "../../store/organize";
import { clickTab, commitRename, endRename, startRename, tabTitle } from "./actions";
import { useDragItem, useDropOnto } from "./dnd";
import { useShift, type EntryMotion } from "./entryMotion";
import { useFoldHidden } from "./Fold";
import { dismissHover, useRowHover } from "./hover";
import { ICON_REGION_WIDTH, ICON_WIDTH, useIconRegion } from "./iconRegion";
import { middleClickTab, openTabMenu } from "./menus";
import { pressTabClose, useTabCloseControl } from "./closeControl";
import { PressFeedback } from "./PressFeedback";
import { ACTIVE, LOADING, PLAYING, SELECTED, useRowState, VISIBLE } from "./rowState";
import { registerRow, useSidebarUi } from "./state";
import { TabIcon } from "./TabIcon";
import { TabBadges } from "../media/TabBadges";
import { ARC_SELECTED_INACTIVE, arcSelectedLabel, useArcLabel, useArcTitle, useSidebarTokens } from "./tokens";

export const clickMods = (e: GestureResponderEvent) => {
  const n = e.nativeEvent as unknown as { metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };
  return { metaKey: !!n.metaKey, shiftKey: !!n.shiftKey, altKey: !!n.altKey };
};

const useSelection = (windowId: string) => () => useBrowser.getState().selection[windowId] ?? [];

export const TabRowItem = memo(function TabRowItem({ tabId, section, motion = null }: { tabId: string; section: "list" | "pinned"; motion?: EntryMotion | null }) {
  const windowId = useWindowId();
  const selection = useSelection(windowId);
  const { wrapper, handle, dragging } = useDragItem(`t:${tabId}`, { kind: "row", tabIds: [tabId], section }, selection, motion?.clip);
  const onto = useDropOnto(`t:${tabId}`);
  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style} {...handle}>
      <TabRow tabId={tabId} onto={onto} shift={motion?.shift ?? null} dragging={dragging} />
    </Animated.View>
  );
});

export const TabRow = memo(function TabRow({ tabId, onto = false, shift = null, dragging = false }: { tabId: string; onto?: boolean; shift?: Animated.Value | null; dragging?: boolean }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const arcLabel = useArcLabel();
  const arcTitle = useArcTitle();
  const windowId = useWindowId();
  const { tab, flags } = useRowState(tabId, windowId);
  const active = !!(flags & ACTIVE);
  const selected = !!(flags & SELECTED);
  const playingAudio = !!(flags & PLAYING);
  const loading = !!(flags & LOADING);
  const renaming = useSidebarUi((u) => u.renaming?.kind === "tab" && u.renaming.id === tabId);
  const { hovered, hoverProps } = useRowHover(windowId, renaming ? null : { kind: "tab", id: tabId });
  const hidden = useFoldHidden();
  const rowView = useRef<View | null>(null);
  const [moved, movedRef] = useShift(
    shift,
    useCallback(
      (v: View | null) => {
        rowView.current = v;
        registerRow(windowId, tabId, hidden ? null : v);
      },
      [windowId, tabId, hidden],
    ),
  );
  const backToPin = useHover();
  const closeControl = useTabCloseControl(tabId);
  const arcLayout = useAddressBarInSidebar();
  const region = useIconRegion(windowId, arcLayout && !dragging && !hidden, hovered, rowView);
  const rowLeave = useCallback(
    (event?: Parameters<typeof hoverProps.onMouseLeave>[0]) => {
      hoverProps.onMouseLeave(event);
      region.rowLeft();
    },
    [hoverProps, region.rowLeft],
  );
  if (!tab) return null;
  const resettable = isPinnedRow(tab) && awayFromPin(tab);
  const resetting = resettable && backToPin.hovered && !renaming;
  const title = resetting ? "Back to Pinned URL" : tabTitle(tab);
  const visible = !!(flags & VISIBLE);
  const arcPaint = arcLayout && !onto;
  const fill = active ? tokens.selectedFill : selected ? tokens.multiSelected : hovered ? theme.tabHover : "rgba(0,0,0,0)";
  const border = !arcPaint && selected && !active ? 0.5 : 0;

  return (
    <View
      {...moved}
      ref={movedRef}
      {...hoverProps}
      onMouseLeave={arcLayout ? rowLeave : hoverProps.onMouseLeave}
      {...(arcLayout ? region.touchProps : null)}
      onLayout={arcLayout ? region.onLayout : undefined}
      style={moved.style as object}
      onDoubleClick={() => void startRename(windowId, { kind: "tab", id: tabId })}
    >
      {arcLayout ? <View pointerEvents="none" {...region.overlayProps} style={{ position: "absolute", left: 0, top: 0, width: ICON_REGION_WIDTH, height: layout.rowHeight }} /> : null}
      <MouseArea onMiddleClick={() => middleClickTab(tabId)}>
        <ContextMenuArea
          onContextMenu={() => {
            dismissHover();
            void openTabMenu(windowId, tab);
          }}
        >
          <Pressable
            onPress={(e) => {
              dismissHover();
              clickTab(windowId, tabId, clickMods(e));
            }}
          >
            {({ pressed }) => (
              <PressFeedback pressed={pressed}>
                <Surface
                  fill={arcPaint ? undefined : hex(onto || (!active && pressed) ? theme.tabPressed : fill)}
                  inactiveFillOpacity={arcPaint ? undefined : arcLabel && active && !onto ? ARC_SELECTED_INACTIVE : undefined}
                  cornerRadius={layout.rowRadius}
                  borderWidth={border}
                  borderColor={border ? hex(tokens.multiSelectedStroke) : undefined}
                  borderColors={!arcPaint && active ? theme.tabSelectedBorder.map(hex) : undefined}
                  shadowColor={!arcPaint && active ? hex(theme.tabSelectedShadow) : undefined}
                  shadowOpacity={!arcPaint && active ? 1 : 0}
                  shadowRadius={theme.tabSelectedShadowRadius}
                  shadowOffset={[0, 0.5]}
                  style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: layout.rowPadding - border, paddingRight: 6 - border }}
                >
                  {arcPaint ? (
                    <ArcTabRowBackground
                      dark={theme.dark}
                      current={active}
                      contentVisible={visible}
                      multiSelected={selected}
                      hovered={hovered}
                      canReset={resettable}
                      iconMinX={layout.rowPadding}
                      iconWidth={ICON_WIDTH}
                      regionHovered={region.regionHovered}
                      regionPressed={region.regionPressed}
                      pointerEvents="none"
                      style={StyleSheet.absoluteFill}
                    />
                  ) : null}
                  {resettable ? (
                    <View {...backToPin.hoverProps}>
                      <Pressable onPress={() => useBrowser.getState().returnToPinnedUrl(tab.id)} tooltip="Back to Pinned URL (⌘↩)">
                        {resetting ? (
                          <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
                            <Symbol name="arrow.uturn.backward" size={11} weight="semibold" color={active ? theme.tabSelectedText : theme.textTab} style={{ width: 16, height: 16 }} />
                          </View>
                        ) : (
                          <View>
                            <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} />
                            <TabBadges tabId={tab.id} />
                          </View>
                        )}
                      </Pressable>
                    </View>
                  ) : (
                    <View>
                      <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} />
                      <TabBadges tabId={tab.id} />
                    </View>
                  )}
                  {(playingAudio || tab.muted) && (
                    <Pressable onPress={() => toggleMute(tab.id)} style={{ marginLeft: 6 }} tooltip={tab.muted ? "Unmute Site" : "Mute Site"}>
                      <Symbol name={tab.muted ? "speaker.slash" : "speaker.wave.2"} size={12} color={theme.textTab} style={{ width: 18, height: 16 }} />
                    </Pressable>
                  )}
                  {renaming ? (
                    <RenameField
                      initial={tab.customTitle ?? tab.title}
                      placeholder={tab.title || "Tab name"}
                      color={(active ? arcSelectedLabel(arcLabel) : arcLabel) ?? (active ? theme.tabSelectedText : theme.textPrimary)}
                      fontSize={layout.rowFontSize}
                      gap={layout.rowLabelGap}
                      arc={arcLayout}
                      current={active}
                      onDone={(text) => (text === null ? endRename({ kind: "tab", id: tabId }) : commitRename({ kind: "tab", id: tabId }, text))}
                    />
                  ) : (
                    <FadeLabel
                      text={title}
                      fontSize={layout.rowFontSize}
                      color={arcTitle ?? (active ? arcSelectedLabel(arcLabel) : arcLabel) ?? (active ? theme.tabSelectedText : theme.textTab)}
                      style={{ flex: 1, height: 18, marginLeft: layout.rowLabelGap }}
                    />
                  )}
                  <HoverSlot
                    hovered={hovered && !renaming}
                    width={22}
                    hover={<IconButton icon={closeControl.icon} size={10} weight="semibold" box={22} radius={6} onPress={() => pressTabClose(tab.id)} tooltip={closeControl.tooltip} />}
                  >
                    {loading && <ActivitySpinner style={{ width: 12, height: 12, marginRight: 2 }} />}
                  </HoverSlot>
                </Surface>
              </PressFeedback>
            )}
          </Pressable>
        </ContextMenuArea>
      </MouseArea>
    </View>
  );
});

export function RenameField({
  initial,
  placeholder,
  color,
  fontSize = 13,
  weight,
  gap = 5,
  arc = false,
  current = false,
  onDone,
}: {
  initial: string;
  placeholder: string;
  color: string;
  fontSize?: number;
  weight?: "500" | "600";
  gap?: number;
  arc?: boolean;
  current?: boolean;
  onDone(text: string | null): void;
}) {
  const theme = useTheme();
  const selection = current ? theme.custom?.subtitle : theme.custom?.minContrastColor;
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const input = useRef<TextInput>(null);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <TextInput
      ref={input}
      value={text}
      onChangeText={setText}
      placeholder={placeholder}
      placeholderTextColor={arc ? PlatformColor("placeholderTextColor") : theme.placeholder}
      selectionColor={theme.selection}
      ardiaEditorStyle={arc ? { appearance: theme.dark ? "dark" : "light", ...(selection ? { selectionColor: selection } : {}) } : undefined}
      selectTextOnFocus
      enableFocusRing={false}
      onSubmitEditing={() => finish(text)}
      onBlur={() => finish(text)}
      keyDownEvents={[{ key: "Escape" }]}
      onKeyDown={(e) => e.nativeEvent.key === "Escape" && finish(null)}
      style={{ flex: 1, height: 18, marginLeft: gap, fontSize, fontWeight: weight, color: arc ? PlatformColor("controlTextColor") : color, paddingVertical: 0, paddingHorizontal: 0 }}
    />
  );
}

export const SplitRowItem = memo(function SplitRowItem({ splitId, section, parentGroup, motion = null }: { splitId: string; section: "list" | "pinned"; parentGroup?: string; motion?: EntryMotion | null }) {
  const windowId = useWindowId();
  const tabIds = useBrowser((s) => splitRowPanes(s, s.splits[splitId]).join(",")).split(",").filter(Boolean);
  const { wrapper, handle } = useDragItem(`s:${splitId}`, { kind: "split", tabIds, section, parentGroup }, undefined, motion?.clip);
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const arcLabel = useArcLabel();
  const profileId = usePageProfileId();
  const active = useBrowser((s) => tabIds.includes(s.windows[windowId]?.activeTabIds[profileId] ?? ""));
  const { hovered, hoverProps } = useRowHover(windowId, null);
  const hidden = useFoldHidden();
  const [moved, movedRef] = useShift(motion?.shift ?? null, useCallback((v: View | null) => registerRow(windowId, `s:${splitId}`, hidden ? null : v), [windowId, splitId, hidden]));
  if (tabIds.length < 2) return null;
  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style} {...handle}>
      <View {...moved} ref={movedRef} {...hoverProps} style={moved.style as object}>
        <Surface
          fill={hex(active ? tokens.selectedFill : hovered ? theme.tabHover : "rgba(0,0,0,0)")}
          inactiveFillOpacity={arcLabel && active ? ARC_SELECTED_INACTIVE : undefined}
          cornerRadius={layout.rowRadius}
          style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingHorizontal: 3 }}
        >
          {tabIds.map((id, i) => (
            <View key={id} style={{ flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 }}>
              {i > 0 && <View style={{ width: 1, height: 16, backgroundColor: theme.divider, marginRight: 2 }} />}
              <SplitPane tabId={id} windowId={windowId} />
            </View>
          ))}
        </Surface>
      </View>
    </Animated.View>
  );
});

function SplitPane({ tabId, windowId }: { tabId: string; windowId: string }) {
  const theme = useTheme();
  const arcLabel = useArcLabel();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const { hovered, hoverProps } = useRowHover(windowId, { kind: "tab", id: tabId });
  if (!tab) return null;
  return (
    <View {...hoverProps} style={{ flex: 1, minWidth: 0 }}>
      <ContextMenuArea onContextMenu={() => void openTabMenu(windowId, tab)}>
        <Pressable onPress={(e) => clickTab(windowId, tabId, clickMods(e))}>
          {({ pressed }) => (
            <PressFeedback pressed={pressed}>
              <View
                style={{
                  height: layout.rowHeight - 6,
                  borderRadius: 7,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingLeft: 6,
                  backgroundColor: active ? undefined : pressed ? theme.tabPressed : hovered ? theme.rowHover : undefined,
                }}
              >
                <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} />
                <FadeLabel text={tabTitle(tab)} fontSize={12} color={(active ? arcSelectedLabel(arcLabel) : arcLabel) ?? (active ? theme.tabSelectedText : theme.textTab)} style={{ flex: 1, height: 16, marginLeft: 5 }} />
              </View>
            </PressFeedback>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
