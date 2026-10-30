import { PowerUp, hex, ink, reduceMotion, spring as springOf, Surface, useTheme } from "../ui";
import { TOOLBAR_ROWS } from "../../lib/toolbarRow";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { useWindow, useWindowId } from "../../state/browser/hooks";
import { useCardAnchors } from "../../state/windows/layout";
import { NewTabExtras } from "./NewTabExtras";
import { IncognitoHeading } from "./IncognitoHeading";
import { DIA_OFFSET, MARK_ABOVE_BAR, newTabBarTop } from "./newTabLayout";
import { useOnboarding } from "../../state/onboarding/onboarding";
import { usePendingReleaseNotes, useReleaseNotesPage } from "../../state/releaseNotes/releaseNotes";
import { Omnibox } from "../omnibox/Omnibox";
import { NTP_BAR } from "./tokens";

const BAR_HEIGHT = 112;
const MARKS = {
  green: { back: require("../../../assets/ntp-mark-back.png"), front: require("../../../assets/ntp-mark-front.png"), sun: require("../../../assets/ntp-mark-sun.png") },
  plum: { back: require("../../../assets/ntp-mark-plum-back.png"), front: require("../../../assets/ntp-mark-plum-front.png"), sun: require("../../../assets/ntp-mark-plum-sun.png") },
  blue: { back: require("../../../assets/ntp-mark-blue-back.png"), front: require("../../../assets/ntp-mark-blue-front.png"), sun: require("../../../assets/ntp-mark-blue-sun.png") },
  purple: { back: require("../../../assets/ntp-mark-purple-back.png"), front: require("../../../assets/ntp-mark-purple-front.png"), sun: require("../../../assets/ntp-mark-purple-sun.png") },
  pink: { back: require("../../../assets/ntp-mark-pink-back.png"), front: require("../../../assets/ntp-mark-pink-front.png"), sun: require("../../../assets/ntp-mark-pink-sun.png") },
  red: { back: require("../../../assets/ntp-mark-red-back.png"), front: require("../../../assets/ntp-mark-red-front.png"), sun: require("../../../assets/ntp-mark-red-sun.png") },
  orange: { back: require("../../../assets/ntp-mark-orange-back.png"), front: require("../../../assets/ntp-mark-orange-front.png"), sun: require("../../../assets/ntp-mark-orange-sun.png") },
  yellow: { back: require("../../../assets/ntp-mark-yellow-back.png"), front: require("../../../assets/ntp-mark-yellow-front.png"), sun: require("../../../assets/ntp-mark-yellow-sun.png") },
  neutral: { back: require("../../../assets/ntp-mark-neutral-back.png"), front: require("../../../assets/ntp-mark-neutral-front.png"), sun: require("../../../assets/ntp-mark-neutral-sun.png") },
};
const MARK_SIZE = 100;
const SUN_DELAY = 250;
const MARK_LAYERS = [
  { name: "sun", hidden: 56, delay: SUN_DELAY, spring: springOf({ response: 0.56, damping: 0.9 }) },
  { name: "back", hidden: 40.5, delay: 170, spring: springOf({ response: 0.46, damping: 0.84 }) },
  { name: "front", hidden: 34, delay: 80, spring: springOf({ response: 0.42, damping: 0.76 }) },
] as const;
const SUN_DRIFT = 6;
const SUN_DRIFT_SPRING = springOf({ response: 0.6, damping: 1 });

type Size = { width: number; height: number };
let lastSize: { card: Size; size: Size } | null = null;
const introPlayed = new Set<string>();


function sameSize(a: Size, b: Size) {
  return a.width === b.width && a.height === b.height;
}

const HeroOmnibox = memo(Omnibox);

type BasisLayoutEvent = LayoutChangeEvent["nativeEvent"] & { ntpLayoutAccepted?: boolean };

const barBand = (viewWidth: number) => (viewWidth <= 644 ? 0 : viewWidth < 708 ? 1 : viewWidth < 1700 ? 2 : 3);

export function barWidth(viewWidth: number) {
  const content = viewWidth < 708 ? (viewWidth <= 636 ? viewWidth - 20 : 616) : viewWidth < 1700 ? 652 : 774;
  return Math.min(content, viewWidth - 28);
}

export function NewTabPage({ tabId, toolbar = true }: { tabId: string; toolbar?: boolean }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const incognito = useWindow(windowId, (w) => w?.kind === "private");
  const onboarding = useOnboarding((s) => s.windowId === windowId);
  const card = useCardAnchors(
    useShallow((s) => {
      const anchor = s[windowId];
      return anchor ? { width: anchor.width, height: anchor.height } : undefined;
    }),
  );
  const [size, setSizeState] = useState<Size | null>(() => (lastSize && (!card || sameSize(lastSize.card, card)) ? lastSize.size : null));
  const setSize = (next: Size) => setSizeState((prev) => (prev && sameSize(prev, next) ? prev : next));
  const raw = useRef<Size | null>(null);
  const committedCard = useRef<Size | null>(null);
  const latch = useRef(false);
  const [latched, setLatched] = useState(false);
  useLayoutEffect(() => {
    committedCard.current = card ?? null;
  }, [card]);
  useEffect(() => {
    if (raw.current && card) lastSize = { card: { width: card.width, height: card.height }, size: raw.current };
  }, [size, card?.width, card?.height]);
  const [panelHeight, setPanelHeight] = useState(BAR_HEIGHT);
  const [headingHeight, setHeadingHeight] = useState(0);
  const heading = !onboarding && incognito;
  const [playIntro] = useState(() => !introPlayed.has(tabId));
  const [rise] = useState(() => {
    const intro = playIntro && !reduceMotion();
    const layers = MARK_LAYERS.map((l) => ({ ...l, y: new Animated.Value(intro ? l.hidden : 0) }));
    return { layers, drift: new Animated.Value(intro ? SUN_DRIFT : 0) };
  });
  useEffect(() => {
    introPlayed.add(tabId);
  }, [tabId]);
  const pendingNotes = usePendingReleaseNotes();
  const notesPage = useReleaseNotesPage(windowId);
  const fast = !latched && !heading && !((pendingNotes && !incognito && !notesPage) || notesPage);
  useLayoutEffect(() => {
    if (!fast && raw.current) setSize(raw.current);
  }, [fast]);
  const onRootLayout = (e: LayoutChangeEvent) => {
    const { layout: next, ntpLayoutAccepted } = e.nativeEvent as BasisLayoutEvent;
    raw.current = next;
    const committed = committedCard.current;
    if (committed) lastSize = { card: { width: committed.width, height: committed.height }, size: next };
    if (!fast || latch.current) return setSize(next);
    if (ntpLayoutAccepted === false) {
      latch.current = true;
      setLatched(true);
      return setSize(next);
    }
    if (ntpLayoutAccepted !== true) return setSize(next);
    setSizeState((prev) => (prev && barBand(prev.width) === barBand(next.width) && prev.height === next.height ? prev : next));
  };
  useEffect(() => {
    if (!playIntro || reduceMotion()) return;
    const spring = (value: Animated.Value, delay: number, params: ReturnType<typeof springOf>) =>
      Animated.spring(value, { toValue: 0, delay, ...params, useNativeDriver: true });
    const intro = Animated.parallel([
      ...rise.layers.map((l) => spring(l.y, l.delay, l.spring)),
      spring(rise.drift, SUN_DELAY, SUN_DRIFT_SPRING),
    ]);
    intro.start();
    return () => intro.stop();
  }, [playIntro, rise]);

  if (!size) return <View style={{ flex: 1 }} onLayout={onRootLayout} />;

  const width = barWidth(size.width);
  const x = Math.max(size.width / 2 - width / 2, 14) + DIA_OFFSET;
  const under = toolbar ? 0 : TOOLBAR_ROWS.regular.height;
  const top = newTabBarTop(size.height, under, heading ? headingHeight : 0);

  const bar = { x, y: top, width, height: panelHeight };

  return (
    <View style={{ flex: 1 }} ntpLayoutBasis={fast ? under : null} onLayout={onRootLayout}>
      {playIntro && theme.powerUpPalette && (
        <PowerUp
          style={StyleSheet.absoluteFill}
          palette={theme.powerUpPalette}
          speed={1}
          origin={0.5}
          cornerRadius={NTP_BAR.radius}
          halo={bar}
          haloNtp={fast ? { under, panelHeight } : null}
        />
      )}
      {heading && <IncognitoHeading left={x} barTop={top} width={width} onHeight={setHeadingHeight} />}
      <View
        pointerEvents="none"
        ntpLayoutRole={fast ? "mark" : null}
        style={{
          position: "absolute",
          left: size.width / 2 + DIA_OFFSET - MARK_SIZE / 2,
          top: top - MARK_ABOVE_BAR,
          width: MARK_SIZE,
          height: MARK_ABOVE_BAR,
          overflow: "hidden",
        }}
      >
        {rise.layers.map((l) => (
          <Animated.Image
            key={l.name}
            source={(MARKS[theme.profileColor === "incognito" ? "neutral" : theme.profileColor] ?? MARKS.green)[l.name]}
            style={{
              position: "absolute",
              width: MARK_SIZE,
              height: MARK_SIZE,
              transform: [{ translateX: l.name === "sun" ? rise.drift : 0 }, { translateY: l.y }],
            }}
          />
        ))}
      </View>
      <View ntpLayoutRole={fast ? "bar" : null} onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)} style={{ position: "absolute", left: x, top, width }}>
        {NTP_BAR.shadows.map((level, i) => (
          <Surface
            key={i}
            style={StyleSheet.absoluteFill}
            fill={ink.clear}
            cornerRadius={NTP_BAR.radius}
            shadowColor={level.color}
            shadowOpacity={level.opacity}
            shadowRadius={level.radius}
            shadowOffset={level.offset}
          />
        ))}
        <Surface fill={hex(theme.ntpBarSolid)} cornerRadius={NTP_BAR.radius} style={{ padding: NTP_BAR.contentInset }}>
          {onboarding ? <View style={{ height: BAR_HEIGHT - 2 * NTP_BAR.contentInset }} /> : <HeroOmnibox variant="hero" tabId={tabId} />}
          <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, borderRadius: NTP_BAR.radius, borderWidth: NTP_BAR.border, borderColor: theme.ntpBarBorder }} />
        </Surface>
      </View>
      <NewTabExtras size={size} bar={bar} native={fast} />
    </View>
  );
}
