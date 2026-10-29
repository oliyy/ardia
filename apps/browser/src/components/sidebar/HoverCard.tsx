import { FadeLabel, Surface } from "@ardia/shell";
import { useLayoutEffect, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useStoreWhile } from "../../store/tabWatch";
import { plural } from "../../store/model";
import { folderIn, folderLabel, folderMembers } from "../../store/tileFolders";
import { useShallow } from "zustand/react/shallow";
import { useFolderPanel } from "./tileFolderUi";
import { CalendarPreview, useIsCalendarTab } from "../live/CalendarPreview";
import { LiveItemCard } from "../live/LiveItemCard";
import { clickTab, tabTitle } from "./actions";
import { GroupPanel } from "./GroupPanel";
import { cardHoverProps, dismissHover, setHoverSpace } from "./hover";
import { hoverCardOrigin, useHoverCardMotion, useHoverCardPlacement } from "./hoverMotion";
import { useSidebarUi, type Anchor, type Hover } from "./state";
import { TabIcon } from "./TabIcon";
import { HoverPlayer, usePlayerEdge, useShowsMiniPlayer } from "../media/HoverPlayer";

const WIDTH = 264;

export function HoverCard({ windowId, width, height }: { windowId: string; width: number; height: number }) {
  const hover = useSidebarUi((u) => (u.hover?.windowId === windowId ? u.hover : null));
  const orphaned = useStoreWhile(
    useBrowser,
    !!hover,
    (s) => (hover?.kind === "tab" && !s.tabs[hover.id]) || (hover?.kind === "group" && !s.groups[hover.id]) || (hover?.kind === "folder" && !folderIn(s, windowId, hover.id)),
  );
  useLayoutEffect(() => {
    if (orphaned) dismissHover();
  }, [orphaned]);
  useLayoutEffect(() => setHoverSpace(windowId, height), [windowId, height]);
  const target = orphaned ? null : hover;
  const { drawn, leaving, entering, motion } = useHoverCardMotion(windowId, target);
  const shown = drawn ?? target;
  const tabId = shown?.kind === "tab" ? shown.id : undefined;
  const player = useShowsMiniPlayer(tabId);
  const calendar = useIsCalendarTab(tabId ?? null);
  const blank = !!tabId && shown === hover && !player && !calendar;
  useLayoutEffect(() => {
    if (blank) dismissHover();
  }, [blank]);
  const edge = usePlayerEdge(windowId, shown?.anchor);
  useHoverCardPlacement(motion, shown ? hoverCardOrigin(shown.anchor, player ? edge : undefined) : null, { width, height });
  if (!shown) return null;
  return (
    <Animated.View pointerEvents={leaving || entering ? "none" : "box-none"} style={[StyleSheet.absoluteFill, motion.style]}>
      <HoverContent hover={shown} windowId={windowId} player={player} calendar={calendar} windowHeight={height} />
    </Animated.View>
  );
}

function HoverContent({ hover, windowId, player, calendar, windowHeight }: { hover: Hover; windowId: string; player: boolean; calendar: boolean; windowHeight: number }) {
  if (hover.kind === "live") return <LiveItemCard id={hover.id} windowId={windowId} anchor={hover.anchor} />;
  if (hover.kind === "tab" && player) return <HoverPlayer tabId={hover.id} windowId={windowId} anchor={hover.anchor} />;
  if (hover.kind === "tab" && calendar) return <CalendarPreview tabId={hover.id} windowId={windowId} anchor={hover.anchor} />;
  if (hover.kind === "folder") return <FolderPeek folderId={hover.id} windowId={windowId} anchor={hover.anchor} />;
  if (hover.kind === "group") return <GroupPanel key={`${windowId}:${hover.id}`} groupId={hover.id} windowId={windowId} anchor={hover.anchor} windowHeight={windowHeight} />;
  return null;
}

function Card({ anchor, children }: { anchor: Anchor; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Surface
      {...cardHoverProps}
      fill={hex(theme.panel)}
      cornerRadius={12}
      borderColor={hex(theme.panelBorder)}
      borderWidth={0.5}
      shadowColor="#000000"
      shadowOpacity={theme.panelShadowOpacity * 0.8}
      shadowRadius={16}
      shadowOffset={[0, 6]}
      style={{ position: "absolute", ...hoverCardOrigin(anchor), width: WIDTH, padding: 10 }}
    >
      {children}
    </Surface>
  );
}

const PEEK_ROWS = 8;

function FolderPeek({ folderId, windowId, anchor }: { folderId: string; windowId: string; anchor: Anchor }) {
  const theme = useTheme();
  const members = useBrowser(useShallow((s) => folderMembers(s, windowId, folderId)));
  const label = useBrowser((s) => folderLabel(folderIn(s, windowId, folderId)));
  const open = useFolderPanel((u) => u.open?.windowId === windowId && u.open.folderId === folderId);
  if (open || !members.length) return null;
  const more = members.length - PEEK_ROWS;
  return (
    <Card anchor={anchor}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: theme.textSecondary, marginBottom: 4, marginLeft: 4 }}>
        {label} · {plural(members.length, "tab")}
      </Text>
      {members.slice(0, PEEK_ROWS).map((id) => (
        <PeekRow key={id} tabId={id} windowId={windowId} />
      ))}
      {more > 0 ? <Text style={{ fontSize: 11.5, color: theme.textTertiary, marginTop: 4, marginLeft: 4 }}>and {more} more</Text> : null}
    </Card>
  );
}

function PeekRow({ tabId, windowId }: { tabId: string; windowId: string }) {
  const theme = useTheme();
  const tab = useBrowser((s) => s.tabs[tabId]);
  const [hovered, setHovered] = useState(false);
  if (!tab) return null;
  return (
    <Pressable
      onPress={() => {
        dismissHover();
        clickTab(windowId, tabId);
      }}
    >
      <View
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ height: 28, borderRadius: 7, flexDirection: "row", alignItems: "center", paddingHorizontal: 5, backgroundColor: hovered ? theme.rowHover : undefined }}
      >
        <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} profileId={tab.profileId} />
        <FadeLabel text={tabTitle(tab)} fontSize={12.5} color={theme.textTab} style={{ flex: 1, height: 17, marginLeft: 7 }} />
      </View>
    </Pressable>
  );
}
