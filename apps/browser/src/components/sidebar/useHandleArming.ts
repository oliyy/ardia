import { useEffect, useRef, useState } from "react";
import { dockMoving, useDockMotion } from "../../state/windows/dockMotion";
import { watchWindowActive } from "../../state/windows/windowWatch";

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
      state.moving = dockMoving(windowId);
      publish();
    };
    move();
    const unwatchActive = watchWindowActive(windowId, (active) => {
      state.active = active;
      publish();
    });
    const stop = useDockMotion.subscribe(move);
    return () => {
      unwatchActive();
      stop();
      state.published = false;
      sink.current(false);
    };
  }, [arming, windowId]);
  return arming.hoverProps;
}
