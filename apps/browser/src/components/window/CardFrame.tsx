import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Animated, findNodeHandle, Platform, unstable_batchedUpdates, type LayoutChangeEvent, type NativeSyntheticEvent, type View } from "react-native";
import { dockMoving, useDockMotion } from "../../state/windows/dockMotion";
import { useDockReceipt } from "./SidebarDock";

type EndpointRequest = { valid: () => boolean; done: () => void };
export type ViewportLeading = { read: () => number; follow: (send: (value: number) => void) => () => void };
export type DockLink = {
  registerEndpoint: (flush: (valid: () => boolean, done: () => void) => void) => () => void;
  leading: ViewportLeading | null;
  shift: Animated.AnimatedInterpolation<number> | Animated.Value;
  interrupt: () => void;
};
type MountReceipt = { receipt: number; target: number; x: number; y: number; width: number; height: number };
type ReceiptBinding = { view: View | null; windowId: string; receipt: number | undefined; highest: number };
type Size = { width: number; height: number };
type Origin = { x: number; y: number };

const validFrame = (x: number, y: number, width: number, height: number) => [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0;

export function useCardFrame(windowId: string, resizing: boolean) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [origin, setOrigin] = useState<Origin | null>(null);
  const parked = useRef(size);
  if (!resizing) parked.current = size;
  const container = useRef<View>(null);
  const epoch = useRef(0);
  const endpoint = useRef<EndpointRequest | null>(null);
  const [published, setPublished] = useState<{ epoch: number; request: EndpointRequest } | null>(null);
  const retiring = useRef<(() => void) | null>(null);
  const handedOff = useRef(false);
  const binding = useRef<ReceiptBinding>({ view: null, windowId, receipt: undefined, highest: 0 });
  const receiptMode = useRef(false);
  const frameEpoch = useRef(0);
  const floor = useRef(0);
  const measured = useRef<{ view: View; windowId: string } | null>(null);
  const local = useRef<{ view: View; windowId: string; x: number; y: number; width: number; height: number } | null>(null);
  const settled = useRef<Size | null>(null);

  const measure = (width: number, height: number) => {
    const mine = ++epoch.current;
    const view = container.current;
    setSize({ width, height });
    const own = ++frameEpoch.current;
    view?.measureInWindow((x, y) => {
      if (epoch.current !== mine || frameEpoch.current !== own || container.current !== view) return;
      if (view && Number.isFinite(x) && Number.isFinite(y)) measured.current = { view, windowId };
      setOrigin({ x, y });
    });
  };
  const publishFrame = (x: number, y: number, width: number, height: number) =>
    unstable_batchedUpdates(() => {
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
      setOrigin((o) => (o && o.x === x && o.y === y ? o : { x, y }));
    });
  const currentFrame = () => {
    const view = container.current;
    if (!view || endpoint.current || dockMoving(windowId)) return;
    const own = ++frameEpoch.current;
    const sampled = epoch.current;
    view.measureInWindow((x, y, width, height) => {
      if (frameEpoch.current !== own || epoch.current !== sampled || container.current !== view || endpoint.current || dockMoving(windowId)) return;
      if (!validFrame(x, y, width, height)) return;
      measured.current = { view, windowId };
      publishFrame(x, y, width, height);
    });
  };
  const disarm = () => {
    receiptMode.current = false;
    frameEpoch.current++;
    currentFrame();
  };
  const received = (e: NativeSyntheticEvent<MountReceipt>) => {
    if (!receiptMode.current || endpoint.current || dockMoving(windowId)) return;
    const { receipt: token, target, x, y, width, height } = e.nativeEvent;
    const bound = binding.current;
    const view = container.current;
    if (!view || bound.view !== view || bound.windowId !== windowId || bound.receipt === undefined) return disarm();
    if (!Number.isSafeInteger(token) || token <= floor.current || token > bound.receipt) return;
    if (!validFrame(x, y, width, height)) return;
    const tag = findNodeHandle(view);
    if (tag === null || target !== tag) return;
    if (token === bound.receipt) {
      const laid = local.current;
      if (!laid || laid.view !== view || laid.windowId !== windowId || laid.width !== width || laid.height !== height) return disarm();
    }
    frameEpoch.current++;
    floor.current = token;
    publishFrame(x, y, width, height);
  };
  const sampleEndpoint = () => {
    const request = endpoint.current;
    const view = container.current;
    if (!request || !view) return false;
    if (!request.valid()) {
      endpoint.current = null;
      return false;
    }
    const mine = ++epoch.current;
    view.measureInWindow((x, y, width, height) => {
      if (epoch.current !== mine || container.current !== view || endpoint.current !== request || !request.valid()) return;
      if (!validFrame(x, y, width, height)) return;
      unstable_batchedUpdates(() => {
        setSize({ width, height });
        setOrigin({ x, y });
        setPublished({ epoch: mine, request });
      });
    });
    return true;
  };
  const onLayout = (e: LayoutChangeEvent, split: boolean) => {
    const { x, y, width, height } = e.nativeEvent.layout;
    const view = container.current;
    const prev = local.current;
    const valid = !!view && validFrame(x, y, width, height);
    local.current = valid && view ? { view, windowId, x, y, width, height } : null;
    if (receiptMode.current) {
      const pending = binding.current.receipt !== undefined && binding.current.receipt > floor.current;
      if (!valid || !prev || prev.view !== view || prev.windowId !== windowId || prev.x !== x || prev.y !== y || prev.height !== height || (prev.width !== width && !pending)) {
        receiptMode.current = false;
        frameEpoch.current++;
      }
    }
    if (sampleEndpoint()) return;
    if (size.width > 0 && dockMoving(windowId) && !split) {
      receiptMode.current = false;
      settled.current = { width, height };
    } else if (!receiptMode.current) measure(width, height);
  };

  return {
    size,
    origin,
    parked,
    container,
    retiring,
    binding,
    onLayout,
    received,
    refs: { epoch, endpoint, published, handedOff, receiptMode, frameEpoch, floor, measured, local, settled },
    measure,
    currentFrame,
    disarm,
    sampleEndpoint,
  };
}

type CardFrame = ReturnType<typeof useCardFrame>;

export function useCardEndpoint(frame: CardFrame, windowId: string, registerEndpoint: DockLink["registerEndpoint"] | undefined) {
  const { endpoint, published, epoch, handedOff, receiptMode, frameEpoch, settled } = frame.refs;
  useEffect(() => {
    if (!published) return;
    const { request } = published;
    if (endpoint.current !== request) return;
    if (!request.valid()) {
      endpoint.current = null;
      return;
    }
    if (epoch.current !== published.epoch || !frame.container.current) return;
    endpoint.current = null;
    request.done();
  }, [published]);
  useLayoutEffect(() => {
    if (!registerEndpoint) return;
    return registerEndpoint((valid, done) => {
      receiptMode.current = false;
      endpoint.current = { valid, done };
      settled.current = null;
      if (handedOff.current && valid()) frame.retiring.current?.();
      frame.sampleEndpoint();
    });
  }, [registerEndpoint]);
  useEffect(
    () =>
      useDockMotion.subscribe((m, prev) => {
        if (m.moving[windowId] && !prev.moving[windowId]) {
          receiptMode.current = false;
          frameEpoch.current++;
        }
        if (m.moving[windowId] || !settled.current) return;
        const { width, height } = settled.current;
        settled.current = null;
        frame.measure(width, height);
      }),
    [windowId],
  );
}

export type LeadingPane = { activeId: string | undefined; native: boolean; eligible: boolean; handoff: string };

export function useDockHandoff(frame: CardFrame, windowId: string, dock: DockLink | undefined, resizing: boolean, pane: LeadingPane) {
  const { handedOff, receiptMode, frameEpoch, floor, measured, local, endpoint } = frame.refs;
  const nativeLeading = !!dock?.leading && Platform.OS !== "web" && pane.native;
  const handoff = [pane.handoff, nativeLeading ? "native" : "flow"].join("\n");
  const dockMoves = useDockMotion((m) => !!m.moving[windowId]);
  const resting = { pane: nativeLeading ? pane.activeId : null, leading: dock?.leading ?? null, key: handoff };
  const latched = useRef(resting);
  const interrupted = useRef<string | null>(null);
  const wasResizing = useRef(resizing);
  const owner = dockMoves ? latched.current : resting;
  const flowing = !owner.leading || !owner.pane;
  handedOff.current = dockMoves && handoff !== latched.current.key;
  useLayoutEffect(() => {
    if (!dockMoves) {
      latched.current = resting;
      interrupted.current = null;
    } else if (handoff !== latched.current.key && interrupted.current !== handoff) {
      interrupted.current = handoff;
      dock?.interrupt();
    }
  });
  useLayoutEffect(() => {
    frameEpoch.current++;
    const began = resizing && !wasResizing.current;
    const ended = !resizing && wasResizing.current;
    wasResizing.current = resizing;
    const bound = frame.binding.current;
    const view = frame.container.current;
    const known = measured.current;
    const laid = local.current;
    receiptMode.current =
      began &&
      pane.eligible &&
      !!view &&
      bound.view === view &&
      bound.windowId === windowId &&
      bound.receipt !== undefined &&
      !!known &&
      known.view === view &&
      known.windowId === windowId &&
      !!laid &&
      laid.view === view &&
      laid.windowId === windowId &&
      !endpoint.current &&
      !dockMoving(windowId);
    if (began && bound.receipt !== undefined) floor.current = Math.max(floor.current, bound.receipt - 1);
    if (ended) floor.current = Math.max(floor.current, bound.highest);
    if (!ended) return;
    const frameRequest = requestAnimationFrame(frame.currentFrame);
    return () => cancelAnimationFrame(frameRequest);
  }, [resizing, windowId]);
  useLayoutEffect(() => {
    if (receiptMode.current) frame.disarm();
  }, [pane.eligible, handoff, flowing]);
  return { owner, flowing };
}

export function ReceiptBridge({ target, binding, windowId }: { target: RefObject<View | null>; binding: RefObject<ReceiptBinding>; windowId: string }) {
  const receipt = useDockReceipt();
  useLayoutEffect(() => {
    const view = target.current;
    const bound = binding.current;
    bound.view = view;
    bound.windowId = windowId;
    bound.receipt = receipt;
    if (receipt !== undefined && receipt > bound.highest) bound.highest = receipt;
    view?.setNativeProps({ mountReceipt: receipt ?? null });
  }, [receipt, windowId, target, binding]);
  return null;
}
