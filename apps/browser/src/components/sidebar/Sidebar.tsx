import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Button, ContextMenuArea, Surface, WindowDragRegion } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { currentWindow } from "../../state/browser/current";
import { useSettings, useWindowId, useWindowProfileId } from "../../state/browser/hooks";
import { useHasDownloads, useNoTiles, useTileCellCount } from "../../state/sidebar/hooks";
import { AddressBarScope, useAddressBarInSidebar, useToolbarLightsCenter } from "../../state/windows/layout";
import { usePagerPages } from "../../state/windows/profilePager";
import { blockLibraryWhile, toggleLibrary } from "../../state/library/actions";
import { libraryVisible } from "../../state/library/store";
import { useLibraryVisible } from "../../state/library/hooks";
import { dismissHover, dismissHoverIn } from "../../state/sidebar/hover";
import { closeFolderPanel } from "../../state/sidebar/tileFolderUi";
import { openSidebarMenu } from "../../state/sidebar/menus";
import { openLibraryMenu } from "../../state/sidebar/arcMenus";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "../../state/sidebar/sidebarWidth";
import { useUpsellShift } from "../../state/sidebar/upsellShift";
import { DownloadsButton } from "../downloads/DownloadsButton";
import { LibraryPanel } from "../library/LibraryPanel";
import { useLibraryMotion } from "../library/motion";
import { PROFILE_INDICATOR_X, ProfileIndicator } from "../profiles/ProfileIndicator";
import { PROFILE_DOTS_HEIGHT, ProfileDots, useProfileDotsShown } from "../profiles/ProfileDots";
import { SidebarAddressRow, SidebarHeaderTools } from "./AddressBar";
import { useSidebarHoverProps } from "./ClearDivider";
import { DragGhost, DropLine } from "./DragGhost";
import { DragProvider } from "./DragProvider";
import type { Ghost } from "./dragModel";
import { SidebarDropArea } from "./SidebarDropArea";
import { FolderPanel } from "./FolderPanel";
import { LibraryGlyph } from "./LibraryGlyph";
import { PinFieldZone, PinSlotZone } from "./PinnedGrid";
import { pinColumnCap, pinGridHeight } from "./pinZone";
import { PlusButton } from "./PlusMenu";
import { RecentDownloadsPeek, RecentDownloadsSurface, recentDownloadsButtonHover, recentDownloadsDockHover } from "./RecentDownloads";
import { ResizeHandle } from "./ResizeHandle";
import { RESIZE_BAND } from "./useResizeDrag";
import { SIDEBAR_FIELD, SIDEBAR_FOOTER_BUTTON, SIDEBAR_FOOTER_HEIGHT, SIDEBAR_HEADER_WITH_FIELD } from "./geometry";
import { GLOW_ROOM, ROW_PITCH, type SidebarGeometry } from "./pageLayout";
import { SidebarPage } from "./SidebarPage";
import { SidebarRowLookContext, useSidebarRowLookSource } from "./rowLook";
import { TileInnerProvider } from "./tileWidth";
import { SIDEBAR_FOOTER_TINT } from "./tokens";
import { useRevealTabs } from "./useRevealTabs";
import type { DragController } from "./dragController";

const FOOTER_INACTIVE_OPACITY = 0.55;
const LIVE_MIN = SIDEBAR_MIN_WIDTH - RESIZE_BAND;
const LIVE_MAX = SIDEBAR_MAX_WIDTH + RESIZE_BAND;
const AnimatedSurface = Animated.createAnimatedComponent(Surface);

export function Sidebar({ width, resizing, receipt }: { width: number; resizing: boolean; receipt: number | undefined }) {
  const theme = useTheme();
  const footerTint = theme.dark ? SIDEBAR_FOOTER_TINT : theme.textTertiary;
  const windowId = useWindowId();
  const current = useWindowProfileId();
  const library = useLibraryVisible(windowId);
  const [pageCurrent, setPageCurrent] = useState(current);
  const { pages, paging } = usePagerPages(windowId);
  const [available, setAvailable] = useState(0);
  const [arming] = useState(() => {
    let host: View | null = null;
    let armed = false;
    return {
      attach: (view: View | null) => {
        host = view;
        if (armed) host?.setNativeProps({ presentationArming: true });
      },
      set: (next: boolean) => {
        armed = next;
        host?.setNativeProps({ presentationArming: next });
      },
    };
  });
  const listHeights = useRef(new Map<string, number>());
  const [, setDockChanges] = useState(0);
  const newTabAtTop = useSettings((s) => s.newTabButtonPosition === "top");
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
  const dragController = useRef<DragController | undefined>(undefined);
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
  const geometry = useRef<SidebarGeometry>({ viewport: 0, content: 0, regions: { pinned: 0, list: 0 }, newTabAtTop: false, room: 0, pad: 0, tilesFixed: true });
  const [wakeReveal] = useState(() => () => geometry.current.laidOut?.());
  const motion = useLibraryMotion(windowId, library, width, wakeReveal);
  const [pageWidth] = useState(() => new Animated.Value(width));
  useLayoutEffect(() => pageWidth.setValue(width), [pageWidth, width]);
  const [tileInner] = useState(() => new Animated.Value(width - layout.sidebarInset * 2));
  useLayoutEffect(() => tileInner.setValue(width - layout.sidebarInset * 2), [tileInner, width]);
  const faceRest = motion.rest;
  const [pageReady] = useState(() => () => {
    const ready = geometry.current.ready;
    return !!ready && ready.view === scroll.current && ready.profileId === currentWindow(windowId)?.profileId && !libraryVisible(windowId) && faceRest.current;
  });
  const addressBar = useAddressBarInSidebar();
  const lightsY = useToolbarLightsCenter()[1];
  const header = addressBar ? SIDEBAR_HEADER_WITH_FIELD : layout.sidebarHeader;
  const glowRoom = addressBar ? 0 : GLOW_ROOM;
  const hasDownloads = useHasDownloads(windowId);
  const dots = useProfileDotsShown();
  const footerButtons = addressBar && dots;
  const footerDownloads = addressBar && hasDownloads && !footerButtons;
  const footer = dots || footerDownloads ? (addressBar ? SIDEBAR_FOOTER_HEIGHT : PROFILE_DOTS_HEIGHT) : 0;
  const nothingPinned = useNoTiles(windowId, current);
  const tileCells = useTileCellCount(windowId, current);
  const balancedTiles = useSettings((s) => s.balancedTopApps);
  const upsellShift = useUpsellShift((u) => u[windowId] ?? 0);
  const rowLook = useSidebarRowLookSource();
  const gridAt = (width: number) => pinGridHeight(tileCells, width - layout.sidebarInset * 2, layout.pinnedHeight, pinColumnCap(addressBar), balancedTiles);
  const tileShift = tileCells ? gridAt(LIVE_MIN) - gridAt(LIVE_MAX) : 0;
  const slack = geometry.current.content - scrollY.current - geometry.current.viewport;
  const shiftBound = tileShift + (upsellShift && slack < tileShift + upsellShift ? upsellShift : 0);

  const sidebarHover = useSidebarHoverProps(windowId);
  useRevealTabs(windowId, scroll, scrollY, geometry, pageReady);
  useEffect(() => {
    if (pageCurrent === current) return void geometry.current.laidOut?.();
    const frame = requestAnimationFrame(() => {
      if (currentWindow(windowId)?.profileId === current) setPageCurrent(current);
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
            }}
            style={{ width, height: "100%" }}
          >
            <AnimatedSurface refreshRasterOnRest={motion.rested} pointerEvents={motion.rested ? "box-none" : "none"} style={[StyleSheet.absoluteFill, motion.faceStyle]}>
              <RecentDownloadsSurface windowId={windowId} hidesAccessibility={!motion.rested} style={StyleSheet.absoluteFill}>
                <View
                  ref={arming.attach}
                  {...sidebarHover}
                  collapsable={false}
                  presentationSession={resizing}
                  presentationShiftBound={shiftBound}
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
                  <TileInnerProvider value={tileInner}>
                    <AddressBarScope>
                      <SidebarRowLookContext.Provider value={rowLook}>
                        {pages.map((page) => (
                          <SidebarPage
                            key={page.id}
                            profileId={page.id}
                            slot={page.slot}
                            pageWidth={pageWidth}
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
                      </SidebarRowLookContext.Provider>
                    </AddressBarScope>
                  </TileInnerProvider>
                </View>

                {footer ? (
                  <View {...(footerButtons ? recentDownloadsDockHover(windowId) : null)} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: footer }}>
                    <ContextMenuArea style={StyleSheet.absoluteFill} onContextMenu={() => void openSidebarMenu(windowId)} />
                    <Surface inactiveOpacity={addressBar && theme.dark ? FOOTER_INACTIVE_OPACITY : undefined} style={[StyleSheet.absoluteFill, { justifyContent: "flex-end" }]}>
                      {dots ? <ProfileDots windowId={windowId} width={width} reserve={footerButtons || footerDownloads ? layout.sidebarInset + SIDEBAR_FOOTER_BUTTON.size : 0} /> : null}
                      {footerButtons ? (
                        <>
                          <View {...recentDownloadsButtonHover(windowId)} style={{ position: "absolute", left: layout.sidebarInset, bottom: SIDEBAR_FOOTER_BUTTON.bottom }}>
                            <ContextMenuArea onContextMenu={() => void openLibraryMenu(windowId)}>
                              <Button
                                variant="icon"
                                glyph={(tint) => <LibraryGlyph color={tint} />}
                                color={footerTint}
                                box={SIDEBAR_FOOTER_BUTTON.size}
                                radius={10}
                                tooltip={hasDownloads ? undefined : "Library"}
                                onPress={() => toggleLibrary(windowId)}
                              />
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
                  <ContextMenuArea style={StyleSheet.absoluteFill} onContextMenu={() => void openSidebarMenu(windowId)}>
                    <WindowDragRegion style={StyleSheet.absoluteFill} />
                  </ContextMenuArea>
                  {addressBar ? (
                    <>
                      <SidebarHeaderTools width={width} />
                      <SidebarAddressRow width={width} receipt={receipt} />
                    </>
                  ) : (
                    <View pointerEvents="box-none" style={{ height: layout.sidebarHeader, flexDirection: "row", alignItems: "flex-start", paddingLeft: PROFILE_INDICATOR_X, paddingRight: 7, paddingTop: lightsY - 17 }}>
                      <ProfileIndicator room={width - PROFILE_INDICATOR_X - 7 - (hasDownloads ? 34 + 2 : 0)} />
                      <View pointerEvents="none" style={{ flex: 1 }} />
                      {hasDownloads ? <DownloadsButton windowId={windowId} /> : null}
                    </View>
                  )}
                </View>
              </RecentDownloadsSurface>
              {footerButtons ? <RecentDownloadsPeek windowId={windowId} /> : null}
            </AnimatedSurface>
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

            <ResizeHandle windowId={windowId} receipt={receipt} onArming={arming.set} />
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
