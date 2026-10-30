import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Animated, ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { switchOn } from "../../state/app/switches";
import { ContextMenuArea, Surface, WindowDragRegion } from "../ui";
import { layout } from "../ui/theme";
import { ThemeScope } from "../window/ThemeScope";
import { PageProfileContext, useIsIncognito, useSettings, useWindowId } from "../../state/browser/hooks";
import { newTab } from "../../state/tabs/actions";
import { useSidebarCells, useSidebarWidthOf } from "../../state/sidebar/hooks";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { usePageStyle } from "../../state/windows/profilePager";
import { startsOffScreen, type Section } from "../../state/sidebar/geometry";
import { openSidebarMenu } from "../../state/sidebar/menus";
import { toggleNewTabBar } from "../../state/omnibox/newTabBar";
import { SIDEBAR_PLAYER_HEIGHT, SidebarPlayer, useSidebarPlayerTab } from "../media/SidebarPlayer";
import { DragScope, useDragController, useDragging, usePinnedCount } from "./DragProvider";
import { PinnedGrid } from "./PinnedGrid";
import { pinColumnCap, pinGridHeight } from "./pinZone";
import { SCROLL_EDGE, ScrollEdgeLine, useScrollEdge } from "./ScrollEdge";
import { listTopGap } from "./geometry";
import { DOCK_SHARE, DOCKED_BOTTOM, pageLayout, type SidebarGeometry } from "./pageLayout";
import { PageRows } from "./PageRows";
import { NewTabRow } from "./NewTabRow";
import { SpaceHeader } from "./SpaceHeader";
import { useSidebarTokens } from "./tokens";

const NONE: string[] = [];

type PageProps = {
  profileId: string;
  slot: number;
  pageWidth: Animated.Value;
  current: boolean;
  resting: boolean;
  docked: boolean;
  glowRoom: number;
  height: number;
  rows: number | undefined;
  geometry: RefObject<SidebarGeometry> | undefined;
  bottomLine: boolean;
  onListHeight: (profileId: string, height: number) => void;
  onScrollView: (view: ScrollView | null) => void;
  onScrollY: (y: number) => void;
};

export const SidebarPage = memo(function SidebarPage({ profileId, slot, pageWidth, current, resting, docked, glowRoom, height, rows, geometry, bottomLine, onListHeight, onScrollView, onScrollY }: PageProps) {
  const windowId = useWindowId();
  const addressBar = useAddressBarInSidebar();
  const incognito = useIsIncognito();
  const topGap = listTopGap(addressBar);
  const pinColumns = pinColumnCap(addressBar);
  const pageStyle = usePageStyle(windowId, slot, pageWidth);
  const [lazy] = useState(() => switchOn("lazySidebarRows"));
  const [beside, setBeside] = useState(() => startsOffScreen(lazy, current));
  useEffect(() => {
    if (!beside) return;
    const frame = requestAnimationFrame(() => setBeside(false));
    return () => cancelAnimationFrame(frame);
  }, [beside]);
  const offScreen = beside && !current;
  const playerTab = useSidebarPlayerTab(windowId, profileId);
  const playerHeight = playerTab ? SIDEBAR_PLAYER_HEIGHT : 0;
  const tiles = useSidebarCells(windowId, profileId, offScreen);
  const dragging = useDragging() && current;
  const previewed = usePinnedCount(tiles);
  const dockRoom = height ? (height - playerHeight) * DOCK_SHARE - topGap - SCROLL_EDGE.gap - SCROLL_EDGE.line : Infinity;
  const balanced = useSettings((st) => st.balancedTopApps);
  const tilesHeight = useSidebarWidthOf(windowId, (width) => pinGridHeight(tiles.length, width - layout.sidebarInset * 2, layout.pinnedHeight, pinColumns, balanced));
  const previewHeight = useSidebarWidthOf(windowId, (width) => pinGridHeight(previewed, width - layout.sidebarInset * 2, layout.pinnedHeight, pinColumns, balanced));
  const fixedBeforeDrag = useRef(true);
  const { dockFixed, capped } = pageLayout({
    tiles: tiles.length,
    previewed,
    dockRoom,
    gridHeight: () => (dragging ? previewHeight : tilesHeight),
    dragging,
    fixedBeforeDrag: fixedBeforeDrag.current,
    listHeight: 0,
    dockAbove: Infinity,
  });
  if (!dragging) fixedBeforeDrag.current = dockFixed;
  const fixedTiles = dockFixed ? tiles : NONE;
  const scrolledTiles = dockFixed ? NONE : tiles;
  const headerTop = scrolledTiles.length ? layout.sidebarInset : fixedTiles.length ? layout.sidebarInset - SCROLL_EDGE.gap - SCROLL_EDGE.line - SCROLL_EDGE.inset : 0;
  const headerFixed = addressBar && !incognito && !scrolledTiles.length;
  const room = fixedTiles.length ? 0 : glowRoom;
  const pad = headerFixed ? 0 : room + SCROLL_EDGE.inset;
  if (geometry) {
    geometry.current.room = room;
    geometry.current.pad = pad;
    geometry.current.tilesFixed = dockFixed;
  }
  const scrollEdge = useScrollEdge();
  const scrollY = useRef(new Animated.Value(0)).current;
  const isCurrent = useRef(current);
  isCurrent.current = current;
  const [contentBelow, setContentBelow] = useState(false);
  const extent = useRef({ offset: 0, viewport: 0, content: 0, below: false });
  const origins = useRef<Record<Section, number>>({ pinned: 0, list: 0 }).current;
  const scrollView = useRef<ScrollView | null>(null);
  const restored = useRef(false);
  const [attachRest] = useState(() => (v: ScrollView | null) => void (scrollView.current = v));
  const [attachCurrent] = useState(() => (v: ScrollView | null) => {
    scrollView.current = v;
    onScrollView(v);
  });
  const publishReady = () => {
    const view = scrollView.current;
    if (geometry && view && restored.current && extent.current.viewport) geometry.current.ready = { profileId, view };
  };
  useEffect(() => {
    restored.current = false;
    if (!current || !geometry) return;
    const e = extent.current;
    onScrollY(e.offset);
    restored.current = true;
    if (!e.viewport) return;
    geometry.current.viewport = e.viewport;
    geometry.current.content = e.content;
    Object.assign(geometry.current.regions, origins);
    publishReady();
    geometry.current.laidOut?.();
  }, [current]);
  const [followExtent] = useState(() => () => {
    const e = extent.current;
    const below = e.content - e.offset - e.viewport > 0.5;
    if (below === e.below) return;
    e.below = below;
    setContentBelow(below);
  });
  const [onScroll] = useState(() =>
    Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: true,
      listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollEdge.follow(e.nativeEvent.contentOffset.y);
        extent.current.offset = e.nativeEvent.contentOffset.y;
        followExtent();
        if (isCurrent.current) onScrollY(e.nativeEvent.contentOffset.y);
      },
    }),
  );
  const edge = useMemo(() => scrollY.interpolate({ inputRange: [0, 1], outputRange: [0, room], extrapolate: "clamp" }), [scrollY, room]);
  const unedge = useMemo(() => Animated.multiply(edge, -1), [edge]);
  const fixed = useRef<{ height: number; list: number | null }>({ height: 0, list: null });
  const report = () => {
    if (!resting && fixed.current.list !== null) onListHeight(profileId, fixed.current.height + fixed.current.list + playerHeight);
  };
  const reportList = (list: number) => {
    fixed.current.list = list;
    report();
  };
  const onFixedLayout = (e: LayoutChangeEvent) => {
    fixed.current.height = e.nativeEvent.layout.height;
    report();
  };
  useEffect(report, [playerHeight, resting]);
  const inlineNewTab = !docked;

  return (
    <Animated.View
      presentationGate
      presentationPersistent
      pointerEvents={current ? "auto" : "none"}
      style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, display: resting ? "none" : "flex", ...pageStyle }}
    >
      <Surface hidesAccessibility={!current} style={{ flex: 1 }}>
        <PageProfileContext.Provider value={profileId}>
          <ThemeScope>
            <DragScope page={profileId} enabled={current}>
              <PageContent>
                {(controller) => (
                  <TilesPlacement
                    controller={controller}
                    fixed={dockFixed}
                    room={dockRoom}
                    columns={pinColumns}
                    gap={headerFixed ? layout.sidebarInset + layout.rowHeight : SCROLL_EDGE.gap + SCROLL_EDGE.line}
                  >
                    <View onLayout={onFixedLayout} style={{ paddingTop: glowRoom }}>
                      <View style={[{ paddingHorizontal: layout.sidebarInset }, capped ? { maxHeight: topGap + dockRoom, overflow: "hidden" } : null]}>
                        {dockFixed ? <PinnedGrid tabs={fixedTiles} /> : null}
                      </View>
                      {headerFixed ? (
                        <View style={{ paddingHorizontal: layout.sidebarInset }}>
                          <SpaceHeader windowId={windowId} profileId={profileId} top={layout.sidebarInset} />
                        </View>
                      ) : (
                        <>
                          <View style={{ height: fixedTiles.length ? SCROLL_EDGE.gap : topGap - SCROLL_EDGE.inset - SCROLL_EDGE.line }} />
                          <ScrollEdgeLine opacity={scrollEdge.opacity} />
                        </>
                      )}
                    </View>
                    <Animated.View style={{ flex: 1, marginTop: -room, overflow: "hidden", transform: [{ translateY: edge }] }}>
                      <Animated.View style={{ flex: 1, transform: [{ translateY: unedge }] }}>
                        <Animated.ScrollView
                          ref={current ? attachCurrent : attachRest}
                          onLayout={(e) => {
                            extent.current.viewport = e.nativeEvent.layout.height;
                            followExtent();
                            if (!geometry) return;
                            geometry.current.viewport = e.nativeEvent.layout.height;
                            Object.assign(geometry.current.regions, origins);
                            publishReady();
                            geometry.current.laidOut?.();
                          }}
                          onContentSizeChange={(_width, contentHeight) => {
                            extent.current.content = contentHeight;
                            if (geometry) geometry.current.content = contentHeight;
                            followExtent();
                          }}
                          style={{ flex: 1 }}
                          showsVerticalScrollIndicator={false}
                          scrollEventThrottle={16}
                          onScroll={onScroll}
                          contentContainerStyle={{ flexGrow: 1, width: "100%", paddingHorizontal: layout.sidebarInset, paddingTop: pad }}
                        >
                          <PageRows
                            windowId={windowId}
                            profileId={profileId}
                            current={current}
                            rows={rows}
                            lazy={lazy}
                            offScreen={offScreen}
                            tiles={scrolledTiles}
                            underDockedTiles={fixedTiles.length > 0}
                            headerTop={headerTop}
                            inlineNewTab={inlineNewTab}
                            controller={controller}
                            geometry={geometry}
                            origins={origins}
                            onListHeight={reportList}
                          />
                          <ContextMenuArea style={{ flexGrow: 1, minHeight: inlineNewTab ? 24 : 0 }} onContextMenu={() => void openSidebarMenu(windowId)}>
                            <WindowDragRegion style={{ flex: 1 }} titleBarDoubleClick={false} onRegionDoubleClick={() => toggleNewTabBar(windowId) || newTab(windowId, { newTabCommand: true })} />
                          </ContextMenuArea>
                        </Animated.ScrollView>
                      </Animated.View>
                      {headerFixed ? (
                        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
                          <ScrollEdgeLine opacity={scrollEdge.opacity} />
                        </View>
                      ) : null}
                      {bottomLine && contentBelow ? <ContentBelowLine /> : null}
                    </Animated.View>
                    {playerTab ? (
                      <View style={{ paddingHorizontal: layout.sidebarInset, paddingTop: docked ? 8 : 0, paddingBottom: docked ? 0 : 8 }}>
                        <SidebarPlayer tabId={playerTab} />
                      </View>
                    ) : null}
                    {docked ? (
                      <View style={{ paddingHorizontal: layout.sidebarInset, paddingTop: layout.rowGap, paddingBottom: DOCKED_BOTTOM }}>
                        <NewTabRow windowId={windowId} />
                      </View>
                    ) : null}
                  </TilesPlacement>
                )}
              </PageContent>
            </DragScope>
          </ThemeScope>
        </PageProfileContext.Provider>
      </Surface>
    </Animated.View>
  );
});

type Controller = ReturnType<typeof useDragController>;

function TilesPlacement({ controller, fixed, room, columns, gap, children }: { controller: Controller; fixed: boolean; room: number; columns: number; gap: number; children: ReactNode }) {
  if (controller) {
    controller.tilesFixed = fixed;
    controller.tilesRoom = room;
    controller.tilesColumns = columns;
    controller.tilesGap = gap;
  }
  return <>{children}</>;
}

function ContentBelowLine() {
  const tokens = useSidebarTokens();
  return <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, backgroundColor: tokens.spaceDivider }} />;
}

function PageContent({ children }: { children: (controller: Controller) => ReactNode }) {
  return <>{children(useDragController())}</>;
}
