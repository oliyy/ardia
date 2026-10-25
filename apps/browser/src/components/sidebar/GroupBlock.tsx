import { ArcTabRowBackground, ContextMenuArea, FadeLabel, Surface, Symbol } from "@ardia/shell";
import { memo, useContext, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { usePageProfileId, useWindowId } from "../../store/hooks";
import { groupLabel } from "../../store/organize";
import { MeetingTimeLabel, useMeetingCountdown } from "../live/MeetingCountdown";
import { HoverSlot } from "../HoverSlot";
import { IconButton } from "../primitives";
import { commitRename, endRename, openPath, startRename } from "./actions";
import { FolderScope, useDragFolded, useDragItem, useDragging, useDropInto } from "./dnd";
import { useShift, type EntryMotion } from "./entryMotion";
import { Fold, useFold, useFoldHidden } from "./Fold";
import { ARC_FOLDER_INDENT, GROUP_BORDER, GROUP_HEADER_RADIUS, GROUP_PAD, GROUP_RADIUS, entryHeight, groupFrame, keptEntry } from "./geometry";
import { useAddressBarInSidebar } from "../layout/windowLayout";
import { FolderGlyph, folderSymbol, useFolderColors } from "./FolderGlyph";
import { folderPath } from "./entries";
import { dismissHover, useRowHover } from "./hover";
import { capture, GhostSlot, ListMotionContext, newCapture, useGroupMotion } from "./listMotion";
import { LiveFolderBlock } from "./LiveFolderBlock";
import { pressGroupClose, useGroupCloseControl } from "./closeControl";
import { openGroupMenu } from "./menus";
import { folderChildren, useLiveDefinitions } from "./pinnedTree";
import { registerRow, useSidebarUi } from "./state";
import { TabIcon } from "./TabIcon";
import { RenameField, SplitRowItem, TabRowItem } from "./TabRow";
import { GROUP_COLORS, useArcLabel, useArcTitle, useSidebarTokens, withAlpha } from "./tokens";

const PAD = GROUP_PAD;
type Section = "list" | "pinned";

const uniformRows = (entries: string[]) => entries.every((e) => e.startsWith("t:") || e.startsWith("s:"));

export const GroupBlock = memo(function GroupBlock({ groupId, section, parentGroup, motion: own = null, peek = false }: { groupId: string; section: Section; parentGroup?: string; motion?: EntryMotion | null; peek?: boolean }) {
  const windowId = useWindowId();
  const tokens = useSidebarTokens();
  const stored = useBrowser((s) => !!s.groups[groupId]?.collapsed);
  const collapsed = useDragFolded(`g:${groupId}`) || stored || peek;
  const color = useBrowser((s) => s.groups[groupId]?.color ?? null);
  const tabIds = useBrowser((s) => s.groups[groupId]?.tabIds.join(",") ?? "");
  const profileId = usePageProfileId();
  useLiveDefinitions();
  const [captured] = useState(newCapture);
  const entries = useBrowser(
    useShallow((s) => {
      const list = folderChildren(s, windowId, profileId, groupId);
      return capture(captured, s, list, list);
    }),
  );
  const selectedInside = useBrowser((s) => {
    const selection = s.selection[windowId];
    return !!selection?.length && selection.some((id) => !!s.groups[groupId]?.tabIds.includes(id) || folderPath(s, windowId, profileId, id).includes(groupId));
  });
  const activeEntry = useBrowser((s) => keptEntry(s, windowId, profileId, entries));
  const flat = useAddressBarInSidebar();
  const frame = groupFrame(flat);
  const foldedHeight = () => {
    const s = useBrowser.getState();
    const kept = keptEntry(s, windowId, profileId, folderChildren(s, windowId, profileId, groupId));
    return frame.border * 2 + layout.rowHeight + (kept ? entryHeight(s, windowId, profileId, kept) + frame.padTop + frame.padBottom : 0);
  };
  const { wrapper, handle, headerRef } = useDragItem(
    `g:${groupId}`,
    { kind: "group", tabIds: tabIds.split(",").filter(Boolean), section, groupId, parentGroup, foldedHeight, collapsed: stored, count: entries.length, padTop: frame.padTop },
    undefined,
    own?.clip,
  );

  const fold = useFold(collapsed);
  const scope = useContext(ListMotionContext);
  const motion = useGroupMotion(windowId, profileId, groupId, entries, captured, section === "list" && !parentGroup ? scope : { enabled: scope.enabled, slideBelow: null }, scope.enabled && !collapsed);
  const [moved, movedRef] = useShift(own?.shift ?? null);

  const spec = color ? GROUP_COLORS[color] : null;
  const fill = spec ? withAlpha(spec.hex, 0.16) : tokens.groupFill;
  const stroke = spec ? withAlpha(spec.hex, 0.3) : tokens.groupStroke;

  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style}>
      <View {...moved} ref={movedRef} style={[flat ? null : { borderRadius: GROUP_RADIUS, backgroundColor: fill, borderWidth: GROUP_BORDER, borderColor: stroke, paddingHorizontal: PAD }, moved.style as object]}>
        <View ref={headerRef} {...handle} style={{ marginHorizontal: flat ? 0 : -PAD }}>
          <GroupHeader groupId={groupId} windowId={windowId} collapsed={collapsed} peek={peek} open={fold.open} flat={flat} />
        </View>
        <View style={{ marginLeft: ARC_FOLDER_INDENT }}>
          <FolderScope groupId={groupId}>
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
              padTop={entries.length ? frame.padTop : 0}
              padBottom={frame.padBottom}
              mountClosed={selectedInside}
              footer={<GroupTail groupId={groupId} section={section} />}
            />
          </FolderScope>
        </View>
        {motion.tail ? <Animated.View style={{ marginTop: motion.tail }} /> : null}
      </View>
    </Animated.View>
  );
});

const GroupTail = memo(function GroupTail({ groupId, section }: { groupId: string; section: Section }) {
  const { wrapper } = useDragItem(`tail:group:${groupId}`, { kind: "tail", tabIds: [], section });
  return <Animated.View ref={wrapper.ref} style={wrapper.style} />;
});

export const HierarchyEntry = memo(function HierarchyEntry({ entry, section, parentGroup, motion = null, peek = false }: { entry: string; section: Section; parentGroup?: string; motion?: EntryMotion | null; peek?: boolean }) {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return <GroupBlock groupId={id} section={section} parentGroup={parentGroup} motion={motion} peek={peek} />;
  if (entry.startsWith("l:")) return <LiveFolderBlock folderId={id} motion={motion} peek={peek} />;
  if (entry.startsWith("s:")) return <SplitRowItem splitId={id} section={section} motion={motion} />;
  return <TabRowItem tabId={id} section={section} motion={motion} />;
});

function GroupHeader({ groupId, windowId, collapsed, peek, open, flat }: { groupId: string; windowId: string; collapsed: boolean; peek: boolean; open: Animated.Value; flat: boolean }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const arcLabel = useArcLabel();
  const flatLabel = arcLabel ?? theme.textTab;
  const arcTitle = useArcTitle();
  const hidden = useFoldHidden();
  const group = useBrowser((s) => s.groups[groupId]);
  const label = useBrowser((s) => (s.groups[groupId] ? groupLabel(s, s.groups[groupId]!) : ""));
  const firstTab = useBrowser(
    useShallow((s) => {
      const t = s.tabs[s.groups[groupId]?.tabIds[0] ?? ""];
      return t && { url: t.url, favicon: t.favicon, customIcon: t.customIcon, profileId: t.profileId };
    }),
  );
  const renaming = useSidebarUi((u) => u.renaming?.kind === "group" && u.renaming.id === groupId);
  const dropInto = useDropInto() === groupId;
  const dragging = useDragging();
  const { hovered, hoverProps } = useRowHover(windowId, collapsed && !renaming ? { kind: "group", id: groupId } : null);
  const countdown = useMeetingCountdown(groupId);
  const folderColors = useFolderColors(group?.color ?? null);
  const closeControl = useGroupCloseControl(groupId);
  if (!group) return null;
  const target = { kind: "group" as const, id: groupId };
  const symbol = folderSymbol(group.icon);
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
            if (peek && !useBrowser.getState().groups[groupId]?.collapsed) openPath(windowId, { kind: "group", id: groupId });
            else useBrowser.getState().updateGroup(groupId, { collapsed: !collapsed });
          }}
        >
          {({ pressed }) => (
            <Surface
              fill={arcPaint ? undefined : hex(dropInto || pressed ? theme.tabPressed : hovered ? tokens.groupHeaderHover : "rgba(0,0,0,0)")}
              cornerRadius={flat ? layout.rowRadius : GROUP_HEADER_RADIUS}
              style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: flat ? layout.rowPadding : 9 + PAD, paddingRight: 6 }}
            >
              {arcPaint ? <ArcTabRowBackground dark={theme.dark} hovered={hovered && !dragging} pointerEvents="none" style={StyleSheet.absoluteFill} /> : null}
              {flat && (!group.icon || symbol) ? (
                <FolderGlyph colors={folderColors} open={!collapsed} symbol={symbol} />
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
                  weight={flat ? "600" : "500"}
                  gap={flat ? layout.rowLabelGap : undefined}
                  arc={flat}
                  onDone={(text) => (text === null ? endRename(target) : commitRename(target, text))}
                />
              ) : (
                <Animated.View style={{ flex: 1, height: 18, marginLeft: flat ? layout.rowLabelGap : 5, flexDirection: "row", alignItems: "center", transform: [{ rotate: countdown.rotate }] }}>
                  <View style={{ flexShrink: 1, height: 18, paddingRight: 8, justifyContent: "center" }}>
                    <Text numberOfLines={1} style={{ opacity: 0, fontSize: flat ? layout.rowFontSize : 13, fontWeight: flat ? "600" : "500", fontVariant: ["tabular-nums"] }}>
                      {label}
                    </Text>
                    <FadeLabel text={label} fontSize={flat ? layout.rowFontSize : 13} weight={flat ? "semibold" : "medium"} color={flat ? (arcTitle ?? flatLabel) : tokens.groupTitle} style={{ position: "absolute", left: 0, right: 0, top: 0, height: 18 }} />
                  </View>
                  <Animated.View
                    style={{
                      width: 10,
                      height: 10,
                      marginLeft: 0,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: flat && !hovered ? 0 : 1,
                      transform: [{ rotate: open.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) }],
                    }}
                  >
                    <Symbol name="chevron.down" size={9} weight="semibold" color={withAlpha(tokens.groupTitle, 0.5)} style={{ width: 10, height: 10 }} />
                  </Animated.View>
                </Animated.View>
              )}
              <HoverSlot
                hovered={hovered && !renaming}
                width={22}
                hover={closeControl && <IconButton icon={closeControl.icon} size={10} weight="semibold" box={22} radius={6} onPress={() => pressGroupClose(groupId)} tooltip={closeControl.tooltip} />}
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
