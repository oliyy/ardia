import { ActivitySpinner, ArcTabRowBackground, ContextMenuArea, FadeLabel, PulseDot, Surface, Symbol, type FadeLabelGlyph } from "@ardia/shell";
import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { closeTab } from "../../lib/actions";
import { hex, layout, useTheme } from "../../lib/theme";
import { COMPLETION_MS, errorText, manualRefresh, openLiveItem, statusText } from "../../live/engine";
import { githubAge, prBadge, summarizeChecks } from "../../live/github";
import { awaitsReview, folderRows, hasShownUnread, liveTabPlace, openItems, shownCompleted, shownItems, type FolderRow } from "../../live/rows";
import { liveFolderIcon, SOURCES } from "../../live/sources";
import { setLive, updateFolder, useLive } from "../../live/store";
import type { CompletedItem, CompletionState, LiveItem, PullRequestInfo } from "../../live/types";
import { useBrowser } from "../../store/browser";
import { usePageProfileId, useWindowId } from "../../store/hooks";
import { activeTabId, viewTabIds } from "../../store/model";
import { openSettings } from "../settings/windows";
import { HoverSlot } from "../HoverSlot";
import { IconButton, useHover } from "../primitives";
import { useLiveColors, type LiveColors } from "../live/colors";
import { openPath } from "./actions";
import { clickMods, TabRow } from "./TabRow";
import { useDragFolded, useDragItem, useDragging } from "./dnd";
import { useShift, type EntryMotion } from "./entryMotion";
import { Fold, useFold, useFoldHidden, type FoldEntry } from "./Fold";
import { ARC_FOLDER_INDENT, GROUP_BORDER, GROUP_HEADER_RADIUS, GROUP_PAD, GROUP_RADIUS, groupFrame } from "./geometry";
import { useAddressBarInSidebar } from "../layout/windowLayout";
import { FolderGlyph, useFolderColors } from "./FolderGlyph";
import { bundledSiteIcon } from "../../lib/siteIcons";
import { dismissHover, useRowHover } from "./hover";
import { openLiveFolderMenu, openLiveItemMenu, openLiveStackMenu } from "./liveMenus";
import { noteLiveHeight } from "./pinnedTree";
import { registerRow } from "./state";
import { TabIcon } from "./TabIcon";
import { ARC_SELECTED_INACTIVE, arcSelectedLabel, useArcLabel, useArcTitle, useSidebarTokens } from "./tokens";

const PAD = GROUP_PAD;
const EMPTY: LiveItem[] = [];
const NONE_COMPLETED: CompletedItem[] = [];

const liveRowKey = (folderId: string, itemId: string) => `live|${folderId}|${itemId}`;

export const LiveFolderBlock = memo(function LiveFolderBlock({ folderId, motion = null, peek = false }: { folderId: string; motion?: EntryMotion | null; peek?: boolean }) {
  const windowId = useWindowId();
  const tokens = useSidebarTokens();
  const folder = useLive((s) => s.folders[folderId]);
  const fetched = useLive((s) => s.items[folderId] ?? EMPTY);
  const items = useMemo(() => (folder ? shownItems(folder, fetched) : fetched), [folder, fetched]);
  const showAll = useLive((s) => s.showAll);
  const folded = useDragFolded(`l:${folderId}`);
  const collapsed = folded || !!folder?.collapsed || peek;
  const completed = useCompletedShown(folderId);
  const rows = useMemo(() => (folder ? folderRows(folder, openItems(items, completed), showAll, completed) : []), [folder, items, showAll, completed]);
  const itemIds = useMemo(() => new Set([...items, ...completed.map((c) => c.item)].map((i) => i.id)), [items, completed]);
  const hiddenList = useLive((s) => s.hidden[folderId] ?? EMPTY);
  const hiddenIds = useMemo(() => new Set([...hiddenList, ...fetched.filter((it) => !itemIds.has(it.id))].map((i) => i.id)), [hiddenList, fetched, itemIds]);
  const profileId = usePageProfileId();
  const strays = useBrowser(
    useShallow((s) =>
      viewTabIds(s, windowId, profileId).filter((id) => s.tabs[id]?.liveItem?.folderId === folderId && liveTabPlace(s.tabs[id]!.liveItem!.itemId, itemIds, hiddenIds) === "stray"),
    ),
  );
  const activeTab = useBrowser((s) => {
    const id = activeTabId(s, windowId, profileId) ?? "";
    const liveItem = s.tabs[id]?.liveItem;
    return liveItem?.folderId === folderId && liveTabPlace(liveItem.itemId, itemIds, hiddenIds) !== "hidden" ? id : null;
  });
  const activeItem = useBrowser((s) => (activeTab ? (s.tabs[activeTab]?.liveItem?.itemId ?? null) : null));
  const fold = useFold(collapsed);
  const flat = useAddressBarInSidebar();
  const frame = groupFrame(flat);
  const foldedHeight = () => frame.border * 2 + layout.rowHeight + (activeTab ? layout.rowHeight + frame.padTop + frame.padBottom : 0);
  const { wrapper, handle, headerRef } = useDragItem(`l:${folderId}`, { kind: "live", tabIds: [], section: "pinned", liveId: folderId, collapsed: !!folder?.collapsed, foldedHeight }, undefined, motion?.clip);
  const [moved, movedRef] = useShift(motion?.shift ?? null);
  useEffect(() => () => noteLiveHeight(windowId, profileId, folderId, null), [windowId, profileId, folderId]);
  if (!folder) return null;

  const entries: FoldEntry[] = rows.length
    ? rows.map((row) => ({ key: row.key, node: <FolderRowView row={row} folderId={folderId} windowId={windowId} /> }))
    : [{ key: "note", node: <FolderNote folderId={folderId} /> }];
  for (const id of strays) entries.push({ key: `stray:${id}`, node: <TabRow tabId={id} /> });
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
        <View style={flat ? { marginLeft: ARC_FOLDER_INDENT } : null}>
          <Fold fold={fold} collapsed={collapsed} entries={entries} keep={keep} gap={layout.rowGap} padTop={frame.padTop} padBottom={frame.padBottom} />
        </View>
      </View>
    </Animated.View>
  );
});

function FolderRowView({ row, folderId, windowId }: { row: FolderRow; folderId: string; windowId: string }) {
  switch (row.kind) {
    case "header":
      return <SectionTitle title={row.title} />;
    case "more":
      return <MoreRow folderId={folderId} section={row.section} count={row.count} />;
    case "stack":
      return <StackRow folderId={folderId} windowId={windowId} stack={row} />;
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
              fill={flat ? undefined : hex(pressed ? theme.tabPressed : hovered ? tokens.groupHeaderHover : "rgba(0,0,0,0)")}
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
                hover={<IconButton icon="arrow.clockwise" size={10} weight="semibold" box={22} radius={6} onPress={() => void manualRefresh(folderId)} tooltip={statusText(folderId)} />}
              >
                {collapsed && !updating ? (
                  <View style={{ flexDirection: "row", alignItems: "center", marginRight: 2, gap: 5 }}>
                    {unread ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.pip }} /> : null}
                    {flat ? null : (
                      <View style={{ minWidth: 20, height: 18, borderRadius: 9, paddingHorizontal: 6, backgroundColor: tokens.countPill, alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textTab, fontVariant: ["tabular-nums"] }}>{count}</Text>
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

function SectionTitle({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <View presentationGate style={{ height: 22, justifyContent: "flex-end", paddingLeft: 9, paddingBottom: 2 }}>
      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: theme.textSecondary }}>
        {title}
      </Text>
    </View>
  );
}

function NoteRow({ text, icon, spinner, onPress }: { text: string; icon?: string; spinner?: boolean; onPress?: () => void }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const { hovered, hoverProps } = useHover();
  const body = (
    <View style={{ height: 28, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 6, gap: 6, borderRadius: 8, backgroundColor: onPress && hovered ? theme.rowHover : undefined }}>
      {spinner ? (
        <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
          <ActivitySpinner visible style={{ width: 12, height: 12 }} />
        </View>
      ) : icon ? <Symbol name={icon} size={10} color={colors.pending} style={{ width: 16, height: 16 }} /> : null}
      <Text numberOfLines={2} style={{ flex: 1, fontSize: 12, color: theme.textSecondary }}>
        {text}
      </Text>
    </View>
  );
  return (
    <View {...hoverProps}>
      {onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body}
    </View>
  );
}

function MoreRow({ folderId, section, count }: { folderId: string; section: string; count: number }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View presentationGate {...hoverProps}>
      <Pressable onPress={() => setLive((s) => ({ showAll: { ...s.showAll, [`${folderId}:${section}`]: true } }))}>
        <View style={{ height: 26, borderRadius: 8, flexDirection: "row", alignItems: "center", paddingLeft: 9, backgroundColor: hovered ? theme.rowHover : undefined }}>
          <Symbol name="ellipsis" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
          <Text style={{ marginLeft: 5, fontSize: 12, color: theme.textSecondary }}>Show {count} More</Text>
        </View>
      </Pressable>
    </View>
  );
}

function StackRow({ folderId, windowId, stack }: { folderId: string; windowId: string; stack: Extract<FolderRow, { kind: "stack" }> }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const collapsed = useLive((s) => s.expandedStacks[stack.id] === false);
  const fold = useFold(collapsed);
  const { hovered, hoverProps } = useHover();
  const repo = stack.repo.split("/")[1] ?? stack.repo;
  return (
    <View presentationGate>
      <View {...hoverProps}>
        <ContextMenuArea
          onContextMenu={() => {
            dismissHover();
            void openLiveStackMenu(folderId, stack.id);
          }}
        >
          <Pressable
            onPress={() => setLive((s) => ({ expandedStacks: { ...s.expandedStacks, [stack.id]: collapsed } }))}
            accessibilityLabel={collapsed ? "Expand pull request stack" : "Collapse pull request stack"}
          >
            <View style={{ height: 26, borderRadius: 8, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 8, backgroundColor: hovered ? theme.rowHover : undefined }}>
              <Symbol name="square.stack.3d.up" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
              <Text numberOfLines={1} style={{ flex: 1, marginLeft: 5, fontSize: 12, fontWeight: "500", color: theme.textSecondary }}>
                {repo} stack
              </Text>
              <View style={{ minWidth: 18, height: 16, borderRadius: 8, paddingHorizontal: 5, backgroundColor: tokens.countPill, alignItems: "center", justifyContent: "center", marginRight: 4 }}>
                <Text style={{ fontSize: 10, fontWeight: "600", color: theme.textTab, fontVariant: ["tabular-nums"] }}>{stack.items.length}</Text>
              </View>
              <Symbol name={collapsed ? "chevron.right" : "chevron.down"} size={9} weight="semibold" color={theme.textSecondary} style={{ width: 12, height: 12 }} />
            </View>
          </Pressable>
        </ContextMenuArea>
      </View>
      <Fold
        fold={fold}
        collapsed={collapsed}
        entries={stack.items.map((item) => ({ key: item.id, node: <LiveItemRow folderId={folderId} item={item} windowId={windowId} inStack /> }))}
        gap={layout.rowGap}
        rowHeight={layout.rowHeight}
        padTop={layout.rowGap}
      />
    </View>
  );
}

function LiveItemRow({ folderId, item, windowId, inStack = false, done }: { folderId: string; item: LiveItem; windowId: string; inStack?: boolean; done?: CompletionState }) {
  const indent = inStack ? 10 : 0;
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const arcLabel = useArcLabel();
  const arcTitle = useArcTitle();
  const hidden = useFoldHidden();
  const flat = useAddressBarInSidebar();
  const colors = useLiveColors();
  const subtitle = item.pr?.author || item.subtitle;
  const key = liveRowKey(folderId, item.id);
  const profileId = usePageProfileId();
  const tabId = useBrowser((s) => viewTabIds(s, windowId, profileId).find((id) => s.tabs[id]?.liveItem?.itemId === item.id && s.tabs[id]?.liveItem?.folderId === folderId) ?? null);
  const active = useBrowser((s) => !!tabId && activeTabId(s, windowId, profileId) === tabId);
  const unread = useLive((s) => !done && !!s.unread[folderId]?.includes(item.id));
  const completing = useLive((s) => (!done && s.completing[folderId]?.includes(item.id) ? (s.completed[folderId]?.find((c) => c.item.id === item.id)?.state ?? "merged") : null));
  const completion = completing ?? done ?? null;
  const reviewDue = !completion && awaitsReview(item);
  const { hovered, hoverProps } = useRowHover(windowId, completion ? null : { kind: "live", id: key });
  const fold = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!completing) return;
    fold.setValue(1);
    Animated.sequence([
      Animated.delay(COMPLETION_MS - 420),
      Animated.timing(fold, { toValue: 0, duration: 360, easing: Easing.bezier(0.2, 0.9, 0.3, 1), useNativeDriver: false }),
    ]).start();
  }, [completing]);
  const fill = active ? tokens.selectedFill : hovered ? theme.tabHover : "rgba(0,0,0,0)";
  const label = (completing ? null : arcTitle) ?? (active ? (arcSelectedLabel(arcLabel) ?? theme.tabSelectedText) : completing ? theme.textSecondary : (arcLabel ?? theme.textTab));

  return (
    <Animated.View presentationGate style={completing ? { height: fold.interpolate({ inputRange: [0, 1], outputRange: [0, layout.rowHeight] }), opacity: fold, overflow: "hidden" } : null}>
      <View
        ref={(v) => {
          registerRow(windowId, key, hidden ? null : v);
          if (tabId) registerRow(windowId, tabId, hidden ? null : v);
        }}
        {...hoverProps}
      >
        <ContextMenuArea
          onContextMenu={() => {
            dismissHover();
            void openLiveItemMenu(windowId, folderId, item, tabId);
          }}
        >
          <Pressable
            onPress={(e) => {
              dismissHover();
              openLiveItem(windowId, folderId, item, { background: clickMods(e).metaKey });
            }}
          >
            {({ pressed }) => (
              <Surface
                fill={hex(!active && pressed ? theme.tabPressed : fill)}
                inactiveFillOpacity={arcLabel && active ? ARC_SELECTED_INACTIVE : undefined}
                cornerRadius={layout.rowRadius}
                style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: layout.rowPadding + indent, paddingRight: flat ? 7 : 6 }}
              >
                {(unread || reviewDue) && !flat ? <PulseDot color={colors.pip} pulsing={reviewDue} style={{ position: "absolute", left: 2 + indent, width: 5, height: 5 }} /> : null}
                <ItemIcon item={item} completing={completing} done={done ?? null} colors={colors} />
                {flat && subtitle ? (
                  <View style={{ flex: 1, marginLeft: layout.rowLabelGap }}>
                    <FadeLabel text={item.title} fontSize={layout.rowFontSize} color={label} style={{ height: 18 }} />
                    <LiveSubtitle item={item} subtitle={subtitle} done={completion} colors={colors} />
                  </View>
                ) : (
                  <FadeLabel
                    text={item.title}
                    fontSize={layout.rowFontSize}
                    weight={unread && !flat ? "medium" : undefined}
                    color={label}
                    style={{ flex: 1, height: 18, marginLeft: layout.rowLabelGap }}
                  />
                )}
                <HoverSlot
                  hovered={hovered && !!tabId && !completing}
                  width={22}
                  hover={<IconButton icon="xmark" size={10} weight="semibold" box={22} radius={6} onPress={() => tabId && void closeTab(tabId)} tooltip="Close Tab (⌘W)" />}
                >
                  {(unread || reviewDue) && flat ? (
                    <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
                      <PulseDot color={theme.textPrimary} pulsing={reviewDue} style={{ width: 6, height: 6, opacity: 0.9 }} />
                    </View>
                  ) : null}
                  <Trailing item={item} completion={completion} colors={colors} flat={flat} />
                </HoverSlot>
              </Surface>
            )}
          </Pressable>
        </ContextMenuArea>
      </View>
    </Animated.View>
  );
}

type PrState = "open" | "draft" | "merged" | "closed";

const PR_STATES: Record<PrState, { icon: ImageSourcePropType; color: keyof LiveColors }> = {
  open: { icon: require("../../../assets/octicons/git-pull-request.png"), color: "stateOpen" },
  draft: { icon: require("../../../assets/octicons/git-pull-request-draft.png"), color: "stateDraft" },
  merged: { icon: require("../../../assets/octicons/git-merge.png"), color: "stateMerged" },
  closed: { icon: require("../../../assets/octicons/git-pull-request-closed.png"), color: "stateClosed" },
};

const prState = (pr: PullRequestInfo, done: CompletionState | null): PrState => (done === "merged" || done === "closed" ? done : pr.draft ? "draft" : "open");

const STATE_WORDS: Record<CompletionState, string> = { merged: "Merged", closed: "Closed", reviewed: "Reviewed" };

const glyphUri = (source: number) => Image.resolveAssetSource(source).uri;

const META_GLYPHS = {
  stack: glyphUri(require("../../../assets/octicons/stack.svg")),
  success: glyphUri(require("../../../assets/octicons/check.svg")),
  pending: glyphUri(require("../../../assets/octicons/dot-fill.svg")),
  failure: glyphUri(require("../../../assets/octicons/x.svg")),
};

const CHECK_GLYPHS: Record<"success" | "pending" | "failure", { color: keyof LiveColors; label: string }> = {
  success: { color: "success", label: "Checks passed" },
  pending: { color: "pending", label: "Checks pending" },
  failure: { color: "failure", label: "Checks failing" },
};

const GLYPH = "\uFFFC";

function prMeta(pr: PullRequestInfo, done: CompletionState | null, colors: LiveColors): { text: string; glyphs: FadeLabelGlyph[] } {
  const parts = [`#${pr.number}`, pr.author];
  const glyphs: FadeLabelGlyph[] = [];
  const age = githubAge(pr.createdAt);
  if (age) parts.push(age);
  if (pr.stack && !done) {
    parts.push(`${GLYPH} ${pr.stack.position}/${pr.stack.size}`);
    glyphs.push({ image: META_GLYPHS.stack, label: "Stack" });
  }
  const word = done ? STATE_WORDS[done] : pr.draft ? "Draft" : null;
  if (word) parts.push(word);
  const checks = summarizeChecks(pr.checks);
  if (checks && checks.tone !== "neutral" && !(done && checks.tone === "pending")) {
    parts.push(`${GLYPH} ${checks.counts.success}/${pr.checks.length}`);
    glyphs.push({ image: META_GLYPHS[checks.tone], color: colors[CHECK_GLYPHS[checks.tone].color], label: CHECK_GLYPHS[checks.tone].label });
  }
  return { text: parts.join(" · "), glyphs };
}

export function LiveSubtitle({ item, subtitle, done, colors }: { item: LiveItem; subtitle: string; done: CompletionState | null; colors: LiveColors }) {
  const theme = useTheme();
  const meta = item.pr ? prMeta(item.pr, done, colors) : null;
  return <FadeLabel text={meta?.text ?? subtitle} glyphs={meta?.glyphs} fontSize={12} color={theme.textSecondary} style={{ height: 14 }} />;
}

const COMPLETION_GLYPH: Record<CompletedItem["state"], { symbol: string; color: keyof LiveColors }> = {
  merged: { symbol: "checkmark.circle.fill", color: "merged" },
  reviewed: { symbol: "checkmark.circle.fill", color: "success" },
  closed: { symbol: "xmark.circle.fill", color: "draft" },
};

export function ItemIcon({
  item,
  completing,
  done = null,
  colors,
  animate = true,
}: {
  item: LiveItem;
  completing: CompletionState | null;
  done?: CompletionState | null;
  colors: LiveColors;
  animate?: boolean;
}) {
  const pop = useRef(new Animated.Value(completing && animate ? 0 : 1)).current;
  useEffect(() => {
    if (!completing || !animate) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, speed: 14, bounciness: 14, useNativeDriver: true }).start();
  }, [completing]);
  if (completing) {
    const glyph = COMPLETION_GLYPH[completing];
    return (
      <Animated.View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center", transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
        <Symbol name={glyph.symbol} size={14} weight="semibold" color={colors[glyph.color]} style={{ width: 16, height: 16 }} />
      </Animated.View>
    );
  }
  if (item.pr) {
    const state = PR_STATES[prState(item.pr, done)];
    return <Image key={colors[state.color]} source={state.icon} accessible={false} style={{ width: 16, height: 16, tintColor: colors[state.color] }} />;
  }
  if (item.icon && /^https?:/.test(item.icon)) return <TabIcon url={item.url} favicon={item.icon} direct />;
  return <TabIcon url={item.source === "confluence" && !item.icon ? SOURCES.confluence.site : item.url} icon={item.icon} />;
}

const PENDING_PERIOD = 3;

const BADGES: Record<Exclude<NonNullable<ReturnType<typeof prBadge>>, "passed">, { symbol: string | null; color: keyof LiveColors; tip: string }> = {
  conflict: { symbol: "exclamationmark.triangle.fill", color: "conflict", tip: "Merge conflicts" },
  failing: { symbol: "xmark.circle.fill", color: "failure", tip: "Checks are failing" },
  changesRequested: { symbol: "arrow.uturn.backward.circle.fill", color: "failure", tip: "Changes Requested" },
  pending: { symbol: null, color: "pending", tip: "Some checks haven't completed yet" },
  approved: { symbol: "checkmark.seal.fill", color: "success", tip: "Approved" },
};

export function Trailing({ item, completion, colors, flat }: { item: LiveItem; completion: CompletedItem["state"] | null; colors: LiveColors; flat: boolean }): ReactNode {
  if (completion) {
    if (flat) return null;
    return <Text style={{ fontSize: 11, fontWeight: "500", color: colors[COMPLETION_GLYPH[completion].color], marginRight: 4 }}>{completion === "merged" ? "Merged" : completion === "reviewed" ? "Reviewed" : "Closed"}</Text>;
  }
  const badge = item.pr ? prBadge(item.pr) : null;
  if (!badge || badge === "passed") return null;
  const spec = BADGES[badge];
  return (
    <View tooltip={spec.tip} style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
      {spec.symbol ? (
        <Symbol name={spec.symbol} size={11} weight="semibold" color={colors[spec.color]} style={{ width: 16, height: 16 }} />
      ) : (
        <ActivitySpinner visible color={colors[spec.color]} period={PENDING_PERIOD} style={{ width: 12, height: 12 }} />
      )}
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
