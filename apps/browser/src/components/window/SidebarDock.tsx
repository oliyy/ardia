import { onWindowEvent, watchLeftEdge } from "../../state/windows/nativeWindow";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchOn } from "../../state/app/switches";
import { layout, useTheme } from "../ui/theme";
import { ContextMenuArea, Panel, WindowDragRegion } from "../ui";
import { SHADOWS } from "./tokens";
import { useWindowId } from "../../state/browser/hooks";
import { useSidebarDockState } from "../../state/windows/hooks";
import { useCardGeometry, useToolbarLightsCenter } from "../../state/windows/layout";
import { Sidebar } from "../sidebar/Sidebar";
import { dismissHoverIn } from "../../state/sidebar/hover";
import { useSidebarUi } from "../../state/sidebar/sidebarUi";
import { peekHeld, watchHolds } from "../../state/app/transientUi";
import { ProfileSwipe } from "./ProfileSwipe";
import {
  PEEK_BOTTOM,
  PEEK_ORIGIN,
  PEEK_EDGE_STRIP,
  PEEK_RADIUS,
  dockState,
  dockedCardLeft,
  inPeekHold,
  leftEdgeWatchWidth,
  peekHoldWidth,
  shownAs,
  watchesLeftEdge,
} from "./dockMotion";
import { ARC_LIGHTS_CENTER, devPeeks, setPeekShown, useDockMotion } from "../../state/windows/dockMotion";
import { useTabDrag } from "../../state/drag/tabDrag";
import { usePeek } from "./usePeek";
import { TabDropArea, type TabDropTarget } from "./TabDropArea";
import { UNDOCKED, useSidebarDock, type CardShift, type DockLink } from "./useSidebarDock";
import { useTopStripLights, useTrafficLights } from "./useDockLights";

export type { DockLink } from "./useSidebarDock";

const IGNORE = () => {};
const CardShiftContext = createContext<CardShift>({ placed: false, attach: IGNORE, link: UNDOCKED });
const DockReceiptContext = createContext<number | undefined>(undefined);

export const useDockReceipt = () => useContext(DockReceiptContext);

type Inset = { top: number; right: number; bottom: number; left: number };

export function DockedLayout({
  fullscreen,
  topTabs,
  inset,
  topStrip,
  children,
}: {
  fullscreen: boolean;
  topTabs: boolean;
  inset: Inset;
  topStrip?: { strip: ReactNode; peek: ReactNode };
  children: ReactNode;
}) {
  const windowId = useWindowId();
  const [open, fittedWidth, addressBar] = useSidebarDockState(windowId);
  const [dragged, receipt] = useSidebarUi(useShallow((u) => [u.dragWidth[windowId], u.dragReceipt[windowId]] as const));
  const width = dragged ?? fittedWidth;
  const resizing = dragged !== undefined;
  const arc = addressBar && !topTabs && switchOn("sidebarSlide");
  const toolbarLights = useToolbarLightsCenter();
  const lights = addressBar && !topTabs ? ARC_LIGHTS_CENTER : toolbarLights;
  const tabDragging = useTabDrag((d) => d.phase === "tab" && d.windowId === windowId);
  const placed = !topTabs && !fullscreen;
  const docked = dockedCardLeft(width);
  const { dock, wide, away, card } = useSidebarDock(open, topTabs ? !fullscreen : placed && !tabDragging, arc, placed, inset.left, docked - inset.left, tabDragging);
  const top = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [layout.cardInset, inset.top] }), [dock, inset.top]);
  const stripY = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [-inset.top, 0] }), [dock, inset.top]);
  const stripShown = topTabs && (open || !away);
  const moving = useDockMotion((m) => !!m.moving[windowId]);
  useTopStripLights(windowId, dock, topTabs && !fullscreen, inset.top, open);
  return (
    <CardShiftContext.Provider value={card}>
      <Animated.View
        style={
          fullscreen
            ? { flex: 1 }
            : {
                flex: 1,
                flexDirection: "row",
                paddingTop: topTabs ? top : inset.top,
                paddingRight: inset.right,
                paddingBottom: inset.bottom,
                paddingLeft: topTabs || wide ? inset.left : docked,
              }
        }
      >
        {!fullscreen && <WindowDragRegion style={StyleSheet.absoluteFill} />}
        <DockReceiptContext.Provider value={receipt}>{children}</DockReceiptContext.Provider>
      </Animated.View>
      {topStrip &&
        stripShown && (
          <Animated.View
            pointerEvents={fullscreen || moving ? "none" : "auto"}
            style={[{ position: "absolute", left: 0, right: 0 }, fullscreen ? { bottom: "100%" } : { top: 0, transform: [{ translateY: stripY }] }]}
          >
            {topStrip.strip}
          </Animated.View>
        )}
      {topStrip && topTabs && !stripShown && topStrip.peek}
      {!topTabs && <SidebarDock dock={dock} open={open} width={width} resizing={resizing} receipt={receipt} fullscreen={fullscreen} arc={arc} lights={lights} />}
    </CardShiftContext.Provider>
  );
}

export function DockShift({ children }: { children: (link: DockLink) => ReactNode }) {
  const windowId = useWindowId();
  const { placed, attach, link } = useContext(CardShiftContext);
  const { shift } = link;
  const moving = useDockMotion((m) => !!m.moving[windowId]);
  const radius = useCardGeometry().radius;
  const refuse = useMemo<TabDropTarget>(() => ({ windowId, accepts: () => false, enter: IGNORE, move: IGNORE, leave: IGNORE, drop: () => null }), [windowId]);
  const clipped = moving && placed;
  return (
    <View ref={attach} pointerEvents="box-none" style={{ flex: 1, overflow: clipped ? "hidden" : "visible", borderRadius: clipped ? radius : 0 }}>
      <Animated.View pointerEvents="box-none" style={{ flex: 1, transform: [{ translateX: shift }] }}>
        {children(link)}
      </Animated.View>
      <View pointerEvents={moving ? "auto" : "none"} style={StyleSheet.absoluteFill}>
        <TabDropArea target={refuse} style={StyleSheet.absoluteFill}>
          <ContextMenuArea captureDescendants onContextMenu={IGNORE} style={StyleSheet.absoluteFill}>
            <Pressable focusable={false} style={StyleSheet.absoluteFill} />
          </ContextMenuArea>
        </TabDropArea>
      </View>
    </View>
  );
}

function SidebarDock({
  dock,
  open,
  width,
  resizing,
  receipt,
  fullscreen,
  arc,
  lights,
}: {
  dock: Animated.Value;
  open: boolean;
  width: number;
  resizing: boolean;
  receipt: number | undefined;
  fullscreen: boolean;
  arc: boolean;
  lights: readonly [number, number];
}) {
  const theme = useTheme();
  const windowId = useWindowId();
  const cardInset = useCardGeometry().inset;
  const moving = useDockMotion((m) => !!m.moving[windowId]);
  const edgeOver = useRef(false);
  const peek = usePeek(!open && !moving && !fullscreen, arc, () => edgeOver.current || peekHeld(windowId), () => dismissHoverIn(windowId));
  const latestPeek = useRef(peek);
  latestPeek.current = peek;
  useEffect(() => (peek.live ? watchHolds("peek", () => latestPeek.current.recheck()) : undefined), [peek.live]);
  const state = dockState({ open, fullscreen, moving, peekLive: peek.live });
  const holdWidth = peekHoldWidth(width);
  const holdHeight = useRef(Infinity);
  const inHold = (x: number, y: number) => inPeekHold(x, y, holdWidth, holdHeight.current);
  const peeking = state === "peeking";
  const shown = shownAs(state);
  useLayoutEffect(() => () => dismissHoverIn(windowId), [windowId, shown]);
  const watching = watchesLeftEdge(state, moving);
  const draggingTab = useTabDrag((d) => d.phase === "tab" && d.windowId === windowId);
  const nativeHold = leftEdgeWatchWidth(peeking, draggingTab, holdWidth);
  useEffect(() => {
    if (!watching) return;
    const sub = onWindowEvent((e) => {
      if (e.type !== "leftEdge" || e.id !== windowId) return;
      edgeOver.current = e.over;
      if (e.over) latestPeek.current.show();
      else latestPeek.current.hide();
    });
    watchLeftEdge(windowId, true, nativeHold);
    return () => {
      sub.remove();
      watchLeftEdge(windowId, false);
      edgeOver.current = false;
    };
  }, [windowId, watching, nativeHold]);
  useEffect(() => setPeekShown(windowId, peek.live, PEEK_ORIGIN[0] + width), [windowId, peek.live, width]);
  if (__DEV__) devPeeks[windowId] = peek;
  useEffect(() => () => setPeekShown(windowId, false), [windowId]);
  const panel = useRef(false);
  if (peeking) panel.current = true;
  const away = state === "fullscreen" || state === "away";
  const slideOut = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }), [dock, width]);
  const peekIn = useMemo(
    () => peek.slide.interpolate({ inputRange: [0, 1], outputRange: [-12, width] }),
    [peek.slide, width],
  );
  useTrafficLights(windowId, dock, peek.slide, { width, peeking, fullscreen, lights });
  const sidebar = useMemo(
    () => (
      <ProfileSwipe>
        <Sidebar width={width} resizing={resizing} receipt={receipt} />
      </ProfileSwipe>
    ),
    [width, resizing, receipt],
  );

  const leaveStrip = (e: { nativeEvent: { clientX: number; clientY: number } }) => {
    if (peek.live && !inHold(e.nativeEvent.clientX, e.nativeEvent.clientY)) peek.hide();
  };

  const strip = useRef(false);
  if (!open) strip.current = true;
  const fade = peeking && !arc;
  const panelOn = useRef(new Animated.Value(0)).current;
  useLayoutEffect(() => panelOn.setValue(peeking ? 1 : 0), [panelOn, peeking]);
  const panelOpacity = useMemo(
    () => (arc ? panelOn : Animated.multiply(panelOn, peek.slide)),
    [arc, panelOn, peek.slide],
  );
  const peekStyle = {
    opacity: fade ? peek.slide : 1,
    transform: [{ translateX: peeking ? peekIn : 0 }],
  };

  return (
    <>
      {peeking && (
        <View
          pointerEvents="none"
          onMouseEnter={peek.show}
          onMouseLeave={peek.hide}
          onLayout={(e) => (holdHeight.current = e.nativeEvent.layout.height)}
          style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: holdWidth }}
        />
      )}
      {strip.current && (
        <View
          pointerEvents={!open && !fullscreen ? "auto" : "none"}
          onMouseEnter={peek.show}
          onMouseLeave={leaveStrip}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: cardInset,
            width: !open && !fullscreen ? PEEK_EDGE_STRIP : 0,
          }}
        />
      )}
      <Animated.View
        pointerEvents={fullscreen || moving || (!open && !peeking) ? "none" : "auto"}
        style={{
          position: "absolute",
          left: away ? -10_000 : peeking ? PEEK_ORIGIN[0] : 0,
          top: peeking ? PEEK_ORIGIN[1] : 0,
          bottom: peeking ? PEEK_BOTTOM : 0,
          width,
          transform: [{ translateX: slideOut }],
        }}
      >
        {panel.current && (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, peekStyle, { opacity: panelOpacity }]}
          >
            <Panel fill={theme.windowTint[0]} radius={PEEK_RADIUS} border={theme.panelBorder} shadow={SHADOWS.sidebarPeek} style={StyleSheet.absoluteFill} />
          </Animated.View>
        )}
        <Animated.View style={[{ flex: 1 }, peekStyle, peeking ? { borderRadius: PEEK_RADIUS, overflow: "hidden" } : null]}>
          {sidebar}
        </Animated.View>
      </Animated.View>
    </>
  );
}
