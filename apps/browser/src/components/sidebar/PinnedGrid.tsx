import { memo, useMemo } from "react";
import { Animated, View } from "react-native";
import { Symbol } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { listTopGap } from "./geometry";
import { useIsActiveTab, useSettings, useTab, useTabLive, useWindowId } from "../../state/browser/hooks";
import { useIsSelected } from "../../state/pins/hooks";
import { useMuteState } from "../../state/tabs/hooks";
import { useSidebarWidthOf } from "../../state/sidebar/hooks";
import { NextMeetingBadge } from "../live/NextMeetingBadge";
import { returnShownTabToPinnedUrl } from "../../state/sidebar/actions";
import { tabTitle } from "../../state/browser/model";
import { cellKey, PIN_SLOT, tailKey } from "./dragModel";
import { useDragController, useDragging, useDragItem, useDropPins, useFolderTarget, usePinnedCount, usePinSlots } from "./DragProvider";
import { FolderTile } from "./FolderTile";
import { useRowHover } from "./hoverController";
import { pinColumnCap, pinGrid, pinGridHeight } from "./pinZone";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { tabHasCard } from "./tabCard";
import { FolderDropRing, TileFace, useSlotPosition } from "./TileFace";
import { folderIdOfCell } from "../../state/pins/tileFolders";
import { tileWidthNode, useTileInner, type TileWidth } from "./tileWidth";
import { useSidebarTokens } from "./tokens";
import { TabPressArea } from "./TabPressArea";
import { entryKey } from "../../state/sidebar/entryKey";

export const PinnedGrid = memo(function PinnedGrid({ tabs, flush = false }: { tabs: string[]; flush?: boolean }) {
  const windowId = useWindowId();
  const controller = useDragController();
  const count = usePinnedCount(tabs);
  const balanced = useSettings((st) => st.balancedTopApps);
  const addressBar = useAddressBarInSidebar();
  const maxColumns = pinColumnCap(addressBar);
  const columns = useSidebarWidthOf(windowId, (width) => pinGrid(count, width - layout.sidebarInset * 2, maxColumns, balanced).columns);
  const height = useSidebarWidthOf(windowId, (width) => pinGridHeight(count, width - layout.sidebarInset * 2, layout.pinnedHeight, maxColumns, balanced));
  const inner = useTileInner();
  const exact = maxColumns === pinColumnCap(true);
  const grid = useMemo(() => tileWidthNode(inner, columns, exact), [inner, columns, exact]);
  const slots = usePinSlots(tabs);
  const tail = useDragItem(tailKey("tiles"), { kind: "tail", tabIds: [], section: "tiles" });
  const dragging = useDragging();
  const topGap = listTopGap(addressBar);
  if (!tabs.length) return dragging && !addressBar && tail.gap ? <Animated.View style={{ height: tail.gap }} /> : null;
  return (
    <View
      ref={(v) => {
        controller?.regions.set("tiles", v);
      }}
      style={{ marginTop: flush ? 0 : topGap }}
    >
      <View style={{ height }}>
        {tabs.map((cell, i) => {
          const column = slots[i]! % columns;
          const row = Math.floor(slots[i]! / columns);
          const folderId = folderIdOfCell(cell);
          return folderId ? (
            <FolderTile key={cellKey(cell)} folderId={folderId} grid={grid} sliding={dragging} column={column} row={row} />
          ) : (
            <PinnedTile key={cellKey(cell)} tabId={cell} grid={grid} sliding={dragging} column={column} row={row} />
          );
        })}
      </View>
      <Animated.View ref={tail.wrapper.ref} style={{ position: "absolute", right: 0, bottom: 0, width: 0, height: 0 }} />
    </View>
  );
});

export function PinFieldZone({ top, height }: { top: number; height: number }) {
  const tokens = useSidebarTokens();
  const theme = useTheme();
  const controller = useDragController();
  const active = useDropPins();
  return (
    <View
      ref={(v) => {
        controller?.regions.set("tiles", v);
      }}
      onLayout={() => void controller?.tilesLaidOut()}
      pointerEvents="none"
      style={{
        position: "absolute",
        left: layout.sidebarInset,
        right: layout.sidebarInset,
        top,
        height,
        borderRadius: 10,
        borderWidth: active ? 1.5 : 1,
        borderStyle: "dashed",
        borderColor: active ? theme.accent : tokens.dragBorder,
        backgroundColor: tokens.dragSilhouette,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <PinGlyph color={active ? theme.accent : theme.textSecondary} />
    </View>
  );
}

export function PinSlotZone() {
  const theme = useTheme();
  const controller = useDragController();
  const active = useDropPins();
  const gap = controller?.items.get(tailKey("tiles"))?.gap;
  const opacity = gap ? gap.interpolate({ inputRange: [0, PIN_SLOT], outputRange: [0, 1], extrapolate: "clamp" }) : active ? 1 : 0;
  return (
    <>
      <View
        ref={(v) => {
          controller?.regions.set("tiles", v);
        }}
        onLayout={() => void controller?.tilesLaidOut()}
        pointerEvents="none"
        style={{
          position: "absolute",
          left: layout.sidebarInset,
          right: layout.sidebarInset,
          top: 0,
          height: active ? layout.pinnedTop + layout.pinnedHeight : layout.pinnedTop - layout.rowGap,
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: layout.sidebarInset,
          right: layout.sidebarInset,
          top: layout.pinnedTop,
          height: layout.pinnedHeight,
          opacity,
          borderRadius: 10,
          borderWidth: 1.5,
          borderStyle: "dashed",
          borderColor: theme.accent,
          backgroundColor: theme.dropZoneFill,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <PinGlyph color={theme.accent} />
      </Animated.View>
    </>
  );
}

function PinGlyph({ color }: { color: string }) {
  return <Symbol name="pin" size={13} color={color} style={{ width: 16, height: 16 }} />;
}

const PinnedTile = memo(function PinnedTile({ tabId, grid, sliding, column, row }: { tabId: string; grid: TileWidth; sliding: boolean; column: number; row: number }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const tab = useTab(tabId);
  const active = useIsActiveTab(tabId);
  const selected = useIsSelected(windowId, tabId);
  const playing = useTabLive(tabId, (l) => l.playingAudio);
  const mute = useMuteState(tabId);
  const { hovered, hoverProps } = useRowHover(windowId, { kind: "tab", id: tabId }, tabHasCard);
  const { wrapper, handle, dragging } = useDragItem(entryKey("tab", tabId), { kind: "tile", tabIds: [tabId], section: "tiles" });
  const target = useFolderTarget(entryKey("tab", tabId));
  const position = useSlotPosition(column, row, grid, sliding, dragging);
  if (!tab) return null;

  return (
    <Animated.View ref={wrapper.ref} style={[{ position: "absolute", ...position.getLayout() }, wrapper.style]} {...handle}>
      <FolderDropRing on={target} />
      <View
        ref={(v) => registerRow(windowId, tabId, v)}
        {...hoverProps}
        onDoubleClick={() => returnShownTabToPinnedUrl(windowId, tabId)}
      >
        <TabPressArea windowId={windowId} tab={tab} tooltip={tabTitle(tab)}>
          {({ pressed }) => <TileFace tabId={tabId} width={grid} active={active} selected={selected} hovered={hovered} pressed={pressed} />}
        </TabPressArea>
        <NextMeetingBadge tabId={tabId} />
        {playing || mute ? (
          <View pointerEvents="none" style={{ position: "absolute", bottom: 3, right: 4 }}>
            <Symbol name={mute ? "speaker.slash.fill" : "speaker.wave.2.fill"} size={8} color={theme.textSecondary} style={{ width: 12, height: 10 }} />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
});
