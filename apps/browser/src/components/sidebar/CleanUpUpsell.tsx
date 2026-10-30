import { memo, useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { everySlowly } from "../../state/app/slowTimers";
import { font, radius, Surface, Symbol, weight } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { useSettings, useWindow } from "../../state/browser/hooks";
import { cleanUpTabs } from "../../state/pins/actions";
import { DAILY_CLEAN_UP_MINUTES } from "../../state/settings/cleanUpAfter";
import { updateSettings } from "../../state/settings/actions";
import { cleanUpCandidateCount } from "../../state/sidebar/current";
import { useShownTabId } from "../../state/sidebar/hooks";
import { setUpsellShift } from "../../state/sidebar/upsellShift";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "../../state/sidebar/sidebarWidth";
import { useShift } from "./EntryMotion";
import { RESIZE_BAND } from "./useResizeDrag";
import { useSidebarTokens } from "./tokens";

const UPSELL_MIN = 10;
const UPSELL_PAD = 10;
const UPSELL_BORDER = 0.5;
const UPSELL_ICON = 16;
const UPSELL_ICON_GAP = 6;
const UPSELL_BODY = "Ardia can tidy up for you. You can always reopen closed tabs from the ⌄ menu.";
const LIVE_WIDTHS = [SIDEBAR_MIN_WIDTH - RESIZE_BAND, SIDEBAR_MAX_WIDTH + RESIZE_BAND];
const MEASURE_OFFSCREEN = { position: "absolute", width: 1000, height: 0, overflow: "hidden", opacity: 0 } as const;
const upsellText = (width: number) => width - layout.sidebarInset * 2 - (UPSELL_PAD + UPSELL_BORDER) * 2;
let upsellDeclined = false;

export const CleanUpUpsell = memo(function CleanUpUpsell({ windowId, shift }: { windowId: string; shift: Animated.Value | null }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const [count, setCount] = useState(0);
  const [hidden, setHidden] = useState(upsellDeclined);
  const daily = useSettings((st) => st.cleanUpInactiveTabsAfterMinutes !== null);
  const tabIds = useWindow(windowId, (w) => w?.tabIds);
  const profileId = useWindow(windowId, (w) => w?.profileId);
  const activeId = useShownTabId(windowId);
  const off = hidden || daily;
  useEffect(() => {
    if (off) return;
    const check = () => setCount(cleanUpCandidateCount(windowId));
    check();
    return everySlowly({ every: 60_000, run: check });
  }, [windowId, off, tabIds, profileId, activeId]);
  const [moved, movedRef] = useShift(shift);
  const shown = !off && count >= UPSELL_MIN;
  useEffect(() => {
    if (!shown) return;
    return () => setUpsellShift(windowId, 0);
  }, [shown, windowId]);
  const heights = useRef([0, 0, 0, 0]);
  const measure = (index: number) => (e: LayoutChangeEvent) => {
    heights.current[index] = e.nativeEvent.layout.height;
    const [titleMin, bodyMin, titleMax, bodyMax] = heights.current;
    if (!titleMin || !bodyMin || !titleMax || !bodyMax) return;
    setUpsellShift(windowId, Math.max(UPSELL_ICON, titleMin) + bodyMin - Math.max(UPSELL_ICON, titleMax) - bodyMax);
  };
  if (!shown) return null;
  const heading = `${count} tabs haven’t been touched in a while`;
  const button = (title: string, onPress: () => void, primary = false) => (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View
          style={{
            height: 24,
            borderRadius: radius.button,
            paddingHorizontal: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? tokens.upsellButtonHover : primary ? theme.textPrimary : tokens.upsellButton,
          }}
        >
          <Text style={{ ...font.small, fontWeight: weight.medium, color: primary ? theme.onPrimary : theme.textPrimary }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
  const dismiss = () => {
    upsellDeclined = true;
    setHidden(true);
  };
  return (
    <View {...moved} ref={movedRef} style={[{ marginTop: 10, borderRadius: radius.panel, padding: UPSELL_PAD, backgroundColor: tokens.groupFill, borderWidth: UPSELL_BORDER, borderColor: tokens.groupStroke, gap: 8 }, moved.style as object]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: UPSELL_ICON_GAP }}>
        <Symbol name="wand.and.stars" size={12} color={theme.icon} style={{ width: UPSELL_ICON, height: UPSELL_ICON }} />
        <Text style={{ flex: 1, ...font.small, fontWeight: weight.semibold, color: theme.textPrimary }}>{heading}</Text>
      </View>
      <Text style={{ ...font.small, color: theme.textSecondary }}>{UPSELL_BODY}</Text>
      <View style={{ gap: 6 }}>
        {button("Clean Up Once", () => {
          cleanUpTabs(windowId);
          dismiss();
        }, true)}
        {button("Clean Up Daily", () => {
          updateSettings({ cleanUpInactiveTabsAfterMinutes: DAILY_CLEAN_UP_MINUTES });
          cleanUpTabs(windowId);
        })}
        {button("Not Now", dismiss)}
      </View>
      <Surface hidesAccessibility pointerEvents="none" style={MEASURE_OFFSCREEN}>
        {LIVE_WIDTHS.flatMap((width, k) => [
          <Text key={`title${k}`} onLayout={measure(k * 2)} style={{ width: upsellText(width) - UPSELL_ICON - UPSELL_ICON_GAP, ...font.small, fontWeight: weight.semibold }}>
            {heading}
          </Text>,
          <Text key={`body${k}`} onLayout={measure(k * 2 + 1)} style={{ width: upsellText(width), ...font.small }}>
            {UPSELL_BODY}
          </Text>,
        ])}
      </Surface>
    </View>
  );
});
