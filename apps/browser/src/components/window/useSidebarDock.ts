import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, type View } from "react-native";
import { switchOn } from "../../state/app/switches";
import { useWindowId } from "../../state/browser/hooks";
import { dockMoving, peekShown, setDockMoving } from "../../state/windows/dockMotion";
import { curve, reduceMotion, spring } from "../ui";
import { ARC_HIDE_MS, DOCK_SPRING, dockMove } from "./dockMotion";

const SPRING = spring(DOCK_SPRING);
const IGNORE = () => {};

type EndpointFlush = (valid: () => boolean, done: () => void) => void;
type RegisterEndpoint = (flush: EndpointFlush) => () => void;
type CardLeading = { read: () => number; follow: (send: (value: number) => void) => () => void };
export type DockLink = { registerEndpoint: RegisterEndpoint; leading: CardLeading | null; shift: Animated.AnimatedInterpolation<number> | Animated.Value; interrupt: () => void };
export type CardShift = { placed: boolean; attach: (view: View | null) => void; link: DockLink };

export const UNDOCKED: DockLink = { registerEndpoint: () => IGNORE, leading: null, shift: new Animated.Value(0), interrupt: IGNORE };

export function useSidebarDock(open: boolean, animate: boolean, arc: boolean, placed: boolean, edge: number, span: number, tabDragging: boolean) {
  const windowId = useWindowId();
  const dock = useRef(new Animated.Value(open ? 1 : 0)).current;
  const base = useRef(new Animated.Value(open && placed ? -1 : 0)).current;
  const reach = useRef(new Animated.Value(placed ? span : 0)).current;
  const [wide, setWide] = useState(!(open && placed));
  const [away, setAway] = useState(!open);
  const was = useRef(open);
  const generation = useRef(0);
  const laidWide = useRef(wide);
  const writes = useRef(0);
  const landed = useRef(0);
  const clip = useRef<View | null>(null);
  const consumer = useRef<EndpointFlush | null>(null);
  const waiting = useRef<(() => void) | null>(null);
  const geometry = useRef({ placed, edge, span });
  geometry.current = { placed, edge, span };
  const [steps] = useState(() => {
    const acknowledge = (write: number) =>
      requestAnimationFrame(() => {
        const done = () => {
          landed.current = Math.max(landed.current, write);
          waiting.current?.();
        };
        clip.current?.measure(done);
      });
    const land = (target: boolean, moved = false) => {
      const narrow = target && geometry.current.placed;
      const flips = geometry.current.placed && geometry.current.span !== 0 && laidWide.current === narrow;
      laidWide.current = !narrow;
      setWide(!narrow);
      base.setValue(narrow ? -1 : 0);
      if (flips || moved) acknowledge(++writes.current);
      return flips;
    };
    const release = (token: number) => {
      const attempt = () => {
        if (generation.current !== token || landed.current < writes.current) return;
        if (!dockMoving(windowId)) {
          waiting.current = null;
          return;
        }
        if (!geometry.current.placed) {
          waiting.current = null;
          setDockMoving(windowId, false);
          return;
        }
        const flush = consumer.current;
        if (!flush) return;
        waiting.current = null;
        flush(
          () => generation.current === token,
          () => {
            if (generation.current === token) setDockMoving(windowId, false);
          },
        );
      };
      waiting.current = attempt;
      attempt();
    };
    const settle = (moved: boolean) => {
      const token = ++generation.current;
      dock.stopAnimation();
      dock.setValue(was.current ? 1 : 0);
      setAway(!was.current);
      land(was.current, moved);
      release(token);
    };
    const attach = (view: View | null) => {
      clip.current = view;
    };
    const registerEndpoint = (flush: EndpointFlush) => {
      consumer.current = flush;
      waiting.current?.();
      return () => {
        if (consumer.current === flush) consumer.current = null;
      };
    };
    const read = () => geometry.current.edge + geometry.current.span * (dock as unknown as { __getValue(): number }).__getValue();
    const leading: CardLeading = {
      read,
      follow: (send) => {
        const id = dock.addListener(() => send(read()));
        return () => dock.removeListener(id);
      },
    };
    const interrupt = () => {
      if (dockMoving(windowId)) settle(true);
    };
    return { land, release, settle, attach, registerEndpoint, leading, interrupt };
  });
  useLayoutEffect(() => {
    if (was.current === open) return;
    was.current = open;
    const token = ++generation.current;
    dock.stopAnimation();
    const move = dockMove({ open, animated: animate && !reduceMotion() && switchOn("sidebarSlide"), arc, peekOut: peekShown(windowId) });
    if (move === "jump") {
      dock.setValue(open ? 1 : 0);
      setAway(!open);
      if (steps.land(open)) setDockMoving(windowId, true);
      steps.release(token);
      return;
    }
    if (open) setAway(false);
    setDockMoving(windowId, true);
    if (!open) steps.land(false);
    (move === "arcHide"
      ? Animated.timing(dock, { toValue: 0, duration: ARC_HIDE_MS, easing: curve.outCubic, useNativeDriver: false })
      : Animated.spring(dock, {
          toValue: open ? 1 : 0,
          ...SPRING,
          restDisplacementThreshold: 0.001,
          restSpeedThreshold: 0.01,
          useNativeDriver: false,
        })
    ).start(({ finished }) => {
      if (!finished) return;
      void Promise.resolve().then(() => {
        if (generation.current !== token) return;
        if (!open) setAway(true);
        steps.land(open);
        steps.release(token);
      });
    });
  }, [open]);
  useLayoutEffect(() => {
    reach.setValue(placed ? span : 0);
    if (dockMoving(windowId)) steps.settle(true);
    else steps.land(was.current);
  }, [placed, span]);
  useLayoutEffect(() => {
    if (tabDragging && dockMoving(windowId)) steps.settle(false);
  }, [tabDragging]);
  useEffect(
    () => () => {
      generation.current++;
      setDockMoving(windowId, false);
    },
    [],
  );
  const shift = useMemo(() => Animated.multiply(Animated.add(dock, base), reach), [dock, base, reach]);
  const card = useMemo<CardShift>(
    () => ({
      placed,
      attach: steps.attach,
      link: { registerEndpoint: steps.registerEndpoint, leading: placed ? steps.leading : null, shift, interrupt: steps.interrupt },
    }),
    [shift, placed, steps],
  );
  return { dock, wide, away, card };
}
