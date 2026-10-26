import { FadeLabel, Surface, Symbol } from "@ardia/shell";
import { Animated, Text, View } from "react-native";
import { hex, layout, useTheme } from "../../lib/theme";
import { liveFolderIcon } from "../../live/sources";
import { useLive } from "../../live/store";
import { useBrowser } from "../../store/browser";
import { groupLabel } from "../../store/organize";
import { tabTitle } from "./actions";
import { useTabDrag } from "../layout/tabDrag";
import { useDropLine, type Ghost } from "./dnd";
import { FolderMosaic } from "./FolderTile";
import { useAddressBarInSidebar } from "../layout/windowLayout";
import { FolderGlyph, useFolderColors } from "./FolderGlyph";
import { TabIcon } from "./TabIcon";
import { useArcLabel, useArcTitle, useSidebarTokens } from "./tokens";

const LIFTED_FILL = "rgba(255,255,255,0.15)";
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
  const tab = useBrowser((s) => s.tabs[item.tabIds[0] ?? ""]);
  const label = useBrowser((s) => (item.groupId && s.groups[item.groupId] ? groupLabel(s, s.groups[item.groupId]!) : tab ? tabTitle(tab) : ""));
  const group = useBrowser((s) => (item.groupId ? s.groups[item.groupId] : undefined));
  const liveFolder = useLive((s) => (item.liveId ? s.folders[item.liveId] : undefined));
  const folderColors = useFolderColors(group?.color ?? null);
  const flat = useAddressBarInSidebar();
  const arcLabel = useArcLabel();
  const arcTitle = useArcTitle();
  const tile = item.kind === "tile";
  const groupRow = item.kind === "group" || item.kind === "live";
  const folderTile = tile && !!item.folderId;
  const liveIcon = liveFolder ? liveFolderIcon(liveFolder) : null;
  const onPage = useTabDrag((d) => d.onPage);
  const face = ghost.face;
  if (face)
    return (
      <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height, opacity: onPage ? 0 : 1, transform: position.getTranslateTransform() }}>
        <View style={{ width, height, flexDirection: "row", alignItems: "center", paddingLeft: layout.rowPadding, paddingRight: 6, borderRadius: layout.rowRadius, backgroundColor: theme.dark ? LIFTED_FILL : tokens.selectedFill }}>
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
      <Surface
        fill={hex(tokens.dragSilhouette)}
        cornerRadius={flat && !tile ? layout.rowRadius : 10}
        borderColor={hex(tokens.dragBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.dark ? 0.45 : 0.18}
        shadowRadius={10}
        shadowOffset={[0, 4]}
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
        {folderTile ? <FolderMosaic tabIds={item.tabIds} /> : liveIcon && !flat ? (
          <TabIcon url={liveIcon.site} icon={liveIcon.icon} />
        ) : flat && groupRow ? (
          <FolderGlyph colors={folderColors} open={!item.collapsed} icon={liveFolder ? liveFolder.icon : group?.icon} />
        ) : group?.icon || tab ? (
          <TabIcon url={tab?.url ?? ""} favicon={tab?.favicon} icon={group?.icon ?? tab?.customIcon} profileId={tab?.profileId} />
        ) : null}
        {!tile ? (
          <FadeLabel
            text={liveFolder ? liveFolder.name : label}
            fontSize={flat ? layout.rowFontSize : 13}
            weight={groupRow ? (flat ? "semibold" : "medium") : "regular"}
            color={(item.kind === "row" || item.kind === "group" || item.kind === "live" ? arcTitle : null) ?? arcLabel ?? (flat && groupRow ? theme.textTab : theme.textPrimary)}
            style={{ flex: 1, height: 18, marginLeft: flat ? layout.rowLabelGap : 7 }}
          />
        ) : null}
      </Surface>
      {count > 1 && !folderTile ? (
        <View style={{ position: "absolute", top: -6, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: "#FFFFFF" }}>{count}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}
