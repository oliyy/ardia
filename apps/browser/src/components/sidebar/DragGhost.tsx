import { Animated, Text, View } from "react-native";
import { FadeLabel, font, ink, Panel, radius, Symbol, weight } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { liveFolderIcon } from "../../state/live/sources";
import { useLive } from "../../state/live/store";
import { useGroup, useTab } from "../../state/browser/hooks";
import { useDragGhostLabel } from "../../state/sidebar/hooks";
import { useTabDrag } from "../../state/drag/tabDrag";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import type { Ghost } from "./dragModel";
import { useDropLine } from "./DragProvider";
import { FolderMosaic } from "./FolderTile";
import { FolderGlyph, useFolderColors } from "./FolderGlyph";
import { TabIcon } from "./TabIcon";
import { DRAG_LIFTED_FILL, SIDEBAR_SHADOW, useArcLabel, useArcTitle, useSidebarTokens } from "./tokens";
import { folderOf } from "./dragModel";

const LINE = 2;
const RING = 8;
const RING_INSET = 10;
const LINE_OPACITY = 0.88;

export function DropLine() {
  const line = useDropLine();
  const theme = useTheme();
  if (!line) return null;
  const left = line.x + RING_INSET - RING / 2;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left, top: line.y - RING / 2, width: line.x + line.w - 1 - left, height: RING, opacity: LINE_OPACITY }}>
      <View style={{ position: "absolute", left: RING, right: 0, top: (RING - LINE) / 2, height: LINE, backgroundColor: theme.textPrimary }} />
      <View style={{ position: "absolute", left: 0, top: 0, width: RING, height: RING, borderRadius: RING / 2, borderWidth: LINE, borderColor: theme.textPrimary }} />
    </View>
  );
}

export function DragGhost({ ghost }: { ghost: Ghost }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const { item, count, width, height, position } = ghost;
  const tab = useTab(item.tabIds[0] ?? "");
  const liveFolderId = item.kind === "live" ? item.liveFolderId : undefined;
  const groupId = item.kind === "group" ? item.groupId : undefined;
  const folder = useLive((s) => (liveFolderId ? s.folders[liveFolderId] : undefined));
  const liveIcon = folder ? liveFolderIcon(folder) : null;
  const groupIcon = useGroup(groupId ?? null, (g) => g?.icon ?? null);
  const groupColor = useGroup(groupId ?? null, (g) => g?.color ?? null);
  const folderColors = useFolderColors(groupColor);
  const label = useDragGhostLabel(folder?.name, groupId, tab);
  const flat = useAddressBarInSidebar();
  const arcLabel = useArcLabel();
  const arcTitle = useArcTitle();
  const tile = item.kind === "tile";
  const groupRow = item.kind === "group" || item.kind === "live";
  const folderTile = !!folderOf(item);
  const onPage = useTabDrag((d) => d.phase === "tab" && d.onPage);
  const face = ghost.face;
  if (face)
    return (
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height, opacity: onPage ? 0 : 1, transform: position.getTranslateTransform() }}>
        <View style={{ width, height, flexDirection: "row", alignItems: "center", paddingLeft: layout.rowPadding, paddingRight: 6, borderRadius: layout.rowRadius, backgroundColor: theme.dark ? DRAG_LIFTED_FILL : tokens.selectedFill }}>
          <TabIcon url={face.url} favicon={face.favicon} icon={face.icon} profileId={face.profileId} />
          <FadeLabel text={face.title} fontSize={layout.rowFontSize} weight="regular" color={arcTitle ?? arcLabel ?? theme.textPrimary} style={{ flex: 1, height: 18, marginLeft: layout.rowLabelGap }} />
          <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
            <Symbol name="xmark" size={10} weight="semibold" color={theme.textTab} style={{ width: 12, height: 12 }} />
          </View>
        </View>
      </Animated.View>
    );
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height, opacity: onPage ? 0 : 1, transform: position.getTranslateTransform() }}>
      <Panel
        fill={tokens.dragSilhouette}
        radius={flat && !tile ? layout.rowRadius : radius.card}
        border={tokens.dragBorder}
        shadow={SIDEBAR_SHADOW.dragGhost}
        style={{
          width,
          height: tile ? layout.pinnedHeight : height,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: tile ? "center" : "flex-start",
          paddingLeft: tile ? 0 : flat ? layout.rowPadding : 9,
          paddingRight: 6,
          opacity: 0.96,
        }}
      >
        {folderTile ? (
          <FolderMosaic tabIds={item.tabIds} />
        ) : liveIcon && !flat ? (
          <TabIcon url={liveIcon.site} icon={liveIcon.icon} />
        ) : flat && groupRow ? (
          <FolderGlyph colors={folderColors} open={!item.collapsed} icon={folder ? folder.icon : groupIcon} />
        ) : groupIcon || tab ? (
          <TabIcon url={tab?.url ?? ""} favicon={tab?.favicon} icon={groupIcon ?? tab?.customIcon} profileId={tab?.profileId} />
        ) : null}
        {!tile ? (
          <FadeLabel
            text={label}
            fontSize={flat ? layout.rowFontSize : font.body.fontSize}
            weight={groupRow ? (flat ? "semibold" : "medium") : "regular"}
            color={(item.kind === "row" || groupRow ? arcTitle : null) ?? arcLabel ?? (flat && groupRow ? theme.textTab : theme.textPrimary)}
            style={{ flex: 1, height: 18, marginLeft: flat ? layout.rowLabelGap : 7 }}
          />
        ) : null}
      </Panel>
      {count > 1 && !folderTile ? (
        <View style={{ position: "absolute", top: -6, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ ...font.caption, fontWeight: weight.bold, color: ink.white }}>{count}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}
