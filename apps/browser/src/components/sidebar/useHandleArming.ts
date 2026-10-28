import { onAppEvent, onWindowEvent } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { useDockMotion } from "../layout/dockMotion";

export function useHandleArming(windowId: string, onArming: (arming: boolean) => void) {
  const sink = useRef(onArming);
  sink.current = onArming;
  const [arming] = useState(() => {
    const state = { hovered: false, active: true, moving: false, published: false };
    const publish = () => {
      const next = state.hovered && state.active && !state.moving;
      if (next === state.published) return;
      state.published = next;
      sink.current(next);
    };
    const hoverProps = {
      onMouseEnter: () => {
        state.hovered = true;
        publish();
      },
      onMouseLeave: () => {
        state.hovered = false;
        publish();
      },
    };
    return { state, publish, hoverProps };
  });
  useEffect(() => {
    const { state, publish } = arming;
    const move = () => {
      state.moving = !!useDockMotion.getState().moving[windowId];
      publish();
    };
    move();
    const subscriptions = [
      onWindowEvent((e) => {
        if (e.type !== "focus") return;
        state.active = e.id === windowId;
        publish();
      }),
      onAppEvent((e) => {
        if (e.type !== "resignActive" && e.type !== "screenLocked") return;
        state.active = false;
        publish();
      }),
    ];
    const stop = useDockMotion.subscribe(move);
    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      stop();
      state.published = false;
      sink.current(false);
    };
  }, [arming, windowId]);
  return arming.hoverProps;
}
