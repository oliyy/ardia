import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Animated, Text, View } from "react-native";
import { radius, Symbol, weight } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { useIsIncognito, useSettings } from "../../state/browser/hooks";
import { isIncognitoProfile } from "../../state/browser/model";
import { newCapture } from "../../state/sidebar/listCapture";
import { useCanTidyPins, useCapturedSidebarEntries, useKeptPin, usePinnedCollapsed } from "../../state/sidebar/hooks";
import { capture } from "../../state/sidebar/listCapture";
import { usePinnedRoot } from "../../state/sidebar/pinnedTree";
import { entryHeightNow, firstPaintEntriesNow, rootLift, rootTrail, usePendingEntriesHeight, type Section } from "../../state/sidebar/geometry";
import { parseEntry } from "../../state/sidebar/entryKey";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { INCOGNITO_ICON } from "../ntp/IncognitoHeading";
import { ClearDivider, dividerHeight } from "./ClearDivider";
import { useDragController, useDragItem } from "./DragProvider";
import { tailKey } from "./dragModel";
import type { EntryMotion } from "./EntryMotion";
import { Fold, FOLD_TIMING, useFold } from "./Fold";
import { GroupBlock, HierarchyEntry } from "./GroupBlock";
import { GhostSlot, ListMotionContext, useListMotion, usePinnedMotion } from "./ListMotion";
import type { SlideTiming } from "./listPlan";
import { PinnedGrid } from "./PinnedGrid";
import { SCROLL_EDGE } from "./ScrollEdge";
import { ROW_PITCH, ROWS_PER_FRAME, type SidebarGeometry } from "./pageLayout";
import { NewTabRow } from "./NewTabRow";
import { CleanUpUpsell } from "./CleanUpUpsell";
import { SpaceHeader } from "./SpaceHeader";
import { SplitRowItem, TabRowItem } from "./TabRow";
import { SIDEBAR_TYPE, sidebarTokens } from "./tokens";

const DOCKED_TILES_GAP = SCROLL_EDGE.gap + SCROLL_EDGE.line + SCROLL_EDGE.inset;

type PageRowsProps = {
  windowId: string;
  profileId: string;
  current: boolean;
  rows: number | undefined;
  lazy: boolean;
  offScreen: boolean;
  tiles: string[];
  underDockedTiles: boolean;
  headerTop: number;
  inlineNewTab: boolean;
  controller: ReturnType<typeof useDragController>;
  geometry: RefObject<SidebarGeometry> | undefined;
  origins: Record<Section, number>;
  onListHeight: (height: number) => void;
};

export function PageRows({ windowId, profileId, current, rows, lazy, offScreen, tiles, underDockedTiles, headerTop, inlineNewTab, controller, geometry, origins, onListHeight }: PageRowsProps) {
  const [captured] = useState(newCapture);
  const { list: all } = useCapturedSidebarEntries(windowId, profileId, captured);
  const [pinnedCaptured] = useState(newCapture);
  const pinned = usePinnedRoot(windowId, profileId, (s, list) => capture(pinnedCaptured, s, list, list));
  const [mountedRows, setMountedRows] = useState(() => firstPaintEntriesNow(windowId, profileId, all, lazy));
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
  const pending = usePendingEntriesHeight(windowId, profileId, all, mountedRows, growing);
  const showClear = useSettings((s) => s.showClearButton);
  const clearable = showClear && !offScreen && all.length > 0;
  const tidy = useCanTidyPins(windowId, profileId, offScreen);
  const pinnedSection = pinned.length > 0;
  const addressBar = useAddressBarInSidebar();
  const incognito = useIsIncognito();
  const divided = clearable || tidy || (!addressBar && pinnedSection);
  const newTabsAtTop = useSettings((s) => s.newTabButtonPosition === "top");
  const spaceHeader = addressBar && !incognito;
  const pinsCollapsed = usePinnedCollapsed(profileId);
  const pinsFold = useFold(pinsCollapsed);
  const keptPin = useKeptPin(windowId, profileId, pinned, pinsCollapsed || pinsFold.moving);
  const lift = underDockedTiles && !pinnedSection && !isIncognitoProfile(profileId) ? DOCKED_TILES_GAP : 0;
  const animated = current && !offScreen;
  const motion = useListMotion(windowId, profileId, all, captured, animated);
  const boundary = (list: string[]) => {
    const section = list.length > 0;
    return {
      above: spaceHeader ? (section ? layout.rowGap : 0) : tiles.length ? 6 : 0,
      below: rootTrail(addressBar, list) + (divided ? dividerHeight(section, addressBar, lift) : section ? 7 : 0),
    };
  };
  const pinnedMotion = usePinnedMotion(windowId, profileId, pinned, pinnedCaptured, animated && !pinsCollapsed, boundary);
  const liftOf = (entry: string) => rootLift(addressBar, pinned[pinned.indexOf(entry) - 1], entry);
  const fold = useMemo(
    () => ({
      pinned: (entry: string, delta: number, timing: SlideTiming = FOLD_TIMING) => pinnedMotion.slideBelow(entry, delta, { timing, tail: true }),
      list: (entry: string, delta: number, timing: SlideTiming = FOLD_TIMING) => motion.slideBelow(entry, delta, { timing, tail: true }),
    }),
    [pinnedMotion.slideBelow, motion.slideBelow],
  );
  const scope = useMemo(() => ({ enabled: animated, slideBelow: motion.slideBelow, fold }), [motion.slideBelow, fold]);
  scope.enabled = animated;
  const tailShift = offScreen ? null : pinnedMotion.tail;
  const tailStyle = useMemo(() => (tailShift ? { transform: [{ translateY: tailShift }] } : null), [tailShift]);
  const listAt = useRef({ tail: 0, list: 0 }).current;
  const placeList = (part: "tail" | "list", y: number) => {
    listAt[part] = y;
    origins.list = listAt.tail + listAt.list;
    if (geometry) geometry.current.regions.list = origins.list;
  };
  if (geometry) geometry.current.newTabAtTop = newTabsAtTop && inlineNewTab;
  return (
    <ListMotionContext.Provider value={scope}>
      <View onLayout={(e) => onListHeight(e.nativeEvent.layout.height + SCROLL_EDGE.inset - (inlineNewTab ? ROW_PITCH : 0))}>
        {isIncognitoProfile(profileId) ? <IncognitoBadge /> : null}
        {tiles.length ? <PinnedGrid tabs={tiles} flush /> : null}
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
          {offScreen ? null : (
            <Fold
              fold={pinsFold}
              collapsed={pinsCollapsed}
              entries={pinnedMotion.slots(pinned).map((slot) =>
                "ghost" in slot
                  ? { key: slot.ghost.key, ghost: true, node: <GhostSlot snapshot={slot.ghost.snapshot} top={slot.top} opacity={slot.ghost.opacity} /> }
                  : {
                      key: slot.entry,
                      node: <RootEntry entry={slot.entry} lift={liftOf(slot.entry)} motion={pinnedMotion.motion(slot.entry)} peek={pinsCollapsed && slot.entry === keptPin} />,
                    },
              )}
              keep={keptPin}
              gap={layout.rowGap}
              rowHeight={pinsFold.moving ? (entry) => entryHeightNow(windowId, profileId, entry) : layout.rowHeight}
              keepMounted
            />
          )}
          <Tail section="pinned" />
        </View>
        <Animated.View pointerEvents="box-none" style={tailStyle} onLayout={(e) => placeList("tail", e.nativeEvent.layout.y)}>
          {divided ? (
            <ClearDivider
              windowId={windowId}
              profileId={profileId}
              spaced={pinnedSection}
              lift={lift}
              clear={clearable}
              tidy={tidy}
              pinned={!addressBar && pinnedSection ? { collapsed: pinsCollapsed, open: pinsFold.open } : null}
              flush={addressBar}
            />
          ) : null}
          <View
            ref={(v) => {
              controller?.regions.set("list", v);
            }}
            onLayout={(e) => placeList("list", e.nativeEvent.layout.y)}
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
            <Tail section="list" />
            {!newTabsAtTop && inlineNewTab ? <NewTabRow windowId={windowId} shift={motion.tail} clip={motion.tailClip} /> : null}
          </View>
          {current ? <CleanUpUpsell windowId={windowId} shift={motion.tail} /> : null}
        </Animated.View>
      </View>
    </ListMotionContext.Provider>
  );
}

const ListEntry = memo(function ListEntry({ entry, motion }: { entry: string; motion: EntryMotion | null }) {
  const { kind, id } = parseEntry(entry);
  if (kind === "group") return <GroupBlock groupId={id} section="list" motion={motion} />;
  if (kind === "split") return <SplitRowItem splitId={id} section="list" motion={motion} />;
  return <TabRowItem tabId={id} section="list" motion={motion} />;
});

const RootEntry = memo(function RootEntry({ entry, lift, motion, peek }: { entry: string; lift: number; motion: EntryMotion | null; peek: boolean }) {
  return (
    <View presentationGate style={lift ? { marginTop: lift } : null}>
      <HierarchyEntry entry={entry} section="pinned" motion={motion} peek={peek} />
    </View>
  );
});

const Tail = memo(function Tail({ section }: { section: Section }) {
  const { wrapper } = useDragItem(tailKey(section), { kind: "tail", tabIds: [], section });
  return <Animated.View ref={wrapper.ref} style={wrapper.style} />;
});

function IncognitoBadge() {
  const theme = useTheme();
  if (!useAddressBarInSidebar()) return null;
  return (
    <View style={{ height: 30, marginBottom: 4, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: radius.l, backgroundColor: sidebarTokens(theme).incognitoBadge }}>
      <Symbol name={INCOGNITO_ICON} size={13} weight="semibold" color={theme.textPrimary} style={{ width: 18, height: 16 }} />
      <Text style={{ fontSize: SIDEBAR_TYPE.compact, fontWeight: weight.semibold, color: theme.textPrimary }}>Incognito</Text>
    </View>
  );
}
