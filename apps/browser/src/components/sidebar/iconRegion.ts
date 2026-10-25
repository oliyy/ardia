import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from "react";
import type { GestureResponderEvent, NativeTouchEvent, View } from "react-native";
import { markHoverProps } from "../../lib/hoverShift";
import { layout } from "../../lib/theme";
import { pointed, rowsCovered } from "./hover";

export const ICON_WIDTH = 16;
export const ICON_REGION_WIDTH = 2 * layout.rowPadding + ICON_WIDTH;

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
type Gesture = { touch: NativeTouchEvent["identifier"]; origin: Point; last: Point; optimistic: boolean; owner: "icon" | "body" | null; rect: Rect | null; measure: number };

const NONE = { hovered: false, pressed: false };

const pointOf = (t: NativeTouchEvent): Point | null => (Number.isFinite(t.pageX) && Number.isFinite(t.pageY) ? { x: t.pageX, y: t.pageY } : null);
const leftButton = (t: NativeTouchEvent) => (t as NativeTouchEvent & { button?: number }).button === 0;
const touchOf = (e: GestureResponderEvent, id: NativeTouchEvent["identifier"]) =>
  e.nativeEvent.changedTouches?.find((t) => t.identifier === id) ?? (e.nativeEvent.identifier === id ? e.nativeEvent : undefined);
const within = (r: Rect, p: Point) => p.x >= r.x && p.x < r.x + Math.min(ICON_REGION_WIDTH, r.width) && p.y >= r.y && p.y < r.y + r.height;

function held(g: Gesture) {
  const inRegion = g.rect ? within(g.rect, g.last) : g.optimistic;
  return { hovered: inRegion, pressed: g.owner === "icon" ? inRegion : g.owner === null && g.optimistic };
}

export function useIconRegion(windowId: string, enabled: boolean, rowHovered: boolean, row: RefObject<View | null>) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const gesture = useRef<Gesture | null>(null);
  const released = useRef<boolean | null>(null);
  const overlay = useRef(false);
  const watch = useCallback((on: boolean) => pointed(windowId, rerender, on), [windowId]);
  const clearReleased = useCallback(() => {
    if (released.current === null) return false;
    released.current = null;
    if (!gesture.current) watch(false);
    return true;
  }, [watch]);
  const [overlayProps] = useState(() =>
    markHoverProps({
      onMouseEnter: () => {
        overlay.current = true;
        clearReleased();
        rerender();
      },
      onMouseLeave: () => {
        overlay.current = false;
        clearReleased();
        rerender();
      },
    }),
  );
  const rowLeft = useCallback(() => {
    if (clearReleased()) rerender();
  }, [clearReleased]);
  const finish = useCallback(
    (keepContainment: boolean) => {
      const g = gesture.current;
      if (!g) return;
      gesture.current = null;
      released.current = keepContainment && g.rect ? within(g.rect, g.last) : null;
      if (released.current === null) watch(false);
      rerender();
    },
    [watch],
  );
  const measure = useCallback(
    (g: Gesture) => {
      const request = ++g.measure;
      row.current?.measure((_x, _y, width, height, pageX, pageY) => {
        if (gesture.current !== g || g.measure !== request) return;
        if (![width, height, pageX, pageY].every(Number.isFinite) || width <= 0 || height <= 0) return;
        g.rect = { x: pageX, y: pageY, width, height };
        if (g.owner === null) g.owner = within(g.rect, g.origin) ? "icon" : "body";
        rerender();
      });
    },
    [row],
  );
  const live = enabled && !rowsCovered(windowId);
  useEffect(() => {
    if (live) return;
    finish(false);
    clearReleased();
    watch(false);
  }, [live, finish, clearReleased, watch]);
  useEffect(
    () => () => {
      gesture.current = null;
      released.current = null;
      watch(false);
    },
    [watch],
  );
  const idle = released.current ?? (overlay.current && rowHovered);
  const touchProps = {
    onTouchStart: (e: GestureResponderEvent) => {
      const t = e.nativeEvent;
      const p = live && leftButton(t) ? pointOf(t) : null;
      if (!p) return;
      const optimistic = idle;
      finish(false);
      clearReleased();
      const g: Gesture = { touch: t.identifier, origin: p, last: p, optimistic, owner: null, rect: null, measure: 0 };
      gesture.current = g;
      watch(true);
      measure(g);
      rerender();
    },
    onTouchMove: (e: GestureResponderEvent) => {
      const g = gesture.current;
      const t = g ? touchOf(e, g.touch) : undefined;
      const p = t ? pointOf(t) : null;
      if (!g || !p) return;
      const before = held(g);
      g.last = p;
      const after = held(g);
      if (before.hovered !== after.hovered || before.pressed !== after.pressed) rerender();
    },
    onTouchEnd: (e: GestureResponderEvent) => {
      const g = gesture.current;
      const t = g ? touchOf(e, g.touch) : undefined;
      if (!g || !t) return;
      const p = pointOf(t);
      if (p) g.last = p;
      finish(true);
    },
    onTouchCancel: (e: GestureResponderEvent) => {
      const g = gesture.current;
      if (g && touchOf(e, g.touch)) finish(false);
    },
  };
  const onLayout = () => {
    const g = gesture.current;
    if (g) measure(g);
  };
  const out = !live ? NONE : gesture.current ? held(gesture.current) : { hovered: idle, pressed: false };
  return { overlayProps, rowLeft, touchProps, onLayout, regionHovered: out.hovered, regionPressed: out.pressed };
}
