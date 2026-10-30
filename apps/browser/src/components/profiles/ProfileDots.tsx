import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { switchProfile } from "../../state/browser/actions";
import { layout, useTheme } from "../ui/theme";
import { useIsIncognito, useProfile, useWindow } from "../../state/browser/hooks";
import { useProfileOrder } from "../../state/profiles/hooks";
import { useNativePagerPosition, usePagerPages, type PagerPage } from "../../state/windows/profilePager";
import { ContextMenuArea, ink, useHover } from "../ui";
import { TooltipAbove } from "../ui/TooltipAbove";
import { SIDEBAR_FOOTER_CENTER } from "../sidebar/geometry";
import { ProfileGlyph } from "./ProfileIcons";
import { openProfileItemMenu } from "./profileMenu";
import { arcSwitcher, profileSwitcher } from "./tokens";

export const PROFILE_DOTS_HEIGHT = profileSwitcher.height;
const { band: BAND, dotTooltipLift } = profileSwitcher;
const { pitch: PITCH, glyph: GLYPH } = arcSwitcher;
const GLYPH_TINTS = [ink.white, ink.black];

export function useProfileDotsShown() {
  return !useIsIncognito();
}

export function ProfileDots({ windowId, width, reserve }: { windowId: string; width: number; reserve: number }) {
  const ids = useProfileOrder(useShallow((o) => o));
  const { pages, pager } = usePagerPages(windowId);
  const current = useWindow(windowId, (w) => w?.profileId);
  const room = Math.max(PITCH, width - 2 * Math.max(reserve, layout.sidebarInset));
  const viewport = Math.min(ids.length * PITCH, room);
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const onHover = useCallback((id: string, active: boolean) => setHovered((current) => (active ? id : current === id ? null : current)), []);
  const hoverIndex = hovered ? ids.indexOf(hovered) : -1;
  const hoverCenter = hoverIndex * PITCH + PITCH / 2 - scrollOffset;
  const hoverName = useProfile(hovered, (p) => p?.name ?? "");
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
      <TooltipAbove text={hoverName} active={hoverIndex >= 0 && hoverCenter >= 0 && hoverCenter <= viewport} centerX={(width - viewport) / 2 + hoverCenter} bottom={SIDEBAR_FOOTER_CENTER + dotTooltipLift} />
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

const ProfileIcon = memo(function ProfileIcon({ id, windowId, page, pos, onHover }: { id: string; windowId: string; page: PagerPage | undefined; pos: Animated.Value; onHover(id: string, active: boolean): void }) {
  const theme = useTheme();
  useNativePagerPosition(windowId);
  const profile = useProfile(id, useShallow((p) => ({ name: p?.name ?? "", icon: p?.icon ?? null })));
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  if (pressed && !hovered) setPressed(false);
  useEffect(() => {
    onHover(id, hovered && !pressed);
    return () => onHover(id, false);
  }, [hovered, pressed, id, onHover]);
  const rest = hovered ? arcSwitcher.hovered : arcSwitcher.idle;
  const slot = page?.slot;
  const opacity = useMemo(
    () => (slot === undefined ? rest : pos.interpolate({ inputRange: [slot - 1, slot, slot + 1], outputRange: [rest, arcSwitcher.selected, rest], extrapolate: "clamp" })),
    [pos, slot, rest],
  );
  return (
    <View {...hoverProps}>
      <ContextMenuArea onContextMenu={() => void openProfileItemMenu(id, "sidebar", windowId)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={profile.name}
          onPress={() => {
            setPressed(true);
            switchProfile(windowId, id, true);
          }}
        >
          <Animated.View style={{ width: PITCH, height: BAND, alignItems: "center", justifyContent: "center", opacity }}>
            <ProfileGlyph profile={profile} glyph={GLYPH} color={theme.dark ? ink.white : ink.black} tints={GLYPH_TINTS} />
          </Animated.View>
        </Pressable>
      </ContextMenuArea>
    </View>
  );
});
