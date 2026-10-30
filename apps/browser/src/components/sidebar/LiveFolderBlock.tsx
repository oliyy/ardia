import { memo, useContext, useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { errorText, manualRefresh, statusText } from "../../state/live/engine";
import { folderRows, hasShownUnread, openItems, shownCompleted, shownItems, type FolderRow } from "../../state/live/rows";
import { liveFolderIcon, SOURCES } from "../../state/live/sources";
import { live, updateFolder, useLive } from "../../state/live/store";
import type { CompletedItem, LiveItem } from "../../state/live/types";
import { usePageProfileId, useTab, useWindowId } from "../../state/browser/hooks";
import { useLiveActiveTab, useLiveStrays } from "../../state/sidebar/hooks";
import { liveNode } from "../../state/pins/pinTree";
import { openSettings } from "../../state/settings/settingsWindows";
import { openPath } from "../../state/sidebar/actions";
import { dismissHover } from "../../state/sidebar/hover";
import { openLiveFolderMenu } from "../../state/sidebar/liveMenus";
import { noteLiveHeight } from "../../state/sidebar/pinnedTree";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { groupFrame } from "../../state/sidebar/geometry";
import { entryKey } from "../../state/sidebar/entryKey";
import type { LiveData } from "../../state/sidebar/listCapture";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { HoverSlot } from "../ui/HoverSlot";
import { ActivitySpinner, ArcTabRowBackground, Button, ContextMenuArea, FadeLabel, ink, radius, Surface, Symbol, useHover } from "../ui";
import { hex, layout, useTheme } from "../ui/theme";
import { useLiveColors } from "../live/tokens";
import { bundledSiteIcon } from "../favicon/siteIcons";
import { TabRow } from "./TabRow";
import { useDragFolded, useDragItem, useDragging } from "./DragProvider";
import { useShift, type EntryMotion } from "./EntryMotion";
import { Fold, useFold, useFoldHidden, type FoldEntry } from "./Fold";
import { LiveRowGhost } from "./GhostEntry";
import { AnimatedSurface, RowGhost, useRowMotion, type PlacedRow, type RowPlacement } from "./LiveMotion";
import { FoldChainContext, ListMotionContext, type FoldChain } from "./ListMotion";
import { ARC_FOLDER_INDENT, GROUP_BORDER, GROUP_HEADER_RADIUS, GROUP_PAD, GROUP_RADIUS } from "./geometry";
import { FolderGlyph, useFolderColors } from "./FolderGlyph";
import { TabIcon } from "./TabIcon";
import { TABULAR_NUMS, useArcLabel, useArcTitle, useSidebarTokens } from "./tokens";
import { MoreRow, NoteRow, SectionTitle, StackRow, STACK_INDENT, type GlideStyle } from "./LiveFolderRows";
import { LiveItemRow } from "./LiveItemRow";

const PAD = GROUP_PAD;
const EMPTY: LiveItem[] = [];
const NONE_COMPLETED: CompletedItem[] = [];

const ROW_HEIGHTS = { header: 22, more: 26, stackHead: 26, note: 28 } as const;

type MotionSource = { rows: FolderRow[]; strays: string[]; data: LiveData };

function placeFolder(folderId: string, { rows, strays, data }: MotionSource): RowPlacement {
  const gap = layout.rowGap;
  const placed: PlacedRow[] = [];
  let y = 0;
  for (const row of rows) {
    placed.push({ key: row.key, y, parent: null, ghost: () => <LiveRowGhost data={data} folderId={folderId} row={row} /> });
    if (row.kind !== "stack") {
      y += (row.kind === "item" ? layout.rowHeight : ROW_HEIGHTS[row.kind]) + gap;
      continue;
    }
    let child = y + ROW_HEIGHTS.stackHead + gap;
    if (data.expandedStacks[row.id] !== false) {
      for (const item of row.items) {
        placed.push({ key: item.id, y: child, parent: row.key, ghost: () => <LiveRowGhost data={data} folderId={folderId} row={{ kind: "item", key: item.id, item }} indent={STACK_INDENT} /> });
        child += layout.rowHeight + gap;
      }
    }
    y = Math.max(y + ROW_HEIGHTS.stackHead + gap, child);
  }
  if (!rows.length) {
    placed.push({ key: "note", y, parent: null, ghost: null });
    y += ROW_HEIGHTS.note + gap;
  }
  for (const id of strays) {
    placed.push({ key: `stray:${id}`, y, parent: null, ghost: null });
    y += layout.rowHeight + gap;
  }
  return { rows: placed, height: Math.max(0, y - gap) };
}

type StackKey = { key: string; members: string[] };

function steadyStackKeys(rows: FolderRow[], known: Map<string, StackKey>): FolderRow[] {
  const used = new Set<string>();
  const next = new Map<string, StackKey>();
  const keyed = rows.map((row) => {
    if (row.kind !== "stack") return row;
    const members = row.items.map((item) => item.id);
    const same = known.get(row.id) ?? [...known.values()].find((k) => !used.has(k.key) && k.members.some((m) => members.includes(m)));
    const key = same && !used.has(same.key) ? same.key : row.key;
    used.add(key);
    next.set(row.id, { key, members });
    return key === row.key ? row : { ...row, key };
  });
  known.clear();
  for (const [id, entry] of next) known.set(id, entry);
  return keyed;
}

function ChainProbe({ into }: { into: MutableRefObject<FoldChain | null> }) {
  into.current = useContext(FoldChainContext);
  return null;
}

export const LiveFolderBlock = memo(function LiveFolderBlock({ folderId, motion = null, peek = false }: { folderId: string; motion?: EntryMotion | null; peek?: boolean }) {
  const windowId = useWindowId();
  const tokens = useSidebarTokens();
  const folder = useLive((s) => s.folders[folderId]);
  const fetched = useLive((s) => s.items[folderId] ?? EMPTY);
  const items = useMemo(() => (folder ? shownItems(folder, fetched) : fetched), [folder, fetched]);
  const showAll = useLive((s) => s.showAll);
  const folded = useDragFolded(entryKey("live", folderId));
  const collapsed = folded || !!folder?.collapsed || peek;
  const completed = useCompletedShown(folderId);
  const stackKeys = useRef(new Map<string, StackKey>()).current;
  const rows = useMemo(() => (folder ? steadyStackKeys(folderRows(folder, openItems(items, completed), showAll, completed), stackKeys) : []), [folder, items, showAll, completed]);
  const itemIds = useMemo(() => new Set([...items, ...completed.map((c) => c.item)].map((i) => i.id)), [items, completed]);
  const hiddenList = useLive((s) => s.hidden[folderId] ?? EMPTY);
  const hiddenIds = useMemo(() => new Set([...hiddenList, ...fetched.filter((it) => !itemIds.has(it.id))].map((i) => i.id)), [hiddenList, fetched, itemIds]);
  const profileId = usePageProfileId();
  const strays = useLiveStrays(windowId, profileId, folderId, itemIds, hiddenIds);
  const activeTab = useLiveActiveTab(windowId, profileId, folderId, itemIds, hiddenIds);
  const activeItem = useTab(activeTab ?? undefined, (t) => t?.liveItem?.itemId ?? null);
  const fold = useFold(collapsed);
  const flat = useAddressBarInSidebar();
  const frame = groupFrame(flat);
  const foldedHeight = () => frame.border * 2 + layout.rowHeight + (activeTab ? layout.rowHeight + frame.padTop + frame.padBottom : 0);
  const { wrapper, handle, headerRef } = useDragItem(entryKey("live", folderId), { kind: "live", tabIds: [], section: "pinned", liveFolderId: folderId, collapsed: !!folder?.collapsed, foldedHeight }, motion?.clip);
  const [moved, movedRef] = useShift(motion?.shift ?? null);
  const scope = useContext(ListMotionContext);
  const chain = useRef<FoldChain | null>(null);
  const landed = useRef({ fetched, completed });
  const fromData = landed.current.fetched !== fetched || landed.current.completed !== completed;
  landed.current = { fetched, completed };
  const completing = useLive((s) => s.completing[folderId]);
  const source = useMemo<MotionSource>(() => ({ rows, strays, data: live() }), [rows, strays, completing]);
  const ready = fromData && scope.enabled && !collapsed && (live().revisions[folderId] ?? 0) > 1;
  const rowMotion = useRowMotion(source, ready, (from) => placeFolder(folderId, from), (delta, timing) => {
    (chain.current ?? scope.fold?.pinned)?.(liveNode(folderId), delta, timing);
  });
  useEffect(() => () => noteLiveHeight(windowId, profileId, folderId, null), [windowId, profileId, folderId]);
  if (!folder) return null;

  const glide = (key: string, node: ReactNode): FoldEntry => ({ key, node: <AnimatedSurface style={rowMotion.style(key)}>{node}</AnimatedSurface> });
  const entries: FoldEntry[] = rowMotion.ghosts.map((g) => ({ key: g.key, ghost: true, node: <RowGhost top={g.y} style={g.style}>{g.node}</RowGhost> }));
  if (rows.length) for (const row of rows) entries.push(glide(row.key, <FolderRowView row={row} folderId={folderId} windowId={windowId} glide={rowMotion.style} />));
  else entries.push(glide("note", <FolderNote folderId={folderId} />));
  for (const id of strays) entries.push(glide(`stray:${id}`, <TabRow tabId={id} />));
  const keep = !activeTab
    ? null
    : strays.includes(activeTab)
      ? `stray:${activeTab}`
      : (rows.find((r) => (r.kind === "item" && r.item.id === activeItem) || (r.kind === "stack" && r.items.some((i) => i.id === activeItem)))?.key ?? null);

  return (
    <Animated.View ref={wrapper.ref} style={wrapper.style}>
      <View
        {...moved}
        ref={movedRef}
        onLayout={(e) => noteLiveHeight(windowId, profileId, folderId, e.nativeEvent.layout.height)}
        style={[flat ? null : { borderRadius: GROUP_RADIUS, backgroundColor: tokens.groupFill, borderWidth: GROUP_BORDER, borderColor: tokens.groupStroke, paddingHorizontal: PAD }, moved.style as object]}
      >
        <View ref={headerRef} {...handle}>
          <FolderHeader folderId={folderId} windowId={windowId} collapsed={collapsed} peek={peek} flat={flat} />
        </View>
        <ChainProbe into={chain} />
        <View style={flat ? { marginLeft: ARC_FOLDER_INDENT } : null}>
          <Fold fold={fold} collapsed={collapsed} entries={entries} keep={keep} gap={layout.rowGap} padTop={frame.padTop} padBottom={frame.padBottom} />
        </View>
      </View>
    </Animated.View>
  );
});

function FolderRowView({ row, folderId, windowId, glide }: { row: FolderRow; folderId: string; windowId: string; glide: GlideStyle }) {
  switch (row.kind) {
    case "header":
      return <SectionTitle title={row.title} />;
    case "more":
      return <MoreRow folderId={folderId} section={row.section} count={row.count} />;
    case "stack":
      return <StackRow folderId={folderId} windowId={windowId} stack={row} glide={glide} />;
    case "item":
      return <LiveItemRow folderId={folderId} item={row.item} windowId={windowId} done={row.done} />;
  }
}

function FolderNote({ folderId }: { folderId: string }) {
  const status = useLive((s) => s.status[folderId]);
  const kind = useLive((s) => s.folders[folderId]?.kind);
  const hidden = useLive((s) => s.hidden[folderId]?.length ?? 0);
  if (!status || status.state === "initializing" || (status.state === "updating" && !status.lastFetch)) return <NoteRow text="Loading…" spinner />;
  if (status.error) return <NoteRow text={errorText(status.error.kind, status.error.source)} onPress={() => openSettings("liveFolders")} icon="exclamationmark.triangle.fill" />;
  if (hidden) return <NoteRow text={`${hidden} hidden until you refresh`} onPress={() => void manualRefresh(folderId)} />;
  return <NoteRow text={kind === "pullRequests" ? "No open pull requests" : "No recent documents"} />;
}

function FolderHeader({ folderId, windowId, collapsed, peek, flat }: { folderId: string; windowId: string; collapsed: boolean; peek: boolean; flat: boolean }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const arcLabel = useArcLabel();
  const arcTitle = useArcTitle();
  const hidden = useFoldHidden();
  const colors = useLiveColors();
  const folder = useLive((s) => s.folders[folderId]);
  const count = useLive((s) => (s.folders[folderId] ? shownItems(s.folders[folderId], s.items[folderId] ?? EMPTY).length : 0));
  const unread = useLive((s) => !!s.folders[folderId] && hasShownUnread(s.folders[folderId], s.items[folderId] ?? EMPTY, s.unread[folderId]));
  const status = useLive((s) => s.status[folderId]);
  const { hovered, hoverProps } = useHover();
  const dragging = useDragging();
  const folderColors = useFolderColors(null);
  if (!folder) return null;
  const updating = status?.state === "updating" || status?.state === "initializing";
  const { site: sourceSite, icon } = liveFolderIcon(folder);
  const initialLoading = !status || status.state === "initializing" || (status.state === "updating" && !status.lastFetch);
  const sourceMark = folder.sources[0] === "github" && !initialLoading ? bundledSiteIcon(SOURCES.github.site, theme.dark) : undefined;

  return (
    <View ref={(v) => registerRow(windowId, `livefolder|${folderId}`, hidden ? null : v)} {...hoverProps} style={{ marginHorizontal: flat ? 0 : -PAD }}>
      <ContextMenuArea
        onContextMenu={() => {
          dismissHover();
          void openLiveFolderMenu(windowId, folderId);
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={folder.name}
          accessibilityState={{ expanded: !collapsed }}
          onPress={() => {
            dismissHover();
            if (peek && !folder.collapsed) openPath(windowId, { kind: "live", id: folderId });
            else updateFolder(folderId, { collapsed: !collapsed });
          }}
        >
          {({ pressed }) => (
            <Surface
              fill={flat ? undefined : hex(pressed ? theme.tabPressed : hovered ? tokens.groupHeaderHover : ink.clear)}
              cornerRadius={flat ? layout.rowRadius : GROUP_HEADER_RADIUS}
              style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: flat ? layout.rowPadding : 9 + PAD, paddingRight: 6 }}
            >
              {flat ? <ArcTabRowBackground dark={theme.dark} hovered={hovered && !dragging} pointerEvents="none" style={StyleSheet.absoluteFill} /> : null}
              {flat ? (
                <FolderGlyph colors={folderColors} open={!collapsed} icon={folder.icon} image={sourceMark} dots={sourceMark === undefined} />
              ) : (
                <TabIcon url={sourceSite} icon={icon} />
              )}
              <FadeLabel
                text={folder.name}
                fontSize={flat ? layout.rowFontSize : 13}
                weight={flat ? "semibold" : "medium"}
                color={flat ? (arcTitle ?? arcLabel ?? theme.textTab) : tokens.groupTitle}
                style={{ flex: 1, height: 18, marginLeft: flat ? layout.rowLabelGap : 5 }}
              />
              {status?.error ? (
                <Pressable onPress={() => openSettings("liveFolders")} tooltip={errorText(status.error.kind, status.error.source)} style={{ marginRight: 2 }}>
                  <Symbol name="exclamationmark.triangle.fill" size={10} color={colors.pending} style={{ width: 18, height: 18 }} />
                </Pressable>
              ) : null}
              <ActivitySpinner visible={updating} style={{ position: "absolute", right: 8, top: (layout.rowHeight - 12) / 2, width: 12, height: 12 }} />
              <HoverSlot
                hovered={hovered && !updating}
                width={22}
                hover={<Button variant="icon" icon="arrow.clockwise" size={10} weight="semibold" box={22} radius={radius.m} onPress={() => void manualRefresh(folderId)} tooltip={statusText(folderId)} />}
              >
                {collapsed && !updating ? (
                  <View style={{ flexDirection: "row", alignItems: "center", marginRight: 2, gap: 5 }}>
                    {unread ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.accent }} /> : null}
                    {flat ? null : (
                      <View style={{ minWidth: 20, height: 18, borderRadius: 9, paddingHorizontal: 6, backgroundColor: tokens.countPill, alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textTab, fontVariant: TABULAR_NUMS }}>{count}</Text>
                      </View>
                    )}
                  </View>
                ) : null}
              </HoverSlot>
            </Surface>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}

function useCompletedShown(folderId: string): CompletedItem[] {
  return useLive(
    useShallow((s) => {
      const folder = s.folders[folderId];
      return folder ? shownCompleted(folder, s.completed[folderId] ?? NONE_COMPLETED) : NONE_COMPLETED;
    }),
  );
}
