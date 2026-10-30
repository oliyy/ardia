import { useLayoutEffect, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ui/theme";
import { useTab } from "../../state/browser/hooks";
import { plural, tabTitle } from "../../state/browser/model";
import { useTileFolderLabel, useTileFolderMembers } from "../../state/pins/hooks";
import { useHoverOrphaned } from "../../state/sidebar/hooks";
import { useFolderPanel } from "../../state/sidebar/tileFolderUi";
import { CalendarPreview, useIsCalendarTab } from "../live/CalendarPreview";
import { LiveItemCard } from "../live/LiveItemCard";
import { FadeLabel, font, Panel, radius, weight } from "../ui";
import { SIDEBAR_SHADOW, SIDEBAR_TYPE } from "./tokens";
import { clickTab } from "../../state/sidebar/actions";
import { GroupPanel } from "./GroupPanel";
import { dismissHover, setHoverSpace } from "../../state/sidebar/hover";
import { cardHoverProps } from "./hoverController";
import { hoverCardOrigin, useHoverCardMotion, useHoverCardPlacement } from "./hoverMotion";
import { useSidebarUi, type Anchor, type Hover } from "../../state/sidebar/sidebarUi";
import { TabIcon } from "./TabIcon";
import { HoverPlayer, usePlayerEdge, useShowsMiniPlayer } from "../media/HoverPlayer";

const WIDTH = 264;

export function HoverCard({ windowId, width, height }: { windowId: string; width: number; height: number }) {
  const hover = useSidebarUi((u) => (u.hover?.windowId === windowId ? u.hover : null));
  const orphaned = useHoverOrphaned(windowId, hover);
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
    <Panel
      {...cardHoverProps}
      fill={theme.panel}
      radius={radius.panel}
      border={theme.panelBorder}
      shadow={SIDEBAR_SHADOW.card}
      style={{ position: "absolute", ...hoverCardOrigin(anchor), width: WIDTH, padding: 10 }}
    >
      {children}
    </Panel>
  );
}

const PEEK_ROWS = 8;

function FolderPeek({ folderId, windowId, anchor }: { folderId: string; windowId: string; anchor: Anchor }) {
  const theme = useTheme();
  const members = useTileFolderMembers(windowId, folderId);
  const label = useTileFolderLabel(windowId, folderId);
  const open = useFolderPanel((u) => u.open?.windowId === windowId && u.open.folderId === folderId);
  if (open || !members.length) return null;
  const more = members.length - PEEK_ROWS;
  return (
    <Card anchor={anchor}>
      <Text style={{ ...font.small, fontWeight: weight.semibold, color: theme.textSecondary, marginBottom: 4, marginLeft: 4 }}>
        {label} · {plural(members.length, "tab")}
      </Text>
      {members.slice(0, PEEK_ROWS).map((id) => (
        <PeekRow key={id} tabId={id} windowId={windowId} />
      ))}
      {more > 0 ? <Text style={{ ...font.footnote, color: theme.textTertiary, marginTop: 4, marginLeft: 4 }}>and {more} more</Text> : null}
    </Card>
  );
}

function PeekRow({ tabId, windowId }: { tabId: string; windowId: string }) {
  const theme = useTheme();
  const tab = useTab(tabId);
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
        style={{ height: 28, borderRadius: radius.button, flexDirection: "row", alignItems: "center", paddingHorizontal: 5, backgroundColor: hovered ? theme.rowHover : undefined }}
      >
        <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={14} profileId={tab.profileId} />
        <FadeLabel text={tabTitle(tab)} fontSize={SIDEBAR_TYPE.compact} color={theme.textTab} style={{ flex: 1, height: 17, marginLeft: 7 }} />
      </View>
    </Pressable>
  );
}
