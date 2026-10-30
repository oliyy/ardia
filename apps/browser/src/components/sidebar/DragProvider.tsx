import { devRegister } from "../dev/devRegister";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Animated, PanResponder, type View } from "react-native";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { radius } from "../ui";
import { useClipped, type ClipSource } from "./EntryMotion";
import { NO_MARKS, noDragMarks, type DragMarks } from "../../state/sidebar/dragMarks";
import { useWindowId } from "../../state/browser/hooks";
import { cellKey, RESTING_TAIL, ROW_GAP, type Ghost, type ItemSpec } from "./dragModel";
import { DragController } from "./dragController";
import { onAppEvent } from "../../state/drag/dragNative";
import { WindowDropGlow } from "../tabstrip/WindowDropGlow";
import { useFoldHidden } from "./Fold";

const DROP_GLOW_PLACE = { left: 5, right: 5, top: 44, bottom: 6, borderRadius: radius.card } as const;

const DragContext = createContext<DragController | null>(null);
const ActiveDragContext = createContext<DragController | null>(null);
const DragPageContext = createContext({ page: "", generation: 0 });

type FolderScopeValue = { groupId: string | null; ancestors: string[] };
const FolderScopeContext = createContext<FolderScopeValue>({ groupId: null, ancestors: [] });

export function FolderScope({ groupId, children }: { groupId: string; children: ReactNode }) {
  const parent = useContext(FolderScopeContext);
  const value = useMemo(() => ({ groupId, ancestors: [groupId, ...parent.ancestors] }), [groupId, parent.ancestors]);
  return <FolderScopeContext.Provider value={value}>{children}</FolderScopeContext.Provider>;
}

export function DragProvider({ children }: { children: (ghost: Ghost | null, controller: DragController) => ReactNode }) {
  const controller = useMemo(() => new DragController(), []);
  controller.windowId = useWindowId();
  const [ghost, setGhost] = useState<Ghost | null>(null);
  controller.setGhost = setGhost;
  useEffect(() => () => controller.abandon(), [controller]);
  useEffect(() => devRegister("sidebarDrag", null, controller), [controller]);
  useEffect(() => {
    const sub = onAppEvent((e) => e.type === "dragEscape" && controller.active && controller.end(false));
    return () => sub.remove();
  }, [controller]);
  return (
    <DragContext.Provider value={controller}>
      <ActiveDragContext.Provider value={controller}>
        {children(ghost, controller)}
        <WindowDropGlow place={DROP_GLOW_PLACE} />
      </ActiveDragContext.Provider>
    </DragContext.Provider>
  );
}

export function DragScope({ page, enabled, children }: { page: string; enabled: boolean; children: ReactNode }) {
  const controller = useContext(DragContext);
  const [generation, setGeneration] = useState(0);
  useLayoutEffect(() => {
    if (enabled && controller?.activate(page)) setGeneration((g) => g + 1);
  }, [controller, enabled, page]);
  const scope = useMemo(() => ({ page, generation }), [page, generation]);
  return (
    <DragPageContext.Provider value={scope}>
      <ActiveDragContext.Provider value={enabled ? controller : null}>{children}</ActiveDragContext.Provider>
    </DragPageContext.Provider>
  );
}

function useMarks<T>(pick: (m: DragMarks) => T): T {
  const controller = useContext(DragContext);
  const { page } = useContext(DragPageContext);
  return useStore(controller?.marks ?? noDragMarks, (m) => pick(!controller || controller.live(page) ? m : NO_MARKS));
}

export const useDragController = () => useContext(ActiveDragContext) ?? undefined;
export const useDropInto = () => useMarks((m) => m.dropInto);
export const useDropOnto = (key: string) => useMarks((m) => m.onto === key);
export const useDropPins = () => useMarks((m) => m.pins);
export const usePinSlots = (cells: string[]) =>
  useMarks(
    useShallow((m) => {
      let slot = 0;
      return cells.map((cell) => {
        const key = cellKey(cell);
        if (m.pinBefore === key) slot += m.pinCount;
        return m.sources.has(key) ? slot : slot++;
      });
    }),
  );
export const usePinnedCount = (cells: string[]) => useMarks((m) => cells.reduce((n, cell) => n + (m.sources.has(cellKey(cell)) ? 0 : 1), 0) + m.pinCount);
export const useFolderTarget = (key: string) => useMarks((m) => m.folderTarget === key);
export const useFolderAway = () => useMarks((m) => m.folderAway);
export const useDragFolded = (key: string) => useMarks((m) => m.folded === key);
export const useDragging = () => useMarks((m) => m.sources.size > 0);
export const useDropLine = () => useMarks((m) => m.line);

export function useDragItem(key: string, spec: ItemSpec, clip: ClipSource | null = null) {
  const controller = useContext(DragContext) ?? undefined;
  const { page, generation } = useContext(DragPageContext);
  const scope = useContext(FolderScopeContext);
  const hidden = useFoldHidden();
  const item = useMemo(() => controller?.create(key), [controller, key, generation]);
  if (item) Object.assign(item, spec, { parentGroup: spec.parentGroup ?? scope.groupId ?? undefined, ancestors: scope.ancestors, hidden });
  useEffect(() => {
    if (!controller || !item) return;
    return controller.register(page, key, item);
  }, [controller, item, key, page]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => spec.kind !== "tail" && Math.hypot(g.dx, g.dy) > 4,
        onPanResponderGrant: (_, g) => void (controller?.live(page) && controller.begin(key, g.x0, g.y0)),
        onPanResponderMove: (_, g) => void (controller?.live(page) && controller.move(g.moveX, g.moveY)),
        onPanResponderRelease: () => void (controller?.live(page) && controller.end(true)),
        onPanResponderTerminate: () => void (controller?.live(page) && controller.end(false)),
        onPanResponderTerminationRequest: () => false,
      }),
    [controller, key, page],
  );
  const ref = useCallback(
    (view: View | null) => {
      if (item) item.view = view;
    },
    [item],
  );
  const headerRef = useCallback(
    (view: View | null) => {
      if (item) item.header = view;
    },
    [item],
  );

  const source = useMarks((m) => m.sources.has(key));
  const lifted = useMarks((m) => m.lifted === key);
  const landing = useMarks((m) => m.landing === key);
  const clipped = useClipped(clip);
  const horizontal = spec.kind === "tile";
  const tailOffset = useMemo(() => item && Animated.add(item.gap, -ROW_GAP), [item]);
  const style = item
    ? {
        ...(horizontal ? null : { marginTop: spec.kind === "tail" ? tailOffset! : item.gap }),
        ...(source && !lifted
          ? horizontal
            ? { opacity: 0 }
            : { height: item.size, marginBottom: -ROW_GAP, opacity: 0, overflow: "hidden" as const }
          : landing
            ? { opacity: 0 }
            : {}),
        ...(clipped && !source && !landing ? { marginTop: -ROW_GAP, paddingTop: ROW_GAP, overflow: "hidden" as const } : {}),
      }
    : spec.kind === "tail"
      ? RESTING_TAIL
      : {};
  return { wrapper: { ref, style }, handle: responder.panHandlers, headerRef, dragging: source, gap: item?.gap };
}
