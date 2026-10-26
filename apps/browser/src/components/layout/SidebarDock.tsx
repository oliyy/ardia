import { ContextMenuArea, onWindowEvent, setTrafficLightsCenter, Surface, watchLeftEdge, WindowDragRegion } from "@ardia/shell";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchOn } from "../../lib/killSwitches";
import { hex, layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { Sidebar } from "../Sidebar";
import { dismissHoverIn } from "../sidebar/hover";
import { useSidebarUi } from "../sidebar/state";
import { peekHeld, watchPeekHolds } from "./peekHold";
import { ProfileSwipe } from "./ProfileSwipe";
import {
  ARC_HIDE_MS,
  ARC_LIGHTS_CENTER,
  devPeeks,
  DOCK_SPRING,
  dockMoving,
  LIGHTS_CENTER,
  lightsCenter,
  PEEK_BOTTOM,
  PEEK_ORIGIN,
  PEEK_RADIUS,
  peekShown,
  setDockMoving,
  setPeekShown,
  springConfig,
  useDockMotion,
} from "./dockMotion";
import { TabDropArea, type TabDropTarget } from "./fileDrop";
import { useTabDrag } from "./tabDrag";
import { useCardGeometry } from "./windowLayout";
import { usePeek } from "./usePeek";

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then(
  (on) => (reduceMotion = on),
  () => {},
);
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

const SPRING = springConfig(DOCK_SPRING);
const STRIP_WIDTH = 8;
const HOLD_SLACK = 24;
const IGNORE = () => {};

type EndpointFlush = (valid: () => boolean, done: () => void) => void;
type RegisterEndpoint = (flush: EndpointFlush) => () => void;
type CardLeading = { read: () => number; follow: (send: (value: number) => void) => () => void };
type DockLink = { registerEndpoint: RegisterEndpoint; leading: CardLeading | null; shift: Animated.AnimatedInterpolation<number> | Animated.Value; interrupt: () => void };
type CardShift = { placed: boolean; attach: (view: View | null) => void; link: DockLink };
const UNDOCKED: DockLink = { registerEndpoint: () => IGNORE, leading: null, shift: new Animated.Value(0), interrupt: IGNORE };
const CardShiftContext = createContext<CardShift>({ placed: false, attach: IGNORE, link: UNDOCKED });

function useSidebarDock(open: boolean, animate: boolean, arc: boolean, placed: boolean, edge: number, span: number, tabDragging: boolean) {
  const windowId = useWindowId();
  const dock = useRef(new Animated.Value(open ? 1 : 0)).current;
  const base = useRef(new Animated.Value(open && placed ? -1 : 0)).current;
  const [wide, setWide] = useState(!(open && placed));
  const was = useRef(open);
  const generation = useRef(0);
  const laidWide = useRef(wide);
  const writes = useRef(0);
  const landed = useRef(0);
  const clip = useRef<View | null>(null);
  const consumer = useRef<EndpointFlush | null>(null);
  const waiting = useRef<(() => void) | null>(null);
  const geometry = useRef({ placed, edge, span });
  geometry.current = { placed, edge, span };
  const [steps] = useState(() => {
    const acknowledge = (write: number) =>
      requestAnimationFrame(() => {
        const done = () => {
          landed.current = Math.max(landed.current, write);
          waiting.current?.();
        };
        clip.current?.measure(done);
      });
    const land = (target: boolean, moved = false) => {
      const narrow = target && geometry.current.placed;
      const flips = geometry.current.placed && geometry.current.span !== 0 && laidWide.current === narrow;
      laidWide.current = !narrow;
      setWide(!narrow);
      base.setValue(narrow ? -1 : 0);
      if (flips || moved) acknowledge(++writes.current);
      return flips;
    };
    const release = (token: number) => {
      const attempt = () => {
        if (generation.current !== token || landed.current < writes.current) return;
        if (!dockMoving(windowId)) {
          waiting.current = null;
          return;
        }
        const flush = consumer.current;
        if (!flush) return;
        waiting.current = null;
        flush(
          () => generation.current === token,
          () => {
            if (generation.current === token) setDockMoving(windowId, false);
          },
        );
      };
      waiting.current = attempt;
      attempt();
    };
    const settle = (moved: boolean) => {
      const token = ++generation.current;
      dock.stopAnimation();
      dock.setValue(was.current ? 1 : 0);
      land(was.current, moved);
      release(token);
    };
    const attach = (view: View | null) => {
      clip.current = view;
    };
    const registerEndpoint = (flush: EndpointFlush) => {
      consumer.current = flush;
      waiting.current?.();
      return () => {
        if (consumer.current === flush) consumer.current = null;
      };
    };
    const read = () => geometry.current.edge + geometry.current.span * (dock as unknown as { __getValue(): number }).__getValue();
    const leading: CardLeading = {
      read,
      follow: (send) => {
        const id = dock.addListener(() => send(read()));
        return () => dock.removeListener(id);
      },
    };
    const interrupt = () => {
      if (dockMoving(windowId)) settle(true);
    };
    return { land, release, settle, attach, registerEndpoint, leading, interrupt };
  });
  useLayoutEffect(() => {
    if (was.current === open) return;
    was.current = open;
    const token = ++generation.current;
    dock.stopAnimation();
    if (!animate || reduceMotion || !switchOn("sidebarSlide") || (arc && open && peekShown(windowId))) {
      dock.setValue(open ? 1 : 0);
      if (steps.land(open)) setDockMoving(windowId, true);
      steps.release(token);
      return;
    }
    setDockMoving(windowId, true);
    if (!open) steps.land(false);
    (arc && !open
      ? Animated.timing(dock, { toValue: 0, duration: ARC_HIDE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false })
      : Animated.spring(dock, {
          toValue: open ? 1 : 0,
          ...SPRING,
          restDisplacementThreshold: 0.001,
          restSpeedThreshold: 0.01,
          useNativeDriver: false,
        })
    ).start(({ finished }) => {
      if (!finished) return;
      void Promise.resolve().then(() => {
        if (generation.current !== token) return;
        steps.land(open);
        steps.release(token);
      });
    });
  }, [open]);
  useLayoutEffect(() => {
    if (dockMoving(windowId)) steps.settle(true);
    else steps.land(was.current);
  }, [placed, span]);
  useLayoutEffect(() => {
    if (tabDragging && dockMoving(windowId)) steps.settle(false);
  }, [tabDragging]);
  useEffect(
    () => () => {
      generation.current++;
      setDockMoving(windowId, false);
    },
    [],
  );
  const shift = useMemo(() => Animated.multiply(Animated.add(dock, base), placed ? span : 0), [dock, base, placed, span]);
  const card = useMemo(
    () => ({
      placed,
      attach: steps.attach,
      link: { registerEndpoint: steps.registerEndpoint, leading: placed ? steps.leading : null, shift, interrupt: steps.interrupt },
    }),
    [shift, placed, steps],
  );
  return { dock, wide, card };
}

type Inset = { top: number; right: number; bottom: number; left: number };

export function DockedLayout({
  fullscreen,
  topTabs,
  inset,
  children,
}: {
  fullscreen: boolean;
  topTabs: boolean;
  inset: Inset;
  children: ReactNode;
}) {
  const windowId = useWindowId();
  const [open, savedWidth, addressBar] = useBrowser(
    useShallow(
      (s) =>
        [
          s.windows[windowId]?.sidebarOpen ?? true,
          s.settings.sidebarWidth ?? layout.sidebarWidth,
          s.settings.addressBar === "sidebar",
        ] as const,
    ),
  );
  const width = useSidebarUi((u) => u.dragWidth[windowId]) ?? savedWidth;
  const arc = addressBar && !topTabs && switchOn("sidebarSlide");
  const lights = addressBar && !topTabs ? ARC_LIGHTS_CENTER : LIGHTS_CENTER;
  const tabDragging = useTabDrag((d) => d.windowId === windowId && d.tabIds.length > 0);
  const placed = !topTabs && !fullscreen;
  const { dock, wide, card } = useSidebarDock(open, placed && !tabDragging, arc, placed, inset.left, width - inset.left, tabDragging);
  return (
    <CardShiftContext.Provider value={card}>
      <View
        style={
          fullscreen
            ? { flex: 1 }
            : {
                flex: 1,
                flexDirection: "row",
                paddingTop: inset.top,
                paddingRight: inset.right,
                paddingBottom: inset.bottom,
                paddingLeft: topTabs || wide ? inset.left : width,
              }
        }
      >
        {!fullscreen && <WindowDragRegion style={StyleSheet.absoluteFill} />}
        {children}
      </View>
      {!topTabs && <SidebarDock dock={dock} open={open} width={width} fullscreen={fullscreen} arc={arc} lights={lights} />}
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
  fullscreen,
  arc,
  lights,
}: {
  dock: Animated.Value;
  open: boolean;
  width: number;
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
  useEffect(() => (peek.live ? watchPeekHolds(() => latestPeek.current.recheck()) : undefined), [peek.live]);
  const holdWidth = PEEK_ORIGIN[0] + width + HOLD_SLACK;
  const holdHeight = useRef(Infinity);
  const inHold = (x: number, y: number) => x >= 0 && x < holdWidth && y >= 0 && y < holdHeight.current;
  const peeking = !open && !fullscreen && peek.live;
  const shown = fullscreen ? "fullscreen" : open ? "docked" : peek.live ? "peek" : "away";
  useLayoutEffect(() => () => dismissHoverIn(windowId), [windowId, shown]);
  const watching = !open && !fullscreen && !moving;
  const draggingTab = useTabDrag((d) => d.windowId === windowId && d.tabIds.length > 0);
  const nativeHold = peeking ? holdWidth : draggingTab ? STRIP_WIDTH : 0;
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
  const away = fullscreen || (!open && !moving && !peek.live);
  const slideOut = useMemo(() => dock.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }), [dock, width]);
  const peekIn = useMemo(
    () => peek.slide.interpolate({ inputRange: [0, 1], outputRange: [-12, width] }),
    [peek.slide, width],
  );
  useTrafficLights(windowId, dock, peek.slide, { width, peeking, fullscreen, lights });
  const sidebar = useMemo(
    () => (
      <ProfileSwipe>
        <Sidebar width={width} />
      </ProfileSwipe>
    ),
    [width],
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
            width: !open && !fullscreen ? STRIP_WIDTH : 0,
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
            <Surface
              fill={hex(theme.windowTint[0])}
              cornerRadius={PEEK_RADIUS}
              borderColor={hex(theme.panelBorder)}
              borderWidth={0.5}
              shadowColor="#000000"
              shadowOpacity={theme.panelShadowOpacity}
              shadowRadius={20}
              shadowOffset={[0, 6]}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        )}
        <Animated.View style={[{ flex: 1 }, peekStyle, peeking ? { borderRadius: PEEK_RADIUS, overflow: "hidden" } : null]}>
          {sidebar}
        </Animated.View>
      </Animated.View>
    </>
  );
}

function useTrafficLights(
  windowId: string,
  dock: Animated.Value,
  slide: Animated.Value,
  o: { width: number; peeking: boolean; fullscreen: boolean; lights: readonly [number, number] },
) {
  const values = useRef({ dock: 1, slide: 0 });
  const apply = useRef<() => void>(() => {});
  const sent = useRef<string | undefined>(undefined);
  apply.current = () => {
    const v = values.current;
    const offset = o.fullscreen ? 0 : o.peeking ? (o.width + 12) * (1 - v.slide) - PEEK_ORIGIN[0] : o.width * (1 - v.dock);
    const center = lightsCenter(offset, o.peeking && !o.fullscreen ? PEEK_ORIGIN[1] : 0, o.lights);
    const key = center ? center.join(",") : "";
    if (key === sent.current) return;
    sent.current = key;
    void setTrafficLightsCenter(windowId, center);
  };
  useEffect(() => {
    values.current.dock = (dock as unknown as { __getValue(): number }).__getValue();
    const a = dock.addListener(({ value }) => {
      values.current.dock = value;
      apply.current();
    });
    apply.current();
    return () => {
      dock.removeListener(a);
      sent.current = undefined;
      void setTrafficLightsCenter(windowId, null);
    };
  }, [windowId, dock]);
  useEffect(() => {
    if (!o.peeking) return;
    const b = slide.addListener(({ value }) => {
      values.current.slide = value;
      apply.current();
    });
    return () => slide.removeListener(b);
  }, [slide, o.peeking]);
  useEffect(() => apply.current(), [o.width, o.peeking, o.fullscreen, o.lights]);
}
