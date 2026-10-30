import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PlatformColor, Pressable, StyleSheet, TextInput, View } from "react-native";
import { toggleMute } from "../../state/browser/actions";
import { hex, layout, useTheme } from "../ui/theme";
import { useIsActiveTab, usePageProfileId, useTab, useWindow, useWindowId } from "../../state/browser/hooks";
import { returnToPinnedUrl, separateFromPin } from "../../state/pins/actions";
import { useSplitRowPanes } from "../../state/sidebar/hooks";
import { muteTitle } from "../../state/tabs/mute";
import { HoverSlot } from "../ui/HoverSlot";
import { ActivitySpinner, ArcTabRowBackground, Button, FadeLabel, font, ink, OutsidePressArea, radius, Surface, Symbol, useHover } from "../ui";
import { isPinnedRow, tabTitle } from "../../state/browser/model";
import { awayFromPin } from "../../state/pins/organize";
import { commitRename, endRename, startRename } from "../../state/sidebar/actions";
import { useDragItem, useDropOnto } from "./DragProvider";
import { useShift, type EntryMotion } from "./EntryMotion";
import { useFoldHidden } from "./Fold";
import { useRowHover } from "./hoverController";
import { ICON_REGION_WIDTH, ICON_WIDTH, useIconRegion } from "./iconRegion";
import { pressTabClose, useTabCloseControlWhile } from "../../state/sidebar/closeControl";
import { ACTIVE, ICON_MARKS, LOADING, mutedFrom, PLAYING, SELECTED, useRowState, VISIBLE } from "../../state/sidebar/rowState";
import { registerRow, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { tabHasCard } from "./tabCard";
import { TabIcon } from "./TabIcon";
import { TabBadges } from "../media/TabBadges";
import { ARC_SELECTED_INACTIVE, arcSelectedLabel, RESET_HINT_FADE, SELECTED_ROW_SHADOW_OFFSET, useArcLabel, useArcTitle, useSidebarTokens } from "./tokens";
import { useSelectedTabGlow, useSidebarRowLook } from "./rowLook";
import { withShortcut } from "../../state/commands/commandShortcuts";
import { TabPressArea } from "./TabPressArea";
import { entryKey } from "../../state/sidebar/entryKey";
import type { RowSection } from "./dragModel";

const AnimatedSurface = Animated.createAnimatedComponent(Surface);
const AWAY_LABEL_SHIFT = 2;
const RESET_HINT_LIFT = 7;
const RESET_HINT_TOP = 10.5;

export const TabRowItem = memo(function TabRowItem({
  tabId,
  section,
  parentGroup,
  motion = null,
}: {
  tabId: string;
  section: RowSection;
  parentGroup?: string;
  motion?: EntryMotion | null;
}) {
  const { wrapper, handle, dragging } = useDragItem(entryKey("tab", tabId), { kind: "row", tabIds: [tabId], section, parentGroup }, motion?.clip);
  const onto = useDropOnto(entryKey("tab", tabId));
  return (
    <Animated.View ref={wrapper.ref} presentationGate style={wrapper.style} {...handle}>
      <TabRow tabId={tabId} onto={onto} shift={motion?.shift ?? null} dragging={dragging} />
    </Animated.View>
  );
});

export const TabRow = memo(function TabRow({ tabId, onto = false, shift = null, dragging = false }: { tabId: string; onto?: boolean; shift?: Animated.Value | null; dragging?: boolean }) {
  const theme = useTheme();
  const glow = useSelectedTabGlow();
  const tokens = useSidebarTokens();
  const arcLabel = useArcLabel();
  const arcTitle = useArcTitle();
  const windowId = useWindowId();
  const { tab, flags } = useRowState(tabId, windowId);
  const active = !!(flags & ACTIVE);
  const selected = !!(flags & SELECTED);
  const playingAudio = !!(flags & PLAYING);
  const mute = mutedFrom(flags);
  const loading = !!(flags & LOADING);
  const keepSpinner = useRef(loading);
  keepSpinner.current ||= loading;
  const spinner = useMemo(() => <ActivitySpinner visible={loading} style={{ width: 12, height: 12, marginRight: 2 }} />, [loading]);
  const renaming = useSidebarUi((u) => u.renaming?.kind === "tab" && u.renaming.id === tabId);
  const { hovered, hoverProps } = useRowHover(windowId, renaming ? null : { kind: "tab", id: tabId }, tabHasCard);
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
  const closeControl = useTabCloseControlWhile(tabId, hovered && !renaming);
  const { backToPinHint } = useSidebarRowLook();
  const [separateKey, setSeparateKey] = useState(false);
  const onSeparateKey = useCallback((e: { nativeEvent: { held: boolean } }) => setSeparateKey(e.nativeEvent.held), []);
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
  const resettable = (isPinnedRow(tab) || !tab.pin) && awayFromPin(tab);
  const resetting = !arcLayout && resettable && backToPin.hovered && !renaming;
  const hinting = arcLayout && resettable && region.regionHovered && !renaming;
  const title = resetting ? "Back to Pinned URL" : tabTitle(tab);
  const titleColor = arcTitle ?? (active ? arcSelectedLabel(arcLabel) : arcLabel) ?? (active ? theme.tabSelectedText : theme.textTab);
  const visible = !!(flags & VISIBLE);
  const arcPaint = arcLayout && !onto;
  const fill = active ? tokens.selectedFill : selected ? tokens.multiSelected : hovered ? theme.tabHover : ink.clear;
  const border = !arcPaint && selected && !active ? 0.5 : 0;
  const icon = (
    <View tooltip={resettable && !resetting && arcLayout ? withShortcut("Reset Tab", backToPinHint) : undefined}>
      <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} profileId={tab.profileId} marks={flags & ICON_MARKS} />
      <TabBadges tabId={tab.id} />
    </View>
  );

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
      <TabPressArea
        windowId={windowId}
        tab={tab}
        intercept={(mods) => {
          if (!arcLayout || !resettable || !region.pressedInRegion()) return false;
          if (mods.metaKey) separateFromPin(tab.id);
          else returnToPinnedUrl(tab.id);
          return true;
        }}
      >
        {({ pressed }) => (
          <Surface
            fill={arcPaint ? undefined : hex(onto || (!active && pressed) ? theme.tabPressed : fill)}
            inactiveFillOpacity={arcPaint ? undefined : arcLabel && active && !onto ? ARC_SELECTED_INACTIVE : undefined}
            cornerRadius={layout.rowRadius}
            borderWidth={border}
            borderColor={border ? hex(tokens.multiSelectedStroke) : undefined}
            borderColors={!arcPaint && active ? theme.tabSelectedBorder.map(hex) : undefined}
            shadowColor={!arcPaint && active ? glow.shadowColor : undefined}
            shadowOpacity={!arcPaint && active ? glow.shadowOpacity : 0}
            shadowRadius={glow.shadowRadius}
            shadowOffset={SELECTED_ROW_SHADOW_OFFSET}
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
                onSeparateKey={resettable ? onSeparateKey : undefined}
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            {resettable && !arcLayout ? (
              <View {...backToPin.hoverProps}>
                <Pressable onPress={() => returnToPinnedUrl(tab.id)} tooltip={withShortcut("Back to Pinned URL", backToPinHint)}>
                  {resetting ? (
                    <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
                      <Symbol name="arrow.uturn.backward" size={11} weight="semibold" color={active ? theme.tabSelectedText : theme.textTab} style={{ width: 16, height: 16 }} />
                    </View>
                  ) : (
                    icon
                  )}
                </Pressable>
              </View>
            ) : (
              icon
            )}
            {(playingAudio || mute) && (
              <Pressable onPress={() => toggleMute(tab.id)} style={{ marginLeft: 6 }} tooltip={muteTitle(mute)}>
                <Symbol name={mute ? "speaker.slash" : "speaker.wave.2"} size={12} color={theme.textTab} style={{ width: 18, height: 16 }} />
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
            ) : arcLayout && resettable ? (
              <ResetHintTitle title={title} color={titleColor} hinting={hinting} separate={separateKey} />
            ) : (
              <FadeLabel text={title} fontSize={layout.rowFontSize} color={titleColor} style={{ flex: 1, height: 18, marginLeft: layout.rowLabelGap }} />
            )}
            <HoverSlot
              hovered={hovered && !renaming && !hinting}
              width={22}
              reserve="hover"
              hover={closeControl && <Button variant="icon" icon={closeControl.icon} size={10} weight="semibold" box={22} radius={radius.m} onPress={() => pressTabClose(tab.id)} tooltip={closeControl.tooltip} />}
            >
              {keepSpinner.current && spinner}
            </HoverSlot>
          </Surface>
        )}
      </TabPressArea>
    </View>
  );
});

function ResetHintTitle({ title, color, hinting, separate }: { title: string; color: string; hinting: boolean; separate: boolean }) {
  const [shown] = useState(() => new Animated.Value(hinting ? 1 : 0));
  const [motion] = useState(() => ({
    lift: shown.interpolate({ inputRange: [0, 1], outputRange: [0, -RESET_HINT_LIFT] }),
    opacity: shown.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }),
  }));
  const hintedFor = useRef(hinting);
  useEffect(() => {
    if (hintedFor.current === hinting) return;
    hintedFor.current = hinting;
    Animated.timing(shown, { toValue: hinting ? 1 : 0, ...RESET_HINT_FADE, useNativeDriver: true }).start();
  }, [hinting, shown]);
  return (
    <View style={{ flex: 1, height: 18, marginLeft: layout.rowLabelGap + AWAY_LABEL_SHIFT }}>
      <AnimatedSurface style={{ flex: 1, transform: [{ translateY: motion.lift }] }}>
        <FadeLabel text={title} fontSize={layout.rowFontSize} color={color} style={{ flex: 1 }} />
      </AnimatedSurface>
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: RESET_HINT_TOP, height: 14, opacity: motion.opacity }}>
        <FadeLabel text={separate ? "Separate From Pinned Tab" : "Back to Pinned URL"} fontSize={font.caption.fontSize} color={color} style={{ flex: 1 }} />
      </Animated.View>
    </View>
  );
}

export function RenameField({
  initial,
  placeholder,
  color,
  fontSize = font.body.fontSize,
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
    <OutsidePressArea onOutsidePress={() => finish(text)} style={{ flex: 1, height: 18, marginLeft: gap }}>
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
        style={{ flex: 1, fontSize, fontWeight: weight, color: arc ? PlatformColor("controlTextColor") : color, paddingVertical: 0, paddingHorizontal: 0 }}
      />
    </OutsidePressArea>
  );
}

export const SplitRowItem = memo(function SplitRowItem({
  splitId,
  section,
  parentGroup,
  motion = null,
}: {
  splitId: string;
  section: RowSection;
  parentGroup?: string;
  motion?: EntryMotion | null;
}) {
  const windowId = useWindowId();
  const tabIds = useSplitRowPanes(splitId);
  const { wrapper, handle } = useDragItem(entryKey("split", splitId), { kind: "split", tabIds, section, parentGroup }, motion?.clip);
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const arcLabel = useArcLabel();
  const profileId = usePageProfileId();
  const active = useWindow(windowId, (w) => tabIds.includes(w?.activeTabIds[profileId] ?? ""));
  const { hovered, hoverProps } = useRowHover(windowId, null);
  const hidden = useFoldHidden();
  const [moved, movedRef] = useShift(motion?.shift ?? null, useCallback((v: View | null) => registerRow(windowId, entryKey("split", splitId), hidden ? null : v), [windowId, splitId, hidden]));
  if (tabIds.length < 2) return null;
  return (
    <Animated.View ref={wrapper.ref} presentationGate style={wrapper.style} {...handle}>
      <View {...moved} ref={movedRef} {...hoverProps} style={moved.style as object}>
        <Surface
          fill={hex(active ? tokens.selectedFill : hovered ? theme.tabHover : ink.clear)}
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
  const { hovered, hoverProps } = useRowHover(windowId, { kind: "tab", id: tabId }, tabHasCard);
  if (!tab) return null;
  return (
    <View {...hoverProps} style={{ flex: 1, minWidth: 0 }}>
      <TabPressArea windowId={windowId} tab={tab}>
        {({ pressed }) => (
          <View
            style={{
              height: layout.rowHeight - 6,
              borderRadius: radius.button,
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 6,
              backgroundColor: active ? undefined : pressed ? theme.tabPressed : hovered ? theme.rowHover : undefined,
            }}
          >
            <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} />
            <FadeLabel text={tabTitle(tab)} fontSize={font.small.fontSize} color={(active ? arcSelectedLabel(arcLabel) : arcLabel) ?? (active ? theme.tabSelectedText : theme.textTab)} style={{ flex: 1, height: 16, marginLeft: 5 }} />
          </View>
        )}
      </TabPressArea>
    </View>
  );
}
