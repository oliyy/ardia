import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../lib/actions";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useIsIncognito } from "../../store/hooks";
import { usePagerPages, type PagerPage } from "../layout/profilePager";
import { SIDEBAR_FOOTER_CENTER } from "../layout/windowLayout";
import { useHover } from "../primitives";
import { TooltipAbove } from "../TooltipAbove";
import { ProfileGlyph } from "./icons";

export const PROFILE_DOTS_HEIGHT = 41;
const PITCH = 34;
const GLYPH = 12;
const BAND = 28;
const SELECTED = 0.92;
const HOVERED = 0.4;
const IDLE = 0.2;
const DOT_CENTER_TO_TOOLTIP = 18.25;
const GLYPH_TINT = { dark: "#FFFFFF", light: "#000000" } as const;
const GLYPH_TINTS = [GLYPH_TINT.dark, GLYPH_TINT.light];

export function useProfileDotsShown() {
  return !useIsIncognito();
}

export function ProfileDots({ windowId, width, reserve }: { windowId: string; width: number; reserve: number }) {
  const ids = useBrowser(useShallow((s) => s.profileOrder));
  const { pages, pager } = usePagerPages(windowId);
  const current = useBrowser((s) => s.windows[windowId]?.profileId);
  const room = Math.max(PITCH, width - 2 * Math.max(reserve, layout.sidebarInset));
  const viewport = Math.min(ids.length * PITCH, room);
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const onHover = useCallback((id: string, active: boolean) => setHovered((current) => active ? id : current === id ? null : current), []);
  const hoverIndex = hovered ? ids.indexOf(hovered) : -1;
  const hoverCenter = hoverIndex * PITCH + PITCH / 2 - scrollOffset;
  const hoverName = useBrowser((s) => hovered ? s.profiles[hovered]?.name ?? "" : "");
  useEffect(() => {
    const index = current ? ids.indexOf(current) : -1;
    if (index < 0) return;
    const start = index * PITCH;
    const end = start + PITCH;
    if (start < offset.current) scroll.current?.scrollTo({ x: start, animated: true });
    else if (end > offset.current + viewport) scroll.current?.scrollTo({ x: end - viewport, animated: true });
  }, [current, ids, viewport]);
  return (
    <View style={{ height: PROFILE_DOTS_HEIGHT, alignItems: "center" }}>
      <TooltipAbove text={hoverName} active={hoverIndex >= 0 && hoverCenter >= 0 && hoverCenter <= viewport} centerX={(width - viewport) / 2 + hoverCenter} bottom={SIDEBAR_FOOTER_CENTER + DOT_CENTER_TO_TOOLTIP} />
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => {
          offset.current = e.nativeEvent.contentOffset.x;
          setScrollOffset(offset.current);
        }}
        style={{ marginTop: PROFILE_DOTS_HEIGHT - SIDEBAR_FOOTER_CENTER - BAND / 2, height: BAND, width: viewport, flexGrow: 0 }}
        contentContainerStyle={{ height: BAND }}
      >
        {ids.map((id) => (
          <ProfileIcon key={id} id={id} windowId={windowId} page={pages.find((p) => p.id === id)} pos={pager.pos} onHover={onHover} />
        ))}
      </ScrollView>
    </View>
  );
}

function ProfileIcon({ id, windowId, page, pos, onHover }: { id: string; windowId: string; page: PagerPage | undefined; pos: Animated.Value; onHover(id: string, active: boolean): void }) {
  const theme = useTheme();
  const profile = useBrowser(useShallow((s) => ({ name: s.profiles[id]?.name ?? "", icon: s.profiles[id]?.icon ?? null })));
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  if (pressed && !hovered) setPressed(false);
  useEffect(() => {
    onHover(id, hovered && !pressed);
    return () => onHover(id, false);
  }, [hovered, pressed, id, onHover]);
  const rest = hovered ? HOVERED : IDLE;
  const opacity = page
    ? pos.interpolate({ inputRange: [page.slot - 1, page.slot, page.slot + 1], outputRange: [rest, SELECTED, rest], extrapolate: "clamp" })
    : rest;
  return (
    <View {...hoverProps}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={profile.name}
        onPress={() => {
          setPressed(true);
          switchProfile(windowId, id, true);
        }}
      >
        <Animated.View style={{ width: PITCH, height: BAND, alignItems: "center", justifyContent: "center", opacity }}>
          <ProfileGlyph profile={profile} glyph={GLYPH} color={theme.dark ? GLYPH_TINT.dark : GLYPH_TINT.light} tints={GLYPH_TINTS} />
        </Animated.View>
      </Pressable>
    </View>
  );
}
