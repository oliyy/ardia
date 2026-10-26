import { FadeLabel, Symbol } from "@ardia/shell";
import { Image, Text, View } from "react-native";
import { resolveFavicon, useFavicons } from "../../lib/favicons";
import { bundledSiteIcon } from "../../lib/siteIcons";
import { layout, useTheme } from "../../lib/theme";
import { errorText } from "../../live/engine";
import { folderRows, liveTabPlace, type FolderRow } from "../../live/rows";
import { prBadge } from "../../live/github";
import { liveFolderIcon, SOURCES } from "../../live/sources";
import type { live } from "../../live/store";
import type { CompletedItem, LiveFolder, LiveItem } from "../../live/types";
import { useLiveColors } from "../live/colors";
import type { BrowserState } from "../../store/browser";
import { activeTabId, viewTabIds } from "../../store/model";
import type { GroupColor } from "../../store/types";
import { groupLabel } from "../../store/organize";
import { splitRowPanes } from "../../store/splits";
import { tabTitle } from "./actions";
import { ARC_FOLDER_INDENT, GROUP_BORDER, GROUP_PAD, GROUP_RADIUS, groupFrame, keptEntry } from "./geometry";
import { useAddressBarInSidebar } from "../layout/windowLayout";
import { FolderGlyph, useFolderColors } from "./FolderGlyph";
import { pointerOnRow } from "./hover";
import { ItemIcon, PositionChip, Trailing } from "./LiveFolderBlock";
import { folderChildrenWith } from "./pinnedTree";
import { FaviconFallback, NewTabIcon } from "../primitives";
import { HoverSlot } from "../HoverSlot";
import { SYMBOL_PREFIX, TabIcon } from "./TabIcon";
import { GROUP_COLORS, useArcTitle, useSidebarTokens, withAlpha } from "./tokens";

type TabShot = { kind: "tab"; key: string; title: string; url: string; favicon?: string | null; icon?: string | null; profileId: string; uri: string | null; template: boolean; sound: "muted" | "playing" | null; hovered: boolean };
type SplitShot = { kind: "split"; key: string; panes: TabShot[] };
type LiveItemShot = { key: string; item: LiveItem; indent: number; completion: CompletedItem["state"] | null; unread: boolean };
type LiveRowShot =
  | { kind: "title"; key: string; title: string }
  | { kind: "more"; key: string; count: number }
  | { kind: "stack"; key: string; repo: string; count: number; items: LiveItemShot[] | null }
  | { kind: "item"; key: string; item: LiveItemShot }
  | { kind: "note"; key: string; text: string }
  | { kind: "tab"; key: string; tab: TabShot }
  | { kind: "completed"; key: string; count: number };
type LiveShot = {
  kind: "live";
  key: string;
  name: string;
  custom: string | null;
  icon: string | null;
  site: string;
  githubMark: boolean;
  error: string | null;
  updating: boolean;
  unread: boolean;
  count: number;
  collapsed: boolean;
  rows: LiveRowShot[];
};
export type LiveData = ReturnType<typeof live>;
type GroupShot = {
  kind: "group";
  key: string;
  label: string;
  color: string | null;
  icon: { url: string; favicon?: string | null; icon?: string | null; profileId?: string } | null;
  custom: string | null;
  collapsed: boolean;
  members: EntrySnapshot[];
};
export type EntrySnapshot = TabShot | SplitShot | GroupShot | LiveShot;

function tabShot(s: BrowserState, tabId: string, hovered: boolean): TabShot | null {
  const tab = s.tabs[tabId];
  if (!tab) return null;
  const uri = tab.customIcon ? null : (resolveFavicon(tab.url, tab.favicon, tab.profileId)?.uri ?? null);
  const shape = uri ? useFavicons.getState().themes[uri] : null;
  return {
    uri,
    template: shape?.kind === "template" && !!shape.stroke,
    kind: "tab",
    key: `t:${tabId}`,
    title: tabTitle(tab),
    url: tab.url,
    favicon: tab.favicon,
    icon: tab.customIcon,
    profileId: tab.profileId,
    sound: tab.muted ? "muted" : s.live[tabId]?.playingAudio ? "playing" : null,
    hovered,
  };
}

function splitShot(s: BrowserState, splitId: string): SplitShot {
  const panes = splitRowPanes(s, s.splits[splitId]);
  return { kind: "split", key: `s:${splitId}`, panes: panes.flatMap((id) => tabShot(s, id, false) ?? []) };
}

const COMPLETED_SHOWN_MS = 24 * 3_600_000;

const itemShot = (data: LiveData, folderId: string, item: LiveItem, indent: number): LiveItemShot => ({
  key: item.id,
  item,
  indent,
  completion: data.completing[folderId]?.includes(item.id) ? (data.completed[folderId]?.find((c) => c.item.id === item.id)?.state ?? "merged") : null,
  unread: !!data.unread[folderId]?.includes(item.id),
});

function noteText(data: LiveData, folder: LiveFolder): string {
  const status = data.status[folder.id];
  if (!status || status.state === "initializing" || (status.state === "updating" && !status.lastFetch)) return "Loading…";
  if (status.error) return errorText(status.error.kind, status.error.source);
  const hidden = data.hidden[folder.id]?.length ?? 0;
  if (hidden) return `${hidden} hidden until you refresh`;
  return folder.kind === "pullRequests" ? "No open pull requests" : "No recent documents";
}

function rowShot(data: LiveData, folderId: string, row: FolderRow): LiveRowShot {
  if (row.kind === "header") return { kind: "title", key: row.key, title: row.title };
  if (row.kind === "more") return { kind: "more", key: row.key, count: row.count };
  if (row.kind === "item") return { kind: "item", key: row.key, item: itemShot(data, folderId, row.item, 0) };
  const open = data.expandedStacks[row.id] !== false;
  return { kind: "stack", key: row.key, repo: row.repo.split("/")[1] ?? row.repo, count: row.items.length, items: open ? row.items.map((it) => itemShot(data, folderId, it, 10)) : null };
}

function liveShot(s: BrowserState, windowId: string, profileId: string, folderId: string, data: LiveData, peek: boolean): LiveShot | null {
  const folder = data.folders[folderId];
  if (!folder) return null;
  const items = data.items[folderId] ?? [];
  const rows = folderRows(folder, items, data.showAll);
  const itemIds = new Set(items.map((i) => i.id));
  const hiddenIds = new Set((data.hidden[folderId] ?? []).map((item) => item.id));
  const strays = viewTabIds(s, windowId, profileId).filter((id) => s.tabs[id]?.liveItem?.folderId === folderId && liveTabPlace(s.tabs[id]!.liveItem!.itemId, itemIds, hiddenIds) === "stray");
  const completing = data.completing[folderId] ?? [];
  const completed = folder.showCompleted ? (data.completed[folderId] ?? []).filter((c) => Date.now() - c.at < COMPLETED_SHOWN_MS && !completing.includes(c.item.id)).length : 0;
  const all: LiveRowShot[] = rows.length ? rows.map((row) => rowShot(data, folderId, row)) : [{ kind: "note", key: "note", text: noteText(data, folder) }];
  for (const id of strays) {
    const tab = tabShot(s, id, false);
    if (tab) all.push({ kind: "tab", key: `stray:${id}`, tab });
  }
  if (completed) all.push({ kind: "completed", key: "completed", count: completed });
  const collapsed = folder.collapsed || peek;
  const status = data.status[folderId];
  const initialLoading = !status || status.state === "initializing" || (status.state === "updating" && !status.lastFetch);
  const active = activeTabId(s, windowId, profileId);
  const activeItem = active && s.tabs[active]?.liveItem?.folderId === folderId ? s.tabs[active]!.liveItem!.itemId : null;
  const keep = !activeItem
    ? null
    : strays.includes(active!)
      ? `stray:${active}`
      : (rows.find((r) => (r.kind === "item" && r.item.id === activeItem) || (r.kind === "stack" && r.items.some((i) => i.id === activeItem)))?.key ?? null);
  return {
    kind: "live",
    key: `l:${folderId}`,
    name: folder.name,
    custom: folder.icon,
    icon: liveFolderIcon(folder).icon,
    site: liveFolderIcon(folder).site,
    githubMark: folder.sources[0] === "github" && !initialLoading,
    error: status?.error ? errorText(status.error.kind, status.error.source) : null,
    updating: status?.state === "updating" || status?.state === "initializing",
    unread: (data.unread[folderId]?.length ?? 0) > 0,
    count: items.length,
    collapsed,
    rows: collapsed ? all.filter((r) => r.key === keep) : all,
  };
}

function groupShot(s: BrowserState, windowId: string, profileId: string, groupId: string, data: LiveData, peek: boolean): GroupShot | null {
  const group = s.groups[groupId];
  if (!group) return null;
  const entries = folderChildrenWith(s, windowId, profileId, groupId, data.folders);
  const collapsed = !!group.collapsed || peek;
  const kept = collapsed ? keptEntry(s, windowId, profileId, entries) : null;
  const first = s.tabs[group.tabIds[0] ?? ""];
  return {
    kind: "group",
    key: `g:${groupId}`,
    label: groupLabel(s, group),
    color: group.color ?? null,
    icon: group.icon || first ? { url: first?.url ?? "", favicon: first?.favicon, icon: group.icon ?? first?.customIcon, profileId: first?.profileId } : null,
    custom: group.icon ?? null,
    collapsed,
    members: (collapsed ? (kept ? [kept] : []) : entries).flatMap((e) => memberShot(s, windowId, profileId, e, data, collapsed) ?? []),
  };
}

function memberShot(s: BrowserState, windowId: string, profileId: string, entry: string, data: LiveData, peek: boolean): EntrySnapshot | null {
  const id = entry.slice(2);
  if (entry.startsWith("s:")) return splitShot(s, id);
  if (entry.startsWith("g:")) return groupShot(s, windowId, profileId, id, data, peek);
  if (entry.startsWith("l:")) return liveShot(s, windowId, profileId, id, data, peek);
  return tabShot(s, id, false);
}

export function snapshotEntry(s: BrowserState, windowId: string, profileId: string, entry: string, data: LiveData): EntrySnapshot | null {
  if (entry.startsWith("t:")) return tabShot(s, entry.slice(2), pointerOnRow(entry.slice(2)));
  return memberShot(s, windowId, profileId, entry, data, false);
}

export function ghostEntry(snapshot: EntrySnapshot, theme: ReturnType<typeof useTheme>, top: number, label: string) {
  if (snapshot.kind === "tab") return <TabGhost shot={snapshot} theme={theme} label={label} top={top} />;
  return <View style={{ marginTop: top }}>{memberGhost(snapshot, theme, label)}</View>;
}

function memberGhost(shot: EntrySnapshot, theme: ReturnType<typeof useTheme>, label: string) {
  if (shot.kind === "split") return <SplitGhost key={shot.key} shot={shot} label={label} />;
  if (shot.kind === "group") return <GroupGhost key={shot.key} shot={shot} label={label} />;
  if (shot.kind === "live") return <LiveGhost key={shot.key} shot={shot} label={label} />;
  return <TabGhost key={shot.key} shot={shot} theme={theme} label={label} />;
}

function ghostIcon(shot: TabShot, theme: ReturnType<typeof useTheme>) {
  if (shot.icon?.startsWith(SYMBOL_PREFIX)) return <Symbol name={shot.icon.slice(SYMBOL_PREFIX.length)} size={13} weight="medium" color={theme.icon} style={{ width: 16, height: 16 }} />;
  if (shot.icon) return <TabIcon url={shot.url} icon={shot.icon} profileId={shot.profileId} />;
  if (shot.uri) return <Image source={{ uri: shot.uri }} style={{ width: 16, height: 16, borderRadius: 3, tintColor: shot.template && !theme.dark ? theme.textPrimary : undefined }} />;
  return shot.url ? <FaviconFallback url={shot.url} /> : <NewTabIcon />;
}

function TabGhost({ shot, theme, label, top = 0 }: { shot: TabShot; theme: ReturnType<typeof useTheme>; label: string; top?: number }) {
  const title = useArcTitle() ?? label;
  return (
    <View
      key={shot.key}
      style={{
        marginTop: top,
        height: layout.rowHeight,
        borderRadius: layout.rowRadius,
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: layout.rowPadding,
        paddingRight: shot.hovered ? 6 : 28,
        backgroundColor: shot.hovered ? theme.tabHover : undefined,
      }}
    >
      {ghostIcon(shot, theme)}
      {shot.sound ? <Symbol name={shot.sound === "muted" ? "speaker.slash" : "speaker.wave.2"} size={12} color={theme.textTab} style={{ width: 18, height: 16, marginLeft: 6 }} /> : null}
      <FadeLabel text={shot.title} fontSize={layout.rowFontSize} color={title} style={{ flex: 1, height: 18, marginLeft: layout.rowLabelGap }} />
      {shot.hovered ? <Symbol name="xmark" size={10} weight="semibold" color={theme.icon} style={{ width: 22, height: 22 }} /> : null}
    </View>
  );
}

function SplitGhost({ shot, label }: { shot: SplitShot; label: string }) {
  const theme = useTheme();
  return (
    <View style={{ height: layout.rowHeight, borderRadius: layout.rowRadius, flexDirection: "row", alignItems: "center", paddingHorizontal: 3 }}>
      {shot.panes.map((pane, i) => (
        <View key={pane.key} style={{ flex: 1, flexDirection: "row", alignItems: "center", minWidth: 0 }}>
          {i > 0 && <View style={{ width: 1, height: 16, backgroundColor: theme.divider, marginRight: 2 }} />}
          <View style={{ flex: 1, minWidth: 0, height: layout.rowHeight - 6, flexDirection: "row", alignItems: "center", paddingLeft: 6 }}>
            <TabIcon url={pane.url} favicon={pane.favicon} icon={pane.icon} profileId={pane.profileId} size={14} />
            <FadeLabel text={pane.title} fontSize={12} color={label} style={{ flex: 1, height: 16, marginLeft: 5 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function GroupGhost({ shot, label }: { shot: GroupShot; label: string }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const flat = useAddressBarInSidebar();
  const folderColors = useFolderColors((shot.color as GroupColor | null) ?? null);
  const arcTitle = useArcTitle();
  const spec = shot.color ? GROUP_COLORS[shot.color as keyof typeof GROUP_COLORS] : null;
  const members = shot.members.map((m) => memberGhost(m, theme, label));
  if (flat) {
    return (
      <View>
        <View style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: layout.rowPadding, paddingRight: 6 }}>
          <FolderGlyph colors={folderColors} open={!shot.collapsed} icon={shot.custom} />
          <View style={{ flexShrink: 1, height: 18, marginLeft: layout.rowLabelGap, paddingRight: 8, justifyContent: "center" }}>
            <Text numberOfLines={1} style={{ opacity: 0, fontSize: layout.rowFontSize, fontWeight: "600" }}>
              {shot.label}
            </Text>
            <FadeLabel text={shot.label} fontSize={layout.rowFontSize} weight="semibold" color={arcTitle ?? label} style={{ position: "absolute", left: 0, right: 0, top: 0, height: 18 }} />
          </View>
        </View>
        {members.length ? <View style={{ marginLeft: ARC_FOLDER_INDENT, paddingTop: layout.rowGap, gap: layout.rowGap }}>{members}</View> : null}
      </View>
    );
  }
  const fill = spec ? withAlpha(spec.hex, 0.16) : tokens.groupFill;
  const stroke = spec ? withAlpha(spec.hex, 0.3) : tokens.groupStroke;
  const pad = shot.members.length || !shot.collapsed ? GROUP_PAD : 0;
  return (
    <View style={{ borderRadius: 12, backgroundColor: fill, borderWidth: GROUP_BORDER, borderColor: stroke, paddingHorizontal: GROUP_PAD }}>
      <View style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 6 - GROUP_PAD }}>
        {shot.icon ? <TabIcon url={shot.icon.url} favicon={shot.icon.favicon} icon={shot.icon.icon} profileId={shot.icon.profileId} /> : <View style={{ width: 16 }} />}
        <View style={{ flexShrink: 1, height: 18, marginLeft: 5, paddingRight: 8, justifyContent: "center" }}>
          <Text numberOfLines={1} style={{ opacity: 0, fontSize: 13, fontWeight: "500", fontVariant: ["tabular-nums"] }}>
            {shot.label}
          </Text>
          <FadeLabel text={shot.label} fontSize={13} weight="medium" color={tokens.groupTitle} style={{ position: "absolute", left: 0, right: 0, top: 0, height: 18 }} />
        </View>
        <View style={{ width: 10, height: 10, transform: [{ rotate: shot.collapsed ? "-90deg" : "0deg" }] }}>
          <Symbol name="chevron.down" size={9} weight="semibold" color={withAlpha(tokens.groupTitle, 0.5)} style={{ width: 10, height: 10 }} />
        </View>
      </View>
      <View style={{ gap: layout.rowGap, paddingBottom: pad, paddingLeft: ARC_FOLDER_INDENT }}>{members}</View>
    </View>
  );
}

function LiveGhost({ shot, label }: { shot: LiveShot; label: string }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const colors = useLiveColors();
  const flat = useAddressBarInSidebar();
  const folderColors = useFolderColors(null);
  const arcTitle = useArcTitle();
  const frame = groupFrame(flat);
  const sourceMark = shot.githubMark ? bundledSiteIcon(SOURCES.github.site, theme.dark) : undefined;
  const header = (
    <View style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: flat ? layout.rowPadding : 9 + GROUP_PAD, paddingRight: 6, marginHorizontal: flat ? 0 : -GROUP_PAD }}>
      {flat ? (
        <FolderGlyph colors={folderColors} open={!shot.collapsed} icon={shot.custom} image={sourceMark} dots={sourceMark === undefined} />
      ) : (
        <TabIcon url={shot.site} icon={shot.icon} />
      )}
      <FadeLabel text={shot.name} fontSize={flat ? layout.rowFontSize : 13} weight={flat ? "semibold" : "medium"} color={flat ? (arcTitle ?? label) : tokens.groupTitle} style={{ flex: 1, height: 18, marginLeft: flat ? layout.rowLabelGap : 5 }} />
      {shot.error ? <Symbol name="exclamationmark.triangle.fill" size={10} color={colors.pending} style={{ width: 18, height: 18, marginRight: 2 }} /> : null}
      <HoverSlot hovered={false} hover={null} width={22}>
        {shot.updating ? (
          <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
            <Symbol name="arrow.clockwise" size={10} weight="semibold" color={theme.textSecondary} style={{ width: 14, height: 14 }} />
          </View>
        ) : shot.collapsed ? (
          <View style={{ flexDirection: "row", alignItems: "center", marginRight: 2, gap: 5 }}>
            {shot.unread ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.pip }} /> : null}
            {flat ? null : (
              <View style={{ minWidth: 20, height: 18, borderRadius: 9, paddingHorizontal: 6, backgroundColor: tokens.countPill, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textTab, fontVariant: ["tabular-nums"] }}>{shot.count}</Text>
              </View>
            )}
          </View>
        ) : null}
      </HoverSlot>
    </View>
  );
  const body = shot.rows.length ? (
    <View style={[{ gap: layout.rowGap, paddingTop: frame.padTop, paddingBottom: frame.padBottom }, flat ? { marginLeft: ARC_FOLDER_INDENT } : null]}>
      {shot.rows.map((row) => (
        <View key={row.key}>{liveRowGhost(row, theme, label, flat)}</View>
      ))}
    </View>
  ) : null;
  if (flat) return <View>{header}{body}</View>;
  return (
    <View style={{ borderRadius: GROUP_RADIUS, backgroundColor: tokens.groupFill, borderWidth: GROUP_BORDER, borderColor: tokens.groupStroke, paddingHorizontal: GROUP_PAD }}>
      {header}
      {body}
    </View>
  );
}

function LiveItemGhost({ shot, label, flat }: { shot: LiveItemShot; label: string; flat: boolean }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const arcTitle = useArcTitle();
  const { item, completion, unread, indent } = shot;
  const subtitle = item.pr?.author || item.subtitle;
  const approved = flat && !completion && !!item.pr && prBadge(item.pr) === "approved";
  const subtitleText = approved ? [subtitle, "Approved"].filter(Boolean).join(" · ") : subtitle;
  const color = completion ? theme.textSecondary : (arcTitle ?? label);
  return (
    <View style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: layout.rowPadding + indent, paddingRight: flat ? 7 : 6 }}>
      {unread && !flat ? <View style={{ position: "absolute", left: 2 + indent, width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.pip }} /> : null}
      <ItemIcon item={item} completion={completion} colors={colors} flat={flat} approved={approved} animate={false} />
      {flat && subtitle ? (
        <View style={{ flex: 1, marginLeft: layout.rowLabelGap }}>
          <FadeLabel text={item.title} fontSize={layout.rowFontSize} color={color} style={{ height: 18 }} />
          <FadeLabel text={subtitleText} fontSize={12} color={theme.textSecondary} style={{ height: 14 }} />
        </View>
      ) : (
        <FadeLabel text={item.title} fontSize={layout.rowFontSize} weight={unread && !flat ? "medium" : undefined} color={color} style={{ flex: 1, height: 18, marginLeft: layout.rowLabelGap }} />
      )}
      {indent > 0 && item.pr?.stack ? <PositionChip position={item.pr.stack.position} /> : null}
      <HoverSlot hovered={false} hover={null} width={22}>
        {unread && flat ? (
          <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.textPrimary, opacity: 0.9 }} />
          </View>
        ) : null}
        <Trailing item={item} completion={completion} colors={colors} approved={approved} />
      </HoverSlot>
    </View>
  );
}

function liveRowGhost(row: LiveRowShot, theme: ReturnType<typeof useTheme>, label: string, flat: boolean) {
  const secondary = (height: number, text: string, symbol?: string, top = false) => (
    <View style={{ height, flexDirection: "row", alignItems: top ? "flex-end" : "center", paddingLeft: 9, paddingBottom: top ? 2 : 0 }}>
      {symbol ? <Symbol name={symbol} size={11} color={theme.textSecondary} style={{ width: 16, height: 16, marginRight: 5 }} /> : null}
      <Text numberOfLines={1} style={{ flex: 1, fontSize: top ? 11 : 12, fontWeight: top ? "600" : undefined, color: theme.textSecondary }}>
        {text}
      </Text>
    </View>
  );
  switch (row.kind) {
    case "title":
      return secondary(22, row.title, undefined, true);
    case "more":
      return secondary(26, `Show ${row.count} More`, "ellipsis");
    case "note":
      return secondary(28, row.text);
    case "completed":
      return secondary(24, `${row.count} Completed`, "checkmark.circle");
    case "tab":
      return <TabGhost shot={row.tab} theme={theme} label={label} />;
    case "item":
      return <LiveItemGhost shot={row.item} label={label} flat={flat} />;
    case "stack":
      return (
        <View>
          {secondary(26, `${row.repo} stack`, "square.stack.3d.up")}
          {row.items ? <View style={{ paddingTop: layout.rowGap, gap: layout.rowGap }}>{row.items.map((item) => <LiveItemGhost key={item.key} shot={item} label={label} flat={flat} />)}</View> : null}
        </View>
      );
  }
}
