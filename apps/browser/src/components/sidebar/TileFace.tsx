import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { ArcFavoriteBackground, DockSelection, radius, Surface } from "../ui";
import { hex, layout, useTheme } from "../ui/theme";
import { colorHexAlpha } from "../../lib/profileLook";
import { useTileTheme, type TileTheme } from "../../state/favicons/tileTheme";
import type { ResolvedFavicon } from "../../state/favicons/favicons";
import { useTab } from "../../state/browser/hooks";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { GlassFill, liquidGlass } from "../ui/Glass";
import { SLIDE } from "../tabstrip/stripReorder";
import { TabBadges } from "../media/TabBadges";
import { PIN_SLOT } from "./dragModel";
import { TILE_GAP } from "./pinZone";
import { TabIcon } from "./TabIcon";
import { tileWidthNow, useTileInner, type TileWidth } from "./tileWidth";
import { sidebarTokens, TILE_GLOW, TILE_HOVER_FADE, useSidebarTokens } from "./tokens";

const SELECTION_STROKE = 3;
const GLASS_RING = 2;
export const TILE_RADIUS = radius.card;

const AnimatedSurface = Animated.createAnimatedComponent(Surface);
const AnimatedDockSelection = Animated.createAnimatedComponent(DockSelection);
const AnimatedArcFavoriteBackground = Animated.createAnimatedComponent(ArcFavoriteBackground);

type FaceState = { width: TileWidth; active: boolean; selected: boolean; hovered: boolean; pressed: boolean };

export function TileFace({ tabId, badge, ...state }: FaceState & { tabId: string; badge?: ReactNode }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  const tileTheme = useTileTheme(tab?.url ?? "", tab?.favicon, tab?.customIcon, tab?.profileId ?? "");
  const arcLayout = useAddressBarInSidebar();
  if (!tab) return null;
  const { width, active } = state;
  if (arcLayout) return <ArcTileFace tabId={tabId} badge={badge} {...state} />;
  const icon = (
    <View>
      <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
      <TabBadges tabId={tabId} />
    </View>
  );
  if (liquidGlass)
    return (
      <GlassTile {...state} tileTheme={tileTheme}>
        {icon}
        {badge}
      </GlassTile>
    );
  if (active && tileTheme)
    return (
      <AnimatedDockSelection
        image={tileTheme.image}
        emoji={tileTheme.emoji}
        theme={tileTheme.theme.kind}
        fill={tileTheme.theme.kind === "template" ? tileTheme.theme.fill : undefined}
        stroke={tileTheme.theme.kind === "template" ? tileTheme.theme.stroke : undefined}
        cornerRadius={TILE_RADIUS}
        strokeWidth={SELECTION_STROKE}
        dark={theme.dark}
        style={{ width, height: layout.pinnedHeight, alignItems: "center", justifyContent: "center" }}
      >
        {tileTheme.theme.kind === "template" ? (
          <View>
            <View style={{ width: 16, height: 16 }} />
            <TabBadges tabId={tabId} />
          </View>
        ) : (
          icon
        )}
        {badge}
      </AnimatedDockSelection>
    );
  if (active)
    return (
      <AnimatedSurface
        fill={hex(theme.pinnedSelectedRim)}
        cornerRadius={TILE_RADIUS}
        shadowColor={sidebarTokens(theme).tileGlow}
        shadowOpacity={theme.dark ? TILE_GLOW.opacity.dark : TILE_GLOW.opacity.light}
        shadowRadius={TILE_GLOW.radius}
        shadowOffset={TILE_GLOW.offset}
        style={{ width, height: layout.pinnedHeight, padding: 1 }}
      >
        <View
          style={{
            flex: 1,
            borderRadius: TILE_RADIUS - 1,
            backgroundColor: theme.pinnedSelectedFill,
            borderTopWidth: 1,
            borderColor: theme.pinnedSelectedOutline,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </View>
        {badge}
      </AnimatedSurface>
    );
  return (
    <RestingTile {...state}>
      {icon}
      {badge}
    </RestingTile>
  );
}

export function RestingTile({ width, selected, hovered, pressed, children }: Omit<FaceState, "active"> & { children: ReactNode }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  if (liquidGlass)
    return (
      <GlassTile width={width} active={false} selected={selected} hovered={hovered} pressed={pressed} tileTheme={null}>
        {children}
      </GlassTile>
    );
  return (
    <Animated.View
      style={{
        width,
        height: layout.pinnedHeight,
        borderRadius: TILE_RADIUS,
        borderWidth: selected ? 1 : StyleSheet.hairlineWidth,
        borderColor: selected ? tokens.dragBorder : theme.pinnedRestingStroke,
        backgroundColor: pressed ? theme.tabPressed : hovered || selected ? theme.tabHover : theme.pinnedResting,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </Animated.View>
  );
}

function GlassTile({ width, active, selected, hovered, pressed, tileTheme, children }: FaceState & { tileTheme: TileTheme | null; children: ReactNode }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const fill = active ? theme.pinnedSelectedFill : pressed ? theme.tabPressed : hovered || selected ? theme.tabHover : theme.pinnedResting;
  return (
    <Animated.View style={{ width, height: layout.pinnedHeight, alignItems: "center", justifyContent: "center" }}>
      <GlassFill radius={TILE_RADIUS} fill={fill} state={pressed ? "rest" : active ? "active" : hovered || selected ? "lit" : "rest"} />
      {active ? (
        <DockSelection
          image={tileTheme?.image}
          emoji={tileTheme?.emoji}
          theme={tileTheme?.theme.kind}
          fill={tileTheme?.theme.kind === "template" ? tileTheme.theme.fill : undefined}
          cornerRadius={TILE_RADIUS}
          strokeWidth={GLASS_RING}
          dark={theme.dark}
          glass
          colorRing
          style={StyleSheet.absoluteFill}
        />
      ) : selected ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: TILE_RADIUS, borderWidth: 1, borderColor: tokens.dragBorder }]} />
      ) : null}
      {children}
    </Animated.View>
  );
}

const RING_OUTSET = 3;

export function FolderDropRing({ on }: { on: boolean }) {
  const theme = useTheme();
  const shown = useMemo(() => new Animated.Value(on ? 1 : 0), []);
  useEffect(() => {
    const spring = Animated.spring(shown, { toValue: on ? 1 : 0, ...SLIDE });
    spring.start();
    return () => spring.stop();
  }, [on, shown]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: -RING_OUTSET,
        right: -RING_OUTSET,
        top: -RING_OUTSET,
        bottom: -RING_OUTSET,
        borderRadius: TILE_RADIUS + RING_OUTSET,
        borderWidth: 2,
        borderColor: theme.accent,
        backgroundColor: sidebarTokens(theme).folderDropFill,
        opacity: shown,
        transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
      }}
    />
  );
}

const slotAt = (column: number, row: number, grid: TileWidth) => {
  const width = tileWidthNow(grid);
  return { width, x: column * (width + TILE_GAP), y: row * PIN_SLOT };
};

export function useSlotPosition(column: number, row: number, grid: TileWidth, sliding: boolean, dragging: boolean) {
  const inner = useTileInner();
  const [position] = useState(() => {
    const { x, y } = slotAt(column, row, grid);
    return new Animated.ValueXY({ x, y });
  });
  const latest = useRef({ column, row, grid, sliding, dragging });
  const placedWidth = useRef(tileWidthNow(grid));
  const [place] = useState(() => {
    let last: { width: number; x: number; y: number; sliding: boolean; dragging: boolean } | null = null;
    return () => {
      const { column, row, grid, sliding, dragging } = latest.current;
      const { width, x, y } = slotAt(column, row, grid);
      if (last && last.width === width && last.x === x && last.y === y && last.sliding === sliding && last.dragging === dragging) return;
      last = { width, x, y, sliding, dragging };
      if (dragging) return;
      const resized = placedWidth.current !== width;
      placedWidth.current = width;
      if (sliding && !resized) Animated.spring(position, { toValue: { x, y }, ...SLIDE }).start();
      else {
        position.x.stopAnimation((at) => {
          if (at !== x) position.x.setValue(x);
        });
        position.y.stopAnimation((at) => {
          if (at !== y) position.y.setValue(y);
        });
      }
    };
  });
  useLayoutEffect(() => {
    const id = inner.addListener(place);
    return () => inner.removeListener(id);
  }, [inner, place]);
  useLayoutEffect(() => {
    latest.current = { column, row, grid, sliding, dragging };
    place();
  }, [column, row, grid, sliding, dragging, place]);
  useEffect(() => () => position.stopAnimation(), [position]);
  return position;
}

function useTileHoverFade(lit: boolean) {
  const [shown] = useState(() => new Animated.Value(lit ? 1 : 0));
  const [rest] = useState(() => shown.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }));
  const litFor = useRef(lit);
  useEffect(() => {
    if (litFor.current === lit) return;
    litFor.current = lit;
    Animated.timing(shown, { toValue: lit ? 1 : 0, ...TILE_HOVER_FADE, useNativeDriver: true }).start();
  }, [lit, shown]);
  return { shown, rest };
}

function ArcTileFace({ tabId, badge, width, active, selected, hovered, pressed }: FaceState & { tabId: string; badge?: ReactNode }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const tab = useTab(tabId);
  const [shown, setShown] = useState<ResolvedFavicon | null>(null);
  const hover = useTileHoverFade(hovered || selected);
  if (!tab) return null;
  const muted = theme.custom?.favoriteMutedColor;
  const mutedColor = muted ? colorHexAlpha(theme.dark ? muted.dark : muted.light) : theme.dark ? undefined : hex(theme.icon);
  return (
    <Animated.View style={{ width, height: layout.pinnedHeight, alignItems: "center", justifyContent: "center" }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: hover.rest }]}>
        <AnimatedSurface fill={active ? undefined : hex(tokens.fieldFill)} cornerRadius={layout.rowRadius} logicalWidth={!active ? width : undefined} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: hover.shown }]}>
        <AnimatedSurface
          fill={active ? undefined : hex(pressed ? theme.tabPressed : theme.tabHover)}
          cornerRadius={layout.rowRadius}
          borderWidth={!active && selected ? 1 : 0}
          borderColor={selected && !active ? hex(tokens.dragBorder) : undefined}
          logicalWidth={!active ? width : undefined}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      {active ? <AnimatedArcFavoriteBackground source={tab.customIcon ? null : shown} cornerRadius={layout.rowRadius} hovered={hovered} logicalWidth={width} dark={theme.dark} mutedColor={mutedColor} pointerEvents="none" style={StyleSheet.absoluteFill} /> : null}
      <View>
        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} onSource={setShown} />
        <TabBadges tabId={tabId} />
      </View>
      {badge}
    </Animated.View>
  );
}
