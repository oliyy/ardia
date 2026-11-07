import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { ink, OutsidePressArea, reduceMotion, Surface, VisualEffect } from "../ui";
import { useTheme } from "../ui/theme";
import { closePanel } from "../../state/windows/actions";
import { closeNewTabBar } from "../../state/omnibox/newTabBar";
import type { NewTabTarget } from "../../state/browser/types";
import { Omnibox } from "./Omnibox";
import { tourAnchorRef } from "../onboarding/tour/anchors";
import { NEW_TAB_BAR, NEW_TAB_BAR_COLORS, NEW_TAB_BAR_SHADOW } from "./tokens";

const AnimatedSurface = Animated.createAnimatedComponent(Surface);

type Session = { key: number; tabId: string; target: NewTabTarget };

export function newTabBarFrame(windowWidth: number, windowHeight: number) {
  const room = Math.max(0, windowWidth - 2 * NEW_TAB_BAR.windowMargin);
  const width = Math.min(room, Math.max(NEW_TAB_BAR.minWidth, Math.min(NEW_TAB_BAR.maxWidth, Math.round(windowWidth * NEW_TAB_BAR.widthShare))));
  const tallest = NEW_TAB_BAR.fieldHeight + NEW_TAB_BAR.list.above + NEW_TAB_BAR.list.below + NEW_TAB_BAR.tallestRows * (NEW_TAB_BAR.row.height + 2 * NEW_TAB_BAR.row.gapY);
  const lowest = windowHeight - NEW_TAB_BAR.windowMargin - tallest;
  const top = Math.max(NEW_TAB_BAR.windowMargin, Math.min(Math.round(windowHeight * NEW_TAB_BAR.topShare), lowest));
  return { left: Math.round((windowWidth - width) / 2), top, width };
}

export function NewTabBarHost({ windowId, open, windowWidth, windowHeight }: { windowId: string; open: { tabId: string; target: NewTabTarget } | null; windowWidth: number; windowHeight: number }) {
  const count = useRef(0);
  const [session, setSession] = useState<Session | null>(null);
  const [leaving, setLeaving] = useState(false);
  const opened = !!open;
  if (open && (!session || leaving)) {
    count.current += 1;
    setSession({ key: count.current, ...open });
    setLeaving(false);
  } else if (!open && session && !leaving) setLeaving(true);
  if (!session || windowWidth <= 0 || windowHeight <= 0) return null;
  return (
    <NewTabBar
      key={session.key}
      windowId={windowId}
      tabId={opened ? open.tabId : session.tabId}
      target={opened ? open.target : session.target}
      frame={newTabBarFrame(windowWidth, windowHeight)}
      leaving={leaving}
      onGone={() => setSession((s) => (s?.key === session.key ? null : s))}
    />
  );
}

function NewTabBar({
  windowId,
  tabId,
  target,
  frame,
  leaving,
  onGone,
}: {
  windowId: string;
  tabId: string;
  target: NewTabTarget;
  frame: { left: number; top: number; width: number };
  leaving: boolean;
  onGone(): void;
}) {
  const theme = useTheme();
  const colors = NEW_TAB_BAR_COLORS[theme.dark ? "dark" : "light"];
  const still = !!reduceMotion();
  const [appear] = useState(() => new Animated.Value(still ? 1 : 0));
  useEffect(() => {
    if (still && !leaving) return;
    const run = Animated.timing(appear, { toValue: leaving ? 0 : 1, duration: still ? 1 : NEW_TAB_BAR.appear.duration, easing: NEW_TAB_BAR.appear.easing, useNativeDriver: true });
    run.start(({ finished }) => finished && leaving && onGone());
    return () => run.stop();
  }, [leaving]);
  const scale = appear.interpolate({ inputRange: [0, 1], outputRange: [NEW_TAB_BAR.appear.scale, 1] });
  const onCancel = () => closePanel(windowId);
  const onDone = () => closeNewTabBar(windowId);
  return (
    <AnimatedSurface
      pointerEvents={leaving ? "none" : "auto"}
      fill={ink.clear}
      cornerRadius={NEW_TAB_BAR.radius}
      shadowColor={NEW_TAB_BAR_SHADOW.color}
      shadowOpacity={theme.dark ? NEW_TAB_BAR_SHADOW.opacity.dark : NEW_TAB_BAR_SHADOW.opacity.light}
      shadowRadius={NEW_TAB_BAR_SHADOW.radius}
      shadowOffset={NEW_TAB_BAR_SHADOW.offset}
      style={{ position: "absolute", ...frame, opacity: appear, transform: [{ scale }] }}
    >
      <View ref={tourAnchorRef(windowId, "commandBar")} pointerEvents="none" style={StyleSheet.absoluteFill} />
      <VisualEffect material="hudWindow" cornerRadius={NEW_TAB_BAR.radius} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, borderRadius: NEW_TAB_BAR.radius, backgroundColor: colors.tint, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }} />
      <OutsidePressArea onOutsidePress={leaving ? undefined : onCancel}>
        <Omnibox key={`newTab:${target.kind}`} variant="newTab" tabId={tabId} opensTab={target} onCancel={leaving ? undefined : onCancel} onDone={onDone} />
      </OutsidePressArea>
    </AnimatedSurface>
  );
}
