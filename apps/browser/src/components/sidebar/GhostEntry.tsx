import { Image, Text, View } from "react-native";
import { FadeLabel, font, Symbol, weight, withAlpha } from "../ui";
import { HoverSlot } from "../ui/HoverSlot";
import { layout, useTheme } from "../ui/theme";
import { bundledSiteIcon } from "../favicon/siteIcons";
import { FaviconFallback, NewTabIcon } from "../favicon/Favicon";
import { SOURCES } from "../../state/live/sources";
import type { FolderRow } from "../../state/live/rows";
import type { LiveData } from "../../state/sidebar/listCapture";
import { groupFrame } from "../../state/sidebar/geometry";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { iconSymbol } from "../../lib/customIcon";
import { useLiveColors } from "../live/tokens";
import { ARC_FOLDER_INDENT, GROUP_BORDER, GROUP_PAD, GROUP_RADIUS } from "./geometry";
import { FolderGlyph, useFolderColors } from "./FolderGlyph";
import { ItemIcon, LiveSubtitle, Trailing } from "./LiveItemRow";
import { TabIcon } from "./TabIcon";
import { groupSurface, TABULAR_NUMS, useArcLabel, useArcTitle, useSidebarTokens } from "./tokens";
import { itemShot, rowShot, type EntrySnapshot, type GroupShot, type LiveItemShot, type LiveRowShot, type LiveShot, type SplitShot, type TabShot } from "./ghostShots";

export function LiveRowGhost({ data, folderId, row, indent = 0 }: { data: LiveData; folderId: string; row: FolderRow; indent?: number }) {
  const theme = useTheme();
  const flat = useAddressBarInSidebar();
  const label = useArcLabel() ?? theme.textTab;
  const shot: LiveRowShot =
    row.kind === "item"
      ? { kind: "item", key: row.key, item: itemShot(data, folderId, row.item, indent, row.done ?? null) }
      : row.kind === "stack"
        ? { kind: "stack", key: row.key, repo: row.repo.split("/")[1] ?? row.repo, count: row.items.length, items: null }
        : rowShot(data, folderId, row);
  return <View>{liveRowGhost(shot, theme, label, flat)}</View>;
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
  const symbol = iconSymbol(shot.icon);
  if (symbol) return <Symbol name={symbol} size={13} weight="medium" color={theme.icon} style={{ width: 16, height: 16 }} />;
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
  const folderColors = useFolderColors(shot.color);
  const arcTitle = useArcTitle();
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
  const { fill, stroke } = groupSurface(shot.color, tokens);
  const pad = shot.members.length || !shot.collapsed ? GROUP_PAD : 0;
  return (
    <View style={{ paddingVertical: GROUP_BORDER, paddingHorizontal: GROUP_PAD }}>
      {shot.hovered ? <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: GROUP_RADIUS, backgroundColor: fill, borderWidth: GROUP_BORDER, borderColor: stroke }} /> : null}
      <View style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 6 - GROUP_PAD }}>
        {shot.icon ? <TabIcon url={shot.icon.url} favicon={shot.icon.favicon} icon={shot.icon.icon} profileId={shot.icon.profileId} /> : <View style={{ width: 16 }} />}
        <View style={{ flexShrink: 1, height: 18, marginLeft: 5, paddingRight: 8, justifyContent: "center" }}>
          <Text numberOfLines={1} style={{ opacity: 0, ...font.body, fontWeight: weight.medium, fontVariant: TABULAR_NUMS }}>
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
            {shot.unread ? <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: theme.accent }} /> : null}
            {flat ? null : (
              <View style={{ minWidth: 20, height: 18, borderRadius: 9, paddingHorizontal: 6, backgroundColor: tokens.countPill, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: theme.textTab, fontVariant: TABULAR_NUMS }}>{shot.count}</Text>
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
  const { item, completing, done, dot, unread, indent } = shot;
  const completion = completing ?? done;
  const subtitle = item.pr?.author || item.subtitle;
  const color = completing ? theme.textSecondary : (arcTitle ?? label);
  return (
    <View style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: layout.rowPadding + indent, paddingRight: flat ? 7 : 6 }}>
      {dot && !flat ? <View style={{ position: "absolute", left: 2 + indent, width: 5, height: 5, borderRadius: 2.5, backgroundColor: theme.accent }} /> : null}
      <ItemIcon item={item} completing={completing} done={done} colors={colors} animate={false} />
      {flat && subtitle ? (
        <View style={{ flex: 1, marginLeft: layout.rowLabelGap }}>
          <FadeLabel text={item.title} fontSize={layout.rowFontSize} color={color} style={{ height: 18 }} />
          <LiveSubtitle item={item} subtitle={subtitle} done={completion} colors={colors} />
        </View>
      ) : (
        <FadeLabel text={item.title} fontSize={layout.rowFontSize} weight={unread && !flat ? "medium" : undefined} color={color} style={{ flex: 1, height: 18, marginLeft: layout.rowLabelGap }} />
      )}
      <HoverSlot hovered={false} hover={null} width={22}>
        {dot && flat ? (
          <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.textPrimary, opacity: 0.9 }} />
          </View>
        ) : null}
        <Trailing item={item} completion={completion} colors={colors} flat={flat} />
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
