import { Surface } from "@ardia/shell";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing } from "react-native";

import { FOLD_MS } from "./geometry";
export const FOLD_EASING = Easing.bezier(0.2, 0.9, 0.3, 1);
export const FOLD_TIMING = { ms: FOLD_MS, easing: FOLD_EASING };

export type FoldSlide = { shift: Animated.Value; delta: number; expand: boolean; kept: string | null };

const immediateClip = { overflow: "hidden", backgroundColor: "transparent" } as const;
const FOLD_SLACK_MS = 50;

const foldsUntil = new Map<string, number>();
export const foldsSettled = (windowId: string) => Date.now() >= (foldsUntil.get(windowId) ?? 0);
export const holdFolds = (windowId: string) => void foldsUntil.set(windowId, Date.now() + FOLD_MS + FOLD_SLACK_MS);

const FoldHidden = createContext(false);
export const useFoldHidden = () => useContext(FoldHidden);

type FoldState = { open: Animated.Value; moving: boolean; settled: boolean };

const FoldedAway = createContext(false);

export const useFoldedAway = () => useContext(FoldedAway);

export function useFold(collapsed: boolean): FoldState {
  const open = useRef(new Animated.Value(collapsed ? 0 : 1)).current;
  const [settled, setSettled] = useState(collapsed);
  const [running, setRunning] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setRunning(true);
    const settleBy = Date.now() + FOLD_MS + FOLD_SLACK_MS;
    let live = true;
    let detached: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      setSettled(collapsed);
      setRunning(false);
    };
    const animation = Animated.timing(open, { toValue: collapsed ? 0 : 1, duration: FOLD_MS, easing: FOLD_EASING, useNativeDriver: false });
    animation.start(({ finished }) => {
      if (finished) return settle();
      if (!live) return;
      open.setValue(collapsed ? 0 : 1);
      detached = setTimeout(settle, Math.max(0, settleBy - Date.now()));
    });
    return () => {
      live = false;
      clearTimeout(detached);
      animation.stop();
    };
  }, [collapsed]);
  return { open, moving: running || settled !== collapsed, settled };
}

export type FoldEntry = { key: string; node: ReactNode; ghost?: boolean };

export function Fold({
  fold,
  collapsed,
  entries,
  keep,
  gap,
  rowHeight,
  padTop = 0,
  padBottom = 0,
  indent = 0,
  mountClosed = false,
  footer,
  slide = null,
}: {
  fold: FoldState;
  collapsed: boolean;
  entries: FoldEntry[];
  keep?: string | null;
  gap: number;
  rowHeight?: number | ((key: string) => number);
  padTop?: number;
  padBottom?: number;
  indent?: number;
  mountClosed?: boolean;
  footer?: ReactNode;
  slide?: FoldSlide | null;
}) {
  const { open, moving, settled: restCollapsed } = fold;
  const outerHidden = useFoldHidden();
  const parentAway = useFoldedAway();
  const measuring = rowHeight === undefined;
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const styles = useRef(new Map<number, object>()).current;
  const kept = keep && entries.some((e) => e.key === keep) ? keep : null;
  const sliding = !!slide && slide.expand === !collapsed && slide.kept === kept && moving && !measuring;
  const folding = !!kept && (collapsed || moving) && !sliding;
  const state = useRef({ moving, folding, kept });
  state.current = { moving, folding, kept };
  const heightOf = (key: string) => (typeof rowHeight === "function" ? rowHeight(key) : (rowHeight ?? measured[key] ?? 0));
  const rows = entries.filter((e) => !e.ghost);
  const total = rows.reduce((sum, e) => sum + heightOf(e.key), 0) + gap * Math.max(0, rows.length - 1) + padTop + padBottom;
  const above = rows.slice(0, Math.max(0, rows.findIndex((e) => e.key === kept))).reduce((sum, e) => sum + heightOf(e.key) + gap, 0);
  const foldingStyle = (height: number) => {
    let style = styles.get(height);
    if (!style) {
      style = {
        height: open.interpolate({ inputRange: [0, 1], outputRange: [0, height] }),
        marginBottom: open.interpolate({ inputRange: [0, 1], outputRange: [-gap, 0] }),
        opacity: open,
        overflow: "hidden",
      };
      styles.set(height, style);
    }
    return style;
  };
  const closed = { height: 0, marginBottom: -gap, opacity: 0, overflow: "hidden" as const };
  const slideStyles = useMemo(() => {
    if (!slide) return null;
    const { delta } = slide;
    const reveal = slide.expand ? Animated.add(slide.shift, delta) : slide.shift;
    const opacity = reveal.interpolate({ inputRange: [0, delta], outputRange: [0, 1], extrapolate: "clamp" });
    if (!slide.kept) {
      return {
        outer: null,
        clip: { position: "absolute" as const, left: 0, right: 0, top: 0, height: delta, ...immediateClip, transform: [{ translateY: Animated.subtract(reveal, delta) }] },
        entry: { opacity, transform: [{ translateY: Animated.subtract(delta, reveal) }] },
        kept: null,
      };
    }
    const rise = { transform: [{ translateY: reveal.interpolate({ inputRange: [0, delta], outputRange: [delta - above, 0] }) }] };
    return {
      outer: { height: total + gap, marginBottom: (slide.expand ? 0 : -delta) - gap, marginRight: -gap, paddingRight: gap, ...immediateClip },
      clip: { paddingBottom: padBottom + gap, marginBottom: -gap, marginRight: -gap, paddingRight: gap, ...immediateClip, transform: [{ translateY: Animated.subtract(reveal, delta) }] },
      entry: { opacity, ...rise },
      kept: rise,
    };
  }, [slide, above, total, gap, padBottom]);
  const outer = folding
    ? null
    : sliding
      ? (slideStyles?.outer ?? { height: collapsed ? 0 : total })
      : moving
        ? { height: open.interpolate({ inputRange: [0, 1], outputRange: [0, total] }), opacity: open, overflow: "hidden" as const }
        : collapsed
          ? { height: 0, opacity: 0, overflow: "hidden" as const }
          : null;
  const mountAll = !collapsed || moving || mountClosed || measuring;
  const footerHidden = outerHidden || restCollapsed;

  return (
    <Animated.View style={outer} pointerEvents={collapsed ? "box-none" : "auto"}>
      <Animated.View style={[{ gap, paddingTop: padTop, paddingBottom: padBottom, paddingLeft: indent }, measuring && outer && !moving ? { position: "absolute", left: 0, right: 0, top: 0 } : null, sliding ? slideStyles?.clip : null]}>
        {entries.map(({ key, node }) => {
          const stays = key === kept;
          if (!stays && !mountAll) return null;
          const hidden = outerHidden || (restCollapsed && !stays);
          return (
            <Animated.View
              key={key}
              style={folding && !stays ? (moving ? foldingStyle(heightOf(key)) : closed) : sliding ? (stays ? slideStyles?.kept : slideStyles?.entry) : null}
              pointerEvents={collapsed && !stays ? "none" : "auto"}
            >
              <FoldedAway.Provider value={parentAway || (!stays && (restCollapsed || (moving && !collapsed)))}>
                <FoldHidden.Provider value={hidden}>
                  {measuring || mountClosed ? (
                    <Surface
                      hidesAccessibility={hidden}
                      onLayout={
                        measuring
                          ? (e) => {
                              if (state.current.moving || (state.current.folding && key !== state.current.kept)) return;
                              const height = e.nativeEvent.layout.height;
                              setMeasured((all) => (all[key] === height ? all : { ...all, [key]: height }));
                            }
                          : undefined
                      }
                    >
                      {node}
                    </Surface>
                  ) : (
                    node
                  )}
                </FoldHidden.Provider>
              </FoldedAway.Provider>
            </Animated.View>
          );
        })}
        {footer ? <FoldHidden.Provider value={footerHidden}>{footer}</FoldHidden.Provider> : null}
      </Animated.View>
    </Animated.View>
  );
}
