import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { hex, layout, useTheme } from "../ui/theme";
import { currentGroup } from "../../state/browser/current";
import { useGroup, usePageProfileId, useWindowId } from "../../state/browser/hooks";
import { updateGroup } from "../../state/groups/actions";
import { useGroupLabel } from "../../state/groups/hooks";
import { newCapture } from "../../state/sidebar/listCapture";
import { useCapturedFolderChildren, useGroupFirstTabIcon, useGroupTabIds, useKeptEntry, useSelectionInFolder } from "../../state/sidebar/hooks";
import { MeetingTimeLabel, useMeetingCountdown } from "../live/MeetingCountdown";
import { HoverSlot } from "../ui/HoverSlot";
import { ArcTabRowBackground, Button, ContextMenuArea, FadeLabel, font, ink, radius, Surface, Symbol, weight, withAlpha } from "../ui";
import { commitRename, endRename, openPath, startRename } from "../../state/sidebar/actions";
import { FolderScope, useDragFolded, useDragItem, useDragging, useDropInto } from "./DragProvider";
import { useShift, type EntryMotion } from "./EntryMotion";
import { Fold, FOLD_TIMING, foldsSettled, holdFolds, useFold, useFoldHidden, type FoldSlide } from "./Fold";
import { ARC_FOLDER_INDENT, GROUP_BORDER, GROUP_HEADER_RADIUS, GROUP_INDENT, GROUP_PAD, GROUP_RADIUS } from "./geometry";
import { foldedGroupHeight, groupFoldDelta, groupFrame, padTopOf } from "../../state/sidebar/geometry";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { FolderGlyph, useFolderColors } from "./FolderGlyph";
import { dismissHover } from "../../state/sidebar/hover";
import { useGroupHover, useRowHover } from "./hoverController";
import { HOVER_CARD_FADE_MS } from "./hoverMotion";
import { FoldChainContext, GhostSlot, ListMotionContext, useGroupMotion, type FoldChain } from "./ListMotion";
import { LiveFolderBlock } from "./LiveFolderBlock";
import { pressGroupClose, useGroupCloseControl } from "../../state/sidebar/closeControl";
import { openGroupMenu } from "../../state/sidebar/menus";
import { useLiveDefinitions } from "../../state/sidebar/pinnedTree";
import { registerRow, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { entryId, entryKey, parseEntry } from "../../state/sidebar/entryKey";
import { TabIcon } from "./TabIcon";
import { RenameField, SplitRowItem, TabRowItem } from "./TabRow";
import { groupSurface, TABULAR_NUMS, useArcLabel, useArcTitle, useSidebarTokens } from "./tokens";
import { curve } from "../ui/motion";
import { tailKey } from "./dragModel";

const BOX_FADE = curve.fade;
const NO_GROUPS: ReadonlySet<string> = new Set();
type Section = "list" | "pinned";

const uniformRows = (entries: string[]) => entries.every((e) => {
  const { kind } = parseEntry(e);
  return kind === "tab" || kind === "split";
});

type ReportInnerHover = (groupId: string, hovered: boolean) => void;
const InnerGroupHover = createContext<ReportInnerHover | null>(null);

function useInnermostHover(groupId: string, hovered: boolean) {
  const reportToParent = useContext(InnerGroupHover);
  const [hoveredInside, setHoveredInside] = useState(NO_GROUPS);
  const [reportInside] = useState(() => (id: string, on: boolean) =>
    setHoveredInside((was) => {
      if (was.has(id) === on) return was;
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    }),
  );
  useEffect(() => {
    if (!reportToParent || !hovered) return;
    reportToParent(groupId, true);
    return () => reportToParent(groupId, false);
  }, [reportToParent, hovered, groupId]);
  return { innermost: hovered && hoveredInside.size === 0, reportInside };
}

function useBoxOpacity(shown: boolean) {
  const [opacity] = useState(() => new Animated.Value(shown ? 1 : 0));
  useEffect(() => {
    const fade = Animated.timing(opacity, { toValue: shown ? 1 : 0, duration: HOVER_CARD_FADE_MS, easing: BOX_FADE, useNativeDriver: true });
    fade.start();
    return () => fade.stop();
  }, [shown]);
  return opacity;
}

export const GroupBlock = memo(function GroupBlock({ groupId, section, parentGroup, motion: own = null, peek = false }: { groupId: string; section: Section; parentGroup?: string; motion?: EntryMotion | null; peek?: boolean }) {
  const windowId = useWindowId();
  const tokens = useSidebarTokens();
  const stored = useGroup(groupId, (g) => !!g?.collapsed);
  const collapsed = useDragFolded(entryKey("group", groupId)) || stored || peek;
  const tabIds = useGroupTabIds(groupId);
  const profileId = usePageProfileId();
  useLiveDefinitions();
  const [captured] = useState(newCapture);
  const entries = useCapturedFolderChildren(windowId, profileId, groupId, captured);
  const selectedInside = useSelectionInFolder(windowId, profileId, groupId);
  const activeEntry = useKeptEntry(windowId, profileId, entries);
  const flat = useAddressBarInSidebar();
  const frame = groupFrame(flat);
  const padTop = padTopOf(frame, collapsed && activeEntry ? activeEntry : entries[0]);
  const foldedHeight = () => foldedGroupHeight(windowId, profileId, groupId);
  const { wrapper, handle, headerRef } = useDragItem(
    entryKey("group", groupId),
    { kind: "group", tabIds, section, groupId, parentGroup, foldedHeight, collapsed: stored, count: entries.length, padTop },
    own?.clip,
  );

  const fold = useFold(collapsed);
  const scope = useContext(ListMotionContext);
  const motion = useGroupMotion(windowId, profileId, groupId, entries, captured, section === "list" && !parentGroup ? scope : { enabled: scope.enabled, slideBelow: null }, scope.enabled && !collapsed);
  const [moved, movedRef] = useShift(own?.shift ?? null);
  const parentChain = useContext(FoldChainContext);
  const foldChain = parentGroup ? parentChain : (scope.fold?.[section] ?? null);
  const childChain = useMemo<FoldChain>(
    () => (entry, delta, timing = FOLD_TIMING) => {
      const inside = motion.slideBelow(entry, delta, { timing, tail: false });
      const up = foldChain ? foldChain(entryKey("group", groupId), delta, timing) : null;
      return inside ?? up;
    },
    [motion.slideBelow, foldChain, groupId],
  );
  const [foldSlide, setFoldSlide] = useState<FoldSlide | null>(null);
  const lastStored = useRef(stored);
  useLayoutEffect(() => {
    if (lastStored.current === stored) return;
    lastStored.current = stored;
    if (!foldChain || !flat || !scope.enabled || peek || collapsed !== stored || selectedInside || !uniformRows(entries) || !foldsSettled(windowId)) return setFoldSlide(null);
    const delta = groupFoldDelta(windowId, profileId, groupId);
    const shift = delta && delta > 0 ? foldChain(entryKey("group", groupId), stored ? delta : -delta) : null;
    if (shift && delta) holdFolds(windowId);
    setFoldSlide(shift && delta ? { shift, delta, expand: !stored, kept: activeEntry } : null);
  }, [stored]);

  const body = (
    <>
        <View ref={headerRef} {...handle}>
          <GroupHeader groupId={groupId} windowId={windowId} collapsed={collapsed} peek={peek} open={fold.open} flat={flat} />
        </View>
        <View style={flat ? { marginLeft: ARC_FOLDER_INDENT } : null}>
          <FolderScope groupId={groupId}>
              <FoldChainContext.Provider value={fold.moving ? null : childChain}>
                <Fold
                  fold={fold}
                  collapsed={collapsed}
                  entries={motion.slots(entries).map((slot) =>
                    "ghost" in slot
                      ? { key: slot.ghost.key, ghost: true, node: <GhostSlot snapshot={slot.ghost.snapshot} top={slot.top} opacity={slot.ghost.opacity} /> }
                      : {
                          key: slot.entry,
                          node: <HierarchyEntry entry={slot.entry} section={section} parentGroup={groupId} motion={motion.motion(slot.entry)} peek={collapsed && slot.entry === activeEntry} />,
                        },
                  )}
                  keep={activeEntry}
                  gap={layout.rowGap}
                  rowHeight={uniformRows(entries) ? layout.rowHeight : undefined}
                  padTop={entries.length ? padTop : 0}
                  padBottom={frame.padBottom}
                  indent={flat ? 0 : GROUP_INDENT}
                  mountClosed={selectedInside}
                  keepMounted={flat && uniformRows(entries)}
                  footer={<GroupTail groupId={groupId} section={section} />}
                  slide={foldSlide}
                />
              </FoldChainContext.Provider>
          </FolderScope>
        </View>
        {motion.tail ? <Animated.View style={{ marginTop: motion.tail }} /> : null}
    </>
  );

  return (
    <Animated.View ref={wrapper.ref} presentationGate style={wrapper.style}>
      {flat ? (
        <View {...moved} ref={movedRef} style={moved.style as object}>
          {body}
        </View>
      ) : (
        <BoxedFrame groupId={groupId} windowId={windowId} moved={moved} movedRef={movedRef}>
          {body}
        </BoxedFrame>
      )}
    </Animated.View>
  );
});

function BoxedFrame({ groupId, windowId, moved, movedRef, children }: { groupId: string; windowId: string; moved: Record<string, unknown>; movedRef: Ref<View>; children: ReactNode }) {
  const tokens = useSidebarTokens();
  const color = useGroup(groupId, (g) => g?.color ?? null);
  const box = useGroupHover(windowId, groupId);
  const dropInto = useDropInto() === groupId;
  const nested = useInnermostHover(groupId, box.hovered);
  const boxOpacity = useBoxOpacity(nested.innermost || dropInto);
  const { fill, stroke } = groupSurface(color, tokens);
  return (
    <View {...moved} {...box.hoverProps} ref={movedRef} style={[{ paddingVertical: GROUP_BORDER }, moved.style as object]}>
      <Animated.View
        pointerEvents="none"
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: GROUP_RADIUS, backgroundColor: fill, borderWidth: GROUP_BORDER, borderColor: stroke, opacity: boxOpacity }}
      />
      <InnerGroupHover.Provider value={nested.reportInside}>{children}</InnerGroupHover.Provider>
    </View>
  );
}

const GroupTail = memo(function GroupTail({ groupId, section }: { groupId: string; section: Section }) {
  const { wrapper } = useDragItem(tailKey({ group: groupId }), { kind: "tail", tabIds: [], section, parentGroup: groupId });
  return <Animated.View ref={wrapper.ref} style={wrapper.style} />;
});

export const HierarchyEntry = memo(function HierarchyEntry({ entry, section, parentGroup, motion = null, peek = false }: { entry: string; section: Section; parentGroup?: string; motion?: EntryMotion | null; peek?: boolean }) {
  const { kind, id } = parseEntry(entry);
  if (kind === "group") return <GroupBlock groupId={id} section={section} parentGroup={parentGroup} motion={motion} peek={peek} />;
  if (kind === "live") return <LiveFolderBlock folderId={id} motion={motion} peek={peek} />;
  if (kind === "split") return <SplitRowItem splitId={id} section={section} parentGroup={parentGroup} motion={motion} />;
  return <TabRowItem tabId={id} section={section} parentGroup={parentGroup} motion={motion} />;
});

function GroupHeader({ groupId, windowId, collapsed, peek, open, flat }: { groupId: string; windowId: string; collapsed: boolean; peek: boolean; open: Animated.Value; flat: boolean }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const arcLabel = useArcLabel();
  const flatLabel = arcLabel ?? theme.textTab;
  const arcTitle = useArcTitle();
  const hidden = useFoldHidden();
  const group = useGroup(groupId, (g) => g);
  const label = useGroupLabel(groupId);
  const firstTab = useGroupFirstTabIcon(groupId);
  const renaming = useSidebarUi((u) => u.renaming?.kind === "group" && u.renaming.id === groupId);
  const dropInto = useDropInto() === groupId;
  const dragging = useDragging();
  const { hovered, hoverProps } = useRowHover(windowId, collapsed && !renaming ? { kind: "group", id: groupId } : null);
  const countdown = useMeetingCountdown(groupId);
  const folderColors = useFolderColors(group?.color ?? null);
  const closeControl = useGroupCloseControl(hovered && !renaming ? groupId : null);
  if (!group) return null;
  const target = { kind: "group" as const, id: groupId };
  const arcPaint = flat && !dropInto;

  return (
    <View ref={(v) => registerRow(windowId, groupId, hidden ? null : v)} {...hoverProps} onDoubleClick={() => void startRename(windowId, target)}>
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openGroupMenu(windowId, groupId);
        }}
      >
        <Pressable
          accessibilityRole={renaming ? undefined : "button"}
          accessibilityLabel={renaming ? undefined : label}
          accessibilityState={{ expanded: !collapsed }}
          onPress={() => {
            dismissHover();
            if (renaming) return;
            if (peek && !currentGroup(groupId)?.collapsed) openPath(windowId, { kind: "group", id: groupId });
            else updateGroup(groupId, { collapsed: !collapsed });
          }}
        >
          {({ pressed }) => (
            <Surface
              fill={arcPaint ? undefined : hex(dropInto || pressed ? theme.tabPressed : hovered ? tokens.groupHeaderHover : ink.clear)}
              cornerRadius={flat ? layout.rowRadius : GROUP_HEADER_RADIUS}
              style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: flat ? layout.rowPadding : 9, paddingRight: 6 }}
            >
              {arcPaint ? <ArcTabRowBackground dark={theme.dark} hovered={hovered && !dragging} pointerEvents="none" style={StyleSheet.absoluteFill} /> : null}
              {flat ? (
                <FolderGlyph colors={folderColors} open={!collapsed} icon={group.icon} />
              ) : group.icon || firstTab ? (
                <TabIcon url={firstTab?.url ?? ""} favicon={firstTab?.favicon} icon={group.icon ?? firstTab?.customIcon} profileId={firstTab?.profileId} />
              ) : (
                <View style={{ width: 16 }} />
              )}
              {renaming ? (
                <RenameField
                  initial={group.name}
                  placeholder={label}
                  color={flat ? flatLabel : tokens.groupTitle}
                  fontSize={flat ? layout.rowFontSize : undefined}
                  weight={flat ? weight.semibold : weight.medium}
                  gap={flat ? layout.rowLabelGap : undefined}
                  arc={flat}
                  onDone={(text) => (text === null ? endRename(target) : commitRename(target, text))}
                />
              ) : (
                <Animated.View style={{ flex: 1, height: 18, marginLeft: flat ? layout.rowLabelGap : 5, flexDirection: "row", alignItems: "center", transform: [{ rotate: countdown.rotate }] }}>
                  <View style={{ flexShrink: 1, height: 18, paddingRight: 8, justifyContent: "center" }}>
                    <Text numberOfLines={1} style={{ opacity: 0, fontSize: flat ? layout.rowFontSize : font.body.fontSize, fontWeight: flat ? weight.semibold : weight.medium, fontVariant: TABULAR_NUMS }}>
                      {label}
                    </Text>
                    <FadeLabel
                      text={label}
                      fontSize={flat ? layout.rowFontSize : font.body.fontSize}
                      weight={flat ? "semibold" : "medium"}
                      color={flat ? (arcTitle ?? flatLabel) : tokens.groupTitle}
                      style={{ position: "absolute", left: 0, right: 0, top: 0, height: 18 }}
                    />
                  </View>
                  {!flat ? (
                    <Animated.View
                      style={{
                        width: 10,
                        height: 10,
                        marginLeft: 0,
                        alignItems: "center",
                        justifyContent: "center",
                        transform: [{ rotate: open.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) }],
                      }}
                    >
                      <Symbol name="chevron.down" size={9} weight="semibold" color={withAlpha(tokens.groupTitle, 0.5)} style={{ width: 10, height: 10 }} />
                    </Animated.View>
                  ) : null}
                </Animated.View>
              )}
              <HoverSlot
                hovered={hovered && !renaming}
                width={22}
                hover={closeControl && <Button variant="icon" icon={closeControl.icon} size={10} weight="semibold" box={22} radius={radius.m} onPress={() => pressGroupClose(groupId)} tooltip={closeControl.tooltip} />}
              >
                {countdown.label && !renaming ? <MeetingTimeLabel label={countdown.label} urgent={countdown.urgent} /> : null}
              </HoverSlot>
            </Surface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
