import { ContextMenuArea, FadeLabel, Surface, Symbol, WindowDragRegion } from "@ardia/shell";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { switchOn } from "../lib/killSwitches";
import { live } from "../live/store";
import { everySlowly } from "../lib/slowTimers";
import { layout, ThemeScope, useTheme } from "../lib/theme";
import { useBrowser } from "../store/browser";
import { PageProfileContext, useIsIncognito, useSettings, useWindowId, useWindowProfileId } from "../store/hooks";
import { activeTabId } from "../store/model";
import { downloadsIn } from "../store/ui";
import { ancestorIds } from "../store/groups";
import { cleanedTabsFor, cleanUpCandidates, groupOf } from "../store/organize";
import { isPlainSpaceSwitch } from "../store/spaceSwitch";
import { splitOf } from "../store/splits";
import { openNewTabInSplit } from "./layout/splitActions";
import { listTopGap, SIDEBAR_FIELD, SIDEBAR_FOOTER_BUTTON, SIDEBAR_FOOTER_HEIGHT, SIDEBAR_HEADER_WITH_FIELD, useAddressBarInSidebar } from "./layout/windowLayout";
import { SIDEBAR_PLAYER_HEIGHT, SidebarPlayer, useSidebarPlayerTab } from "./media/SidebarPlayer";
import { HoverSlot } from "./HoverSlot";
import { LibraryPanel } from "./library/LibraryPanel";
import { useLibraryMotion } from "./library/motion";
import { blockLibraryWhile, toggleLibrary } from "./library/state";
import { libraryVisible, useLibraryVisible } from "./library/store";
import { IconButton, useHover } from "./primitives";
import { DownloadsButton } from "./Downloads";
import { PROFILE_INDICATOR_X, ProfileIndicator } from "./ProfileIndicator";
import { usePageStyle, usePagerPages } from "./layout/profilePager";
import { PROFILE_DOTS_HEIGHT, ProfileDots, useProfileDotsShown } from "./profiles/ProfileDots";
import { SidebarAddressRow, SidebarHeaderTools } from "./sidebar/AddressBar";
import { canTidyPins } from "../store/tidyPins";
import { ClearDivider, dividerHeight, useSidebarHoverProps } from "./sidebar/ClearDivider";
import { DragGhost, DropLine } from "./sidebar/DragGhost";
import { DragProvider, DragScope, useDragController, useDragging, useDragItem, usePinnedCount, type Ghost } from "./sidebar/dnd";
import { SidebarDropArea } from "./sidebar/fileDrop";
import { useClipped, useShift, type ClipSource, type EntryMotion } from "./sidebar/entryMotion";
import { sidebarEntries } from "./sidebar/entries";
import { FolderPanel } from "./sidebar/FolderPanel";
import { GroupBlock, HierarchyEntry } from "./sidebar/GroupBlock";
import { dismissHover, dismissHoverIn } from "./sidebar/hover";
import { capture, GhostSlot, ListMotionContext, newCapture, useListMotion, usePinnedMotion } from "./sidebar/listMotion";
import { openLibraryMenu, openOverflowMenu, openSidebarMenu } from "./sidebar/menus";
import { PinFieldZone, PinnedGrid, PinSlotZone } from "./sidebar/PinnedGrid";
import { pinColumnCap, pinGridHeight } from "./sidebar/pinZone";
import { PlusButton } from "./sidebar/PlusMenu";
import { ResizeHandle } from "./sidebar/ResizeHandle";
import { SCROLL_EDGE, ScrollEdgeLine, useScrollEdge } from "./sidebar/ScrollEdge";
import { entriesHeight, firstPaintEntries, rootLift, rootTrail, rowSpan, startsOffScreen, type Section } from "./sidebar/geometry";
import { usePinnedRoot } from "./sidebar/pinnedTree";
import { measureRow, useSidebarUi } from "./sidebar/state";
import { LibraryGlyph } from "./sidebar/LibraryGlyph";
import { SpaceHeader } from "./sidebar/SpaceHeader";
import { SplitRowItem, TabRowItem } from "./sidebar/TabRow";
import { closeFolderPanel } from "./sidebar/tileFolderUi";
import { useSidebarTokens } from "./sidebar/tokens";
import { toggleNewTabBar } from "./omnibox/newTabBar";

const GLOW_ROOM = 24;
const ROW_PITCH = layout.rowHeight + layout.rowGap;
const DOCKED_BOTTOM = 6;
const ROWS_PER_FRAME = 32;
const DOCK_SHARE = 0.4;
const FOOTER_INACTIVE_OPACITY = 0.55;
const NONE: string[] = [];

export function Sidebar({ width }: { width: number }) {
  const theme = useTheme();
  const footerTint = theme.dark ? "#FFFFFF99" : theme.textTertiary;
  const windowId = useWindowId();
  const current = useWindowProfileId();
  const library = useLibraryVisible(windowId);
  const [pageCurrent, setPageCurrent] = useState(current);
  const { pages, paging } = usePagerPages(windowId);
  const [available, setAvailable] = useState(0);
  const listHeights = useRef(new Map<string, number>());
  const [, setDockChanges] = useState(0);
  const newTabAtTop = useSettings((s) => s.newTabPosition === "top");
  const dockedPage = (profileId: string) => !addressBar && !newTabAtTop && available > 0 && (listHeights.current.get(profileId) ?? 0) + ROW_PITCH + 12 > available;
  const docking = useRef(dockedPage);
  docking.current = dockedPage;
  const [onListHeight] = useState(() => (profileId: string, height: number) => {
    const before = docking.current(profileId);
    listHeights.current.set(profileId, height);
    if (docking.current(profileId) !== before) setDockChanges((n) => n + 1);
  });
  const scroll = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const dragController = useRef<ReturnType<typeof useDragController>>(undefined);
  const [onScrollView] = useState(() => (v: ScrollView | null) => {
    scroll.current = v;
    const controller = dragController.current;
    if (controller) controller.scroll = v;
  });
  const [onScrollY] = useState(() => (y: number) => {
    scrollY.current = y;
    const controller = dragController.current;
    if (controller) controller.scrolled(y);
    dismissHover();
    closeFolderPanel();
  });
  const geometry = useRef<SidebarGeometry>({ viewport: 0, regions: { pinned: 0, list: 0 }, newTabAtTop: false, room: 0, pad: 0, tilesFixed: true });
  const [wakeReveal] = useState(() => () => geometry.current.laidOut?.());
  const motion = useLibraryMotion(windowId, library, width, wakeReveal);
  const faceRest = motion.rest;
  const [pageReady] = useState(() => () => {
    const ready = geometry.current.ready;
    return !!ready && ready.view === scroll.current && ready.profileId === useBrowser.getState().windows[windowId]?.profileId && !libraryVisible(windowId) && faceRest.current;
  });
  const addressBar = useAddressBarInSidebar();
  const header = addressBar ? SIDEBAR_HEADER_WITH_FIELD : layout.sidebarHeader;
  const glowRoom = addressBar ? 0 : GLOW_ROOM;
  const hasDownloads = useBrowser((s) => downloadsIn(s, windowId).length > 0);
  const dots = useProfileDotsShown();
  const footerButtons = addressBar && dots;
  const footerDownloads = addressBar && hasDownloads && !footerButtons;
  const footer = dots || footerDownloads ? (addressBar ? SIDEBAR_FOOTER_HEIGHT : PROFILE_DOTS_HEIGHT) : 0;
  const nothingPinned = useBrowser((s) => sidebarEntries(s, windowId, current).tiles.length === 0);

  const sidebarHover = useSidebarHoverProps(windowId);
  useRevealTabs(windowId, scroll, scrollY, geometry, pageReady);
  useEffect(() => {
    if (pageCurrent === current) return void geometry.current.laidOut?.();
    const frame = requestAnimationFrame(() => {
      if (useBrowser.getState().windows[windowId]?.profileId === current) setPageCurrent(current);
    });
    return () => cancelAnimationFrame(frame);
  }, [windowId, current, pageCurrent]);
  useLayoutEffect(() => dismissHoverIn(windowId), [windowId, current, paging]);
  useEffect(() => blockLibraryWhile(windowId, () => !!dragController.current?.active), [windowId]);

  return (
    <DragProvider>
      {(ghost: Ghost | null, controller) => {
        dragController.current = controller;
        const shown = !paging || controller.active ? current : pageCurrent;
        return (
          <SidebarDropArea
            accepts={pageReady}
            ref={(v) => {
              controller.root = v;
              controller.windowId = windowId;
            }}
            style={{ width, height: "100%" }}
          >
            <Animated.View pointerEvents={motion.rested ? "box-none" : "none"} style={[StyleSheet.absoluteFill, motion.faceStyle]}>
              <Surface hidesAccessibility={!motion.rested} style={StyleSheet.absoluteFill}>
                <View
                  {...sidebarHover}
                  pointerEvents={shown === current ? "auto" : "none"}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: header - glowRoom,
                    bottom: footer,
                    overflow: paging ? "hidden" : "visible",
                  }}
                  onLayout={(e) => setAvailable(e.nativeEvent.layout.height)}
                >
                  {pages.map((page) => (
                    <SidebarPage
                      key={page.id}
                      profileId={page.id}
                      slot={page.slot}
                      width={width}
                      current={page.id === shown}
                      resting={!!page.resting}
                      docked={dockedPage(page.id)}
                      glowRoom={glowRoom}
                      height={available}
                      rows={page.id === shown ? undefined : Math.ceil(available / ROW_PITCH) + 1}
                      geometry={page.id === shown ? geometry : undefined}
                      bottomLine={addressBar && footer > 0}
                      onListHeight={onListHeight}
                      onScrollView={onScrollView}
                      onScrollY={onScrollY}
                    />
                  ))}
                </View>

                {footer ? (
                  <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: footer }}>
                    <Surface inactiveOpacity={addressBar && theme.dark ? FOOTER_INACTIVE_OPACITY : undefined} style={[StyleSheet.absoluteFill, { justifyContent: "flex-end" }]}>
                      {dots ? <ProfileDots windowId={windowId} width={width} reserve={footerButtons || footerDownloads ? layout.sidebarInset + SIDEBAR_FOOTER_BUTTON.size : 0} /> : null}
                      {footerButtons ? (
                        <>
                          <View style={{ position: "absolute", left: layout.sidebarInset, bottom: SIDEBAR_FOOTER_BUTTON.bottom }}>
                            <ContextMenuArea onContextMenu={() => void openLibraryMenu(windowId)}>
                              <IconButton glyph={(tint) => <LibraryGlyph color={tint} />} color={footerTint} box={SIDEBAR_FOOTER_BUTTON.size} radius={10} tooltip="Library" onPress={() => toggleLibrary(windowId)} />
                            </ContextMenuArea>
                          </View>
                          <View style={{ position: "absolute", right: layout.sidebarInset, bottom: SIDEBAR_FOOTER_BUTTON.bottom }}>
                            <PlusButton windowId={windowId} color={footerTint} />
                          </View>
                        </>
                      ) : footerDownloads ? (
                        <View style={{ position: "absolute", left: layout.sidebarInset, bottom: SIDEBAR_FOOTER_BUTTON.bottom }}>
                          <DownloadsButton windowId={windowId} />
                        </View>
                      ) : null}
                    </Surface>
                  </View>
                ) : null}

                <View style={{ height: header }}>
                  <WindowDragRegion style={StyleSheet.absoluteFill} />
                  {addressBar ? (
                    <>
                      <SidebarHeaderTools width={width} />
                      <SidebarAddressRow width={width} />
                    </>
                  ) : (
                    <View pointerEvents="box-none" style={{ height: layout.sidebarHeader, flexDirection: "row", alignItems: "flex-start", paddingLeft: PROFILE_INDICATOR_X, paddingRight: 7, paddingTop: 27 - 17 }}>
                      <ProfileIndicator room={width - PROFILE_INDICATOR_X - 7 - (hasDownloads ? 34 + 2 : 0)} />
                      <View pointerEvents="none" style={{ flex: 1 }} />
                      {hasDownloads ? <DownloadsButton windowId={windowId} /> : null}
                    </View>
                  )}
                </View>
              </Surface>
            </Animated.View>
            {motion.present && motion.view ? (
              <View pointerEvents={motion.entered ? "box-none" : "none"} style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
                <Animated.View style={[StyleSheet.absoluteFill, motion.slideStyle]}>
                  <Surface hidesAccessibility={!library} style={StyleSheet.absoluteFill}>
                    <LibraryPanel windowId={windowId} width={width} view={motion.view} active={library} />
                  </Surface>
                </Animated.View>
              </View>
            ) : null}
            {motion.moving ? <MotionCatcher /> : null}

            <ResizeHandle windowId={windowId} />
            {ghost && !ghost.landing && nothingPinned ? (
              addressBar ? (
                <PinFieldZone top={SIDEBAR_FIELD.top} height={SIDEBAR_FIELD.height} />
              ) : (
                <PinSlotZone />
              )
            ) : null}
            <FolderPanel windowId={windowId} />
            <DropLine />
            {ghost ? <DragGhost ghost={ghost} /> : null}
          </SidebarDropArea>
        );
      }}
    </DragProvider>
  );
}

const IGNORE = () => {};

function MotionCatcher() {
  return (
    <ContextMenuArea captureDescendants onContextMenu={IGNORE} style={StyleSheet.absoluteFill}>
      <Pressable focusable={false} style={StyleSheet.absoluteFill} />
    </ContextMenuArea>
  );
}

type PageProps = {
  profileId: string;
  slot: number;
  width: number;
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

const SidebarPage = memo(function SidebarPage({ profileId, slot, width, current, resting, docked, glowRoom, height, rows, geometry, bottomLine, onListHeight, onScrollView, onScrollY }: PageProps) {
  const windowId = useWindowId();
  const addressBar = useAddressBarInSidebar();
  const incognito = useIsIncognito();
  const topGap = listTopGap(addressBar);
  const pinColumns = pinColumnCap(addressBar);
  const pageStyle = usePageStyle(windowId, slot, width);
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
  const tiles = useBrowser((s) => (offScreen ? NONE : sidebarEntries(s, windowId, profileId).cells));
  const innerWidth = width - layout.sidebarInset * 2;
  const dragging = useDragging() && current;
  const previewed = usePinnedCount(tiles);
  const dockRoom = height ? (height - playerHeight) * DOCK_SHARE - topGap - SCROLL_EDGE.gap - SCROLL_EDGE.line : Infinity;
  const balanced = useBrowser((s) => s.settings.balancedTopApps);
  const gridHeight = (count: number) => pinGridHeight(count, innerWidth, layout.pinnedHeight, pinColumns, balanced);
  const placedFixed = useRef(true);
  if (!dragging) placedFixed.current = !tiles.length || gridHeight(tiles.length) <= dockRoom;
  const dockFixed = placedFixed.current;
  const capped = dockFixed && dragging && gridHeight(previewed) > dockRoom;
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
      pointerEvents={current ? "auto" : "none"}
      style={{ position: "absolute", top: 0, bottom: 0, left: 0, width, display: resting ? "none" : "flex", ...pageStyle }}
    >
      <Surface hidesAccessibility={!current} style={{ flex: 1 }}>
        <PageProfileContext.Provider value={profileId}>
          <ThemeScope>
            <DragScope enabled={current}>
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
                        {dockFixed ? <PinnedGrid tabs={fixedTiles} innerWidth={innerWidth} /> : null}
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
                      <Animated.View style={{ flex: 1, transform: [{ translateY: Animated.multiply(edge, -1) }] }}>
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
                            followExtent();
                          }}
                          style={{ flex: 1 }}
                          showsVerticalScrollIndicator={false}
                          scrollEventThrottle={16}
                          onScroll={onScroll}
                          contentContainerStyle={{ flexGrow: 1, width, paddingHorizontal: layout.sidebarInset, paddingTop: pad }}
                        >
                          <PageRows
                            windowId={windowId}
                            profileId={profileId}
                            current={current}
                            rows={rows}
                            lazy={lazy}
                            offScreen={offScreen}
                            tiles={scrolledTiles}
                            headerTop={headerTop}
                            innerWidth={innerWidth}
                            inlineNewTab={inlineNewTab}
                            controller={controller}
                            geometry={geometry}
                            origins={origins}
                            onListHeight={reportList}
                          />
                          <ContextMenuArea style={{ flexGrow: 1, minHeight: inlineNewTab ? 24 : 0 }} onContextMenu={() => void openSidebarMenu(windowId)}>
                            <WindowDragRegion style={{ flex: 1 }} titleBarDoubleClick={false} onRegionDoubleClick={() => toggleNewTabBar(windowId) || useBrowser.getState().newTab(windowId, { newTabCommand: true })} />
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

type PageRowsProps = {
  windowId: string;
  profileId: string;
  current: boolean;
  rows: number | undefined;
  lazy: boolean;
  offScreen: boolean;
  tiles: string[];
  headerTop: number;
  innerWidth: number;
  inlineNewTab: boolean;
  controller: ReturnType<typeof useDragController>;
  geometry: RefObject<SidebarGeometry> | undefined;
  origins: Record<Section, number>;
  onListHeight: (height: number) => void;
};

function PageRows({ windowId, profileId, current, rows, lazy, offScreen, tiles, headerTop, innerWidth, inlineNewTab, controller, geometry, origins, onListHeight }: PageRowsProps) {
  const [captured] = useState(newCapture);
  const { list: all } = useBrowser((s) => {
    const entries = sidebarEntries(s, windowId, profileId);
    return capture(captured, s, entries.list, entries);
  });
  const [pinnedCaptured] = useState(newCapture);
  const pinned = usePinnedRoot(windowId, profileId, (s, list) => capture(pinnedCaptured, s, list, list));
  const [mountedRows, setMountedRows] = useState(() => firstPaintEntries(useBrowser.getState(), windowId, profileId, all, lazy));
  const [visited, setVisited] = useState(current);
  if (current && !visited) setVisited(true);
  const cap = offScreen ? 0 : visited ? undefined : rows;
  const growing = cap === undefined && mountedRows < all.length;
  useEffect(() => {
    if (!growing) return;
    const frame = requestAnimationFrame(() => setMountedRows((n) => (n + ROWS_PER_FRAME >= all.length ? Infinity : n + ROWS_PER_FRAME)));
    return () => cancelAnimationFrame(frame);
  }, [growing, mountedRows, all.length]);
  const limit = cap ?? (growing ? mountedRows : undefined);
  const list = limit === undefined ? all : all.slice(0, limit);
  const pending = useBrowser((s) => (growing ? entriesHeight(s, windowId, profileId, all.slice(mountedRows)) : 0));
  const showClear = useSettings((s) => s.showClearButton);
  const clearable = showClear && !offScreen && all.length > 0;
  const tidy = useBrowser((s) => !offScreen && canTidyPins(s, windowId, profileId));
  const divided = clearable || tidy;
  const pinnedSection = pinned.length > 0;
  const addressBar = useAddressBarInSidebar();
  const incognito = useIsIncognito();
  const newTabsAtTopSetting = useSettings((s) => s.newTabPosition === "top");
  const newTabsAtTop = newTabsAtTopSetting;
  const spaceHeader = addressBar && !incognito;
  const animated = current && !offScreen;
  const motion = useListMotion(windowId, profileId, all, captured, animated);
  const boundary = (list: string[]) => {
    const section = list.length > 0;
    return {
      above: spaceHeader ? (section ? layout.rowGap : 0) : tiles.length ? 6 : 0,
      below: rootTrail(addressBar, list) + (divided ? dividerHeight(section, addressBar) : section ? 7 : 0),
    };
  };
  const pinnedMotion = usePinnedMotion(windowId, profileId, pinned, pinnedCaptured, animated, boundary);
  const liftOf = (entry: string) => rootLift(addressBar, pinned[pinned.indexOf(entry) - 1], entry);
  const scope = useMemo(() => ({ enabled: animated, slideBelow: motion.slideBelow }), [animated, motion.slideBelow]);
  if (geometry) geometry.current.newTabAtTop = newTabsAtTop && inlineNewTab;
  return (
    <ListMotionContext.Provider value={scope}>
      <View
        onLayout={(e) => onListHeight(e.nativeEvent.layout.height + SCROLL_EDGE.inset - (inlineNewTab ? ROW_PITCH : 0))}
      >
        {tiles.length ? <PinnedGrid tabs={tiles} innerWidth={innerWidth} flush /> : null}
        {spaceHeader && tiles.length ? <SpaceHeader windowId={windowId} profileId={profileId} top={headerTop} /> : null}
        <View
          ref={(v) => {
            controller?.regions.set("pinned", v);
          }}
          onLayout={(e) => {
            origins.pinned = e.nativeEvent.layout.y;
            if (geometry) geometry.current.regions.pinned = e.nativeEvent.layout.y;
          }}
          style={{ marginTop: spaceHeader ? (pinnedSection ? layout.rowGap : 0) : tiles.length ? 6 : 0, marginBottom: offScreen ? 0 : rootTrail(addressBar, pinned), gap: layout.rowGap }}
        >
          {offScreen
            ? null
            : pinnedMotion.slots(pinned).map((slot) =>
                "ghost" in slot ? (
                  <GhostSlot key={slot.ghost.key} snapshot={slot.ghost.snapshot} top={slot.top} opacity={slot.ghost.opacity} />
                ) : (
                  <RootEntry key={slot.entry} entry={slot.entry} lift={liftOf(slot.entry)} motion={pinnedMotion.motion(slot.entry)} />
                ),
              )}
          <Tail id="tail:pinned" section="pinned" />
        </View>
        {pinnedMotion.tail && !offScreen ? <PinnedTail shift={pinnedMotion.tail} /> : null}
        {divided ? <ClearDivider windowId={windowId} profileId={profileId} spaced={pinnedSection} clear={clearable} tidy={tidy} flush={addressBar} /> : null}
        <View
          ref={(v) => {
            controller?.regions.set("list", v);
          }}
          onLayout={(e) => {
            origins.list = e.nativeEvent.layout.y;
            if (geometry) geometry.current.regions.list = e.nativeEvent.layout.y;
          }}
          style={{ marginTop: pinnedSection && !divided ? 7 : 0, gap: layout.rowGap }}
        >
          {newTabsAtTop && inlineNewTab ? <NewTabRow windowId={windowId} /> : null}
          {motion.fading
            ? motion.slots(list).map((slot) =>
                "ghost" in slot ? (
                  <GhostSlot key={slot.ghost.key} snapshot={slot.ghost.snapshot} top={slot.top} opacity={slot.ghost.opacity} />
                ) : (
                  <ListEntry key={slot.entry} entry={slot.entry} motion={motion.motion(slot.entry)} />
                ),
              )
            : list.map((entry) => <ListEntry key={entry} entry={entry} motion={motion.motion(entry)} />)}
          {pending ? <View style={{ height: pending }} /> : null}
          <Tail id="tail:list" section="list" />
          {!newTabsAtTop && inlineNewTab ? <NewTabRow windowId={windowId} shift={motion.tail} clip={motion.tailClip} /> : null}
        </View>
        {current ? <CleanUpUpsell windowId={windowId} shift={motion.tail} /> : null}
      </View>
    </ListMotionContext.Provider>
  );
}

function TilesPlacement({
  controller,
  fixed,
  room,
  columns,
  gap,
  children,
}: {
  controller: ReturnType<typeof useDragController>;
  fixed: boolean;
  room: number;
  columns: number;
  gap: number;
  children: ReactNode;
}) {
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

function PageContent({ children }: { children: (controller: ReturnType<typeof useDragController>) => ReactNode }) {
  return <>{children(useDragController())}</>;
}

const ListEntry = memo(function ListEntry({ entry, motion }: { entry: string; motion: EntryMotion | null }) {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return <GroupBlock groupId={id} section="list" motion={motion} />;
  if (entry.startsWith("s:")) return <SplitRowItem splitId={id} section="list" motion={motion} />;
  return <TabRowItem tabId={id} section="list" motion={motion} />;
});

const RootEntry = memo(function RootEntry({ entry, lift, motion }: { entry: string; lift: number; motion: EntryMotion | null }) {
  return (
    <View style={lift ? { marginTop: lift } : null}>
      <HierarchyEntry entry={entry} section="pinned" motion={motion} />
    </View>
  );
});

const PinnedTail = memo(function PinnedTail({ shift }: { shift: Animated.Value }) {
  return <Animated.View style={{ marginTop: shift }} />;
});

const Tail = memo(function Tail({ id, section }: { id: string; section: Section }) {
  const { wrapper } = useDragItem(id, { kind: "tail", tabIds: [], section });
  return <Animated.View ref={wrapper.ref} style={wrapper.style} />;
});

type SidebarGeometry = { viewport: number; regions: Record<Section, number>; newTabAtTop: boolean; room: number; pad: number; tilesFixed: boolean; ready?: { profileId: string; view: ScrollView }; laidOut?: () => void };

function useRevealTabs(windowId: string, scroll: RefObject<ScrollView | null>, scrollY: RefObject<number>, geometry: RefObject<SidebarGeometry>, ready: () => boolean) {
  useEffect(() => {
    let switched: string | null = null;
    let opened: string | null = null;
    let frame = 0;
    let reveals = 0;
    const show = (view: ScrollView, y: number, height: number) => {
      const top = scrollY.current ?? 0;
      const { viewport, room, pad } = geometry.current;
      if (y - top < room) view.scrollTo({ y: Math.max(0, y - pad), animated: true });
      else if (y + height - top > viewport - 8) view.scrollTo({ y: y + height - viewport + 8, animated: true });
    };
    const forget = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      switched = opened = null;
      reveals++;
    };
    const reveal = () => {
      frame = 0;
      const scroller = scroll.current;
      if (!geometry.current.viewport || !scroller || !ready()) return;
      const mine = ++reveals;
      const tabId = switched ?? opened;
      switched = opened = null;
      const s = useBrowser.getState();
      const profileId = s.windows[windowId]?.profileId;
      if (!tabId || !profileId) return;
      const stillWanted = () => mine === reveals && scroll.current === scroller && useBrowser.getState().windows[windowId]?.profileId === profileId && ready();
      const pinned = s.tabs[tabId];
      if (geometry.current.tilesFixed && pinned?.pinned && !pinned.pinnedAsRow) return;
      const { regions, newTabAtTop } = geometry.current;
      const span = rowSpan(s, windowId, profileId, tabId, newTabAtTop);
      const pinnedHasLive = span?.section === "pinned" && live().folderOrder.some((id) => live().folders[id]?.profileId === profileId);
      if (span && !pinnedHasLive) return show(scroller, geometry.current.pad + regions[span.section] + span.top, span.height);
      const view = scroller as unknown as View;
      const split = splitOf(s, tabId);
      const inner = groupOf(s, tabId);
      const keys = [tabId, ...(split ? [`s:${split.id}`] : []), ...(inner ? [inner.id, ...ancestorIds(s.groups, inner.id)] : [])];
      const firstShown = (i: number): Promise<Awaited<ReturnType<typeof measureRow>>> =>
        i >= keys.length || !stillWanted() ? Promise.resolve(null) : measureRow(windowId, keys[i]!).then((row) => row ?? firstShown(i + 1));
      void firstShown(0).then((row) =>
        row && stillWanted() && view.measureInWindow((_x, y) => stillWanted() && show(scroller, row.y - y + (scrollY.current ?? 0), row.height)),
      );
    };
    const schedule = () => {
      if ((switched || opened) && !frame) frame = requestAnimationFrame(reveal);
    };
    const unrequest = useSidebarUi.subscribe((u, prev) => {
      if (u.reveal === prev.reveal || u.reveal?.windowId !== windowId) return;
      switched = u.reveal.id;
      reveals++;
      schedule();
    });
    const unsubscribe = useBrowser.subscribe((s, prev) => {
      if (s.windows === prev.windows && s.tabs === prev.tabs) return;
      const w = s.windows[windowId];
      const before = prev.windows[windowId];
      const crossed = !!w && !!before && w.profileId !== before.profileId;
      if (crossed) forget();
      const active = activeTabId(s, windowId);
      if (active && active !== activeTabId(prev, windowId) && !(crossed && isPlainSpaceSwitch(w))) {
        switched = active;
        reveals++;
      }
      if (w && before && w.tabIds !== before.tabIds) {
        const had = new Set(before.tabIds);
        for (const id of w.tabIds)
          if (!had.has(id) && s.tabs[id]?.openerId && id !== active) {
            opened = id;
            reveals++;
          }
      }
      schedule();
    });
    geometry.current.laidOut = schedule;
    return () => {
      forget();
      unsubscribe();
      unrequest();
      geometry.current.laidOut = undefined;
    };
  }, [windowId]);
}

const CLIPPED = { marginTop: -layout.rowGap, paddingTop: layout.rowGap, overflow: "hidden" } as const;
const NEW_TAB_LABEL_X = 30;
const CLEANED_HINT_RIGHT = 30;
const CLEANED_HINT_GAP = 8;
const MEASURE_OFFSCREEN = { position: "absolute", width: 1000, height: 0, overflow: "hidden", opacity: 0 } as const;
const ARC_NEW_TAB = { size: 14, icon: "#FFFFFF80", label: "#FFFFFF76" } as const;

const NewTabRow = memo(function NewTabRow({ windowId, shift = null, clip = null }: { windowId: string; shift?: Animated.Value | null; clip?: ClipSource | null }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const cleaned = useBrowser((s) => cleanedTabsFor(s, windowId).length);
  const addressBar = useAddressBarInSidebar();
  const restingChevron = !addressBar;
  const arcDark = addressBar && theme.dark;
  const { hovered, hoverProps } = useHover();
  const [moved, movedRef] = useShift(shift);
  const [movedButtons, movedButtonsRef] = useShift(shift);
  const clipped = useClipped(clip);
  const [widths, setWidths] = useState({ row: 0, label: 0, hint: 0 });
  const measure = (key: keyof typeof widths) => (e: LayoutChangeEvent) => {
    const width = Math.ceil(e.nativeEvent.layout.width);
    setWidths((w) => (w[key] === width ? w : { ...w, [key]: width }));
  };
  const hint = `${cleaned} cleaned`;
  const hintFits = widths.hint > 0 && NEW_TAB_LABEL_X + widths.label + CLEANED_HINT_GAP + widths.hint <= widths.row - CLEANED_HINT_RIGHT;
  return (
    <View {...hoverProps} onLayout={measure("row")} style={[{ flexDirection: "row", alignItems: "center" }, clipped ? CLIPPED : null]}>
      <View pointerEvents="none" style={MEASURE_OFFSCREEN}>
        <Text numberOfLines={1} style={{ alignSelf: "flex-start", fontSize: layout.rowFontSize }} onLayout={measure("label")}>
          New Tab
        </Text>
        {cleaned > 0 ? (
          <Text numberOfLines={1} style={{ alignSelf: "flex-start", fontSize: 11 }} onLayout={measure("hint")}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Pressable
        style={{ flex: 1 }}
        onPress={(e) => {
          if ((e.nativeEvent as unknown as { altKey?: boolean }).altKey) openNewTabInSplit(windowId);
          else toggleNewTabBar(windowId) || useBrowser.getState().newTab(windowId, { newTabCommand: true });
        }}
      >
        {({ pressed }) => (
          <View
            {...moved}
            ref={movedRef}
            style={[
              {
                height: layout.rowHeight,
                borderRadius: layout.rowRadius,
                flexDirection: "row",
                alignItems: "center",
                paddingLeft: layout.rowPadding,
                paddingRight: 34,
                backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
              },
              moved.style as object,
            ]}
          >
            <Symbol name="plus" size={addressBar ? ARC_NEW_TAB.size : 13} weight="medium" color={arcDark ? ARC_NEW_TAB.icon : tokens.newTabIcon} style={{ width: 16, height: 16 }} />
            <FadeLabel text="New Tab" fontSize={layout.rowFontSize} color={arcDark ? ARC_NEW_TAB.label : tokens.newTabLabel} style={{ flex: 1, height: 18, marginLeft: layout.rowLabelGap }} />
          </View>
        )}
      </Pressable>
      <View {...movedButtons} ref={movedButtonsRef} style={[{ position: "absolute", right: 6, flexDirection: "row", alignItems: "center" }, movedButtons.style as object]}>
        <HoverSlot hovered={hovered && cleaned > 0 && hintFits} width={0} hover={<Text style={{ fontSize: 11, color: theme.textTertiary, marginRight: 2 }}>{hint}</Text>} />
        <View style={{ opacity: hovered || restingChevron ? 1 : 0 }}>
          <IconButton
            icon="chevron.down"
            size={10}
            weight="semibold"
            box={22}
            radius={6}
            color={hovered ? theme.textSecondary : theme.textTertiary}
            tooltip="Open and recently closed tabs"
            onPress={() => void openOverflowMenu(windowId)}
          />
        </View>
      </View>
    </View>
  );
});

const UPSELL_MIN = 10;
let upsellDeclined = false;

const CleanUpUpsell = memo(function CleanUpUpsell({ windowId, shift }: { windowId: string; shift: Animated.Value | null }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const [count, setCount] = useState(0);
  const [hidden, setHidden] = useState(upsellDeclined);
  const daily = useBrowser((s) => s.settings.cleanUpInactiveTabsAfterHours !== null);
  const tabIds = useBrowser((s) => s.windows[windowId]?.tabIds);
  const profileId = useBrowser((s) => s.windows[windowId]?.profileId);
  const activeId = useBrowser((s) => activeTabId(s, windowId));
  const off = hidden || daily;
  useEffect(() => {
    if (off) return;
    const check = () => setCount(cleanUpCandidates(useBrowser.getState(), windowId).length);
    check();
    return everySlowly({ every: 60_000, run: check });
  }, [windowId, off, tabIds, profileId, activeId]);
  const [moved, movedRef] = useShift(shift);
  if (off || count < UPSELL_MIN) return null;
  const button = (title: string, onPress: () => void, primary = false) => (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View
          style={{
            height: 24,
            borderRadius: 7,
            paddingHorizontal: 8,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? tokens.upsellButtonHover : primary ? theme.textPrimary : tokens.upsellButton,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "500", color: primary ? (theme.dark ? "#000000" : "#FFFFFF") : theme.textPrimary }}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
  const dismiss = () => {
    upsellDeclined = true;
    setHidden(true);
  };
  return (
    <View {...moved} ref={movedRef} style={[{ marginTop: 10, borderRadius: 12, padding: 10, backgroundColor: tokens.groupFill, borderWidth: 0.5, borderColor: tokens.groupStroke, gap: 8 }, moved.style as object]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Symbol name="wand.and.stars" size={12} color={theme.icon} style={{ width: 16, height: 16 }} />
        <Text style={{ flex: 1, fontSize: 12, fontWeight: "600", color: theme.textPrimary }}>{count} tabs haven’t been touched in a while</Text>
      </View>
      <Text style={{ fontSize: 12, color: theme.textSecondary }}>Ardia can tidy up for you. You can always reopen closed tabs from the ⌄ menu.</Text>
      <View style={{ gap: 6 }}>
        {button("Clean Up Once", () => {
          useBrowser.getState().cleanUpTabs(windowId);
          dismiss();
        }, true)}
        {button("Clean Up Daily", () => {
          useBrowser.getState().updateSettings({ cleanUpInactiveTabsAfterHours: 24 });
          useBrowser.getState().cleanUpTabs(windowId);
        })}
        {button("Not Now", dismiss)}
      </View>
    </View>
  );
});
