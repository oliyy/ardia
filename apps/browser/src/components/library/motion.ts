import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated } from "react-native";
import { libraryInvalid, libraryScope, whenLibraryInvalid } from "../../state/library/actions";
import { useLibraryView } from "../../state/library/hooks";
import { reduceMotion } from "../ui";
import { curve } from "../ui/motion";

const SLIDE_MS = 400;
const FACE_OUT_MS = 100;
const FACE_IN_MS = 285;
const FACE_IN_DELAY_MS = 38;
const MOTION_EASING = curve.outExpo;
const FACE_SCALE = 0.955;
const FACE_ANCHOR_PAST = 31;

type Phase = { present: boolean; entered: boolean; rested: boolean; faded: boolean };

export function useLibraryMotion(windowId: string, library: boolean, width: number, onFaceRest: () => void) {
  const live = useLibraryView(windowId);
  const kept = useRef(live);
  if (live) kept.current = live;
  const [slide] = useState(() => new Animated.Value(library ? 1 : 0));
  const [face] = useState(() => new Animated.Value(library ? 1 : 0));
  const [phase, setPhase] = useState<Phase>(() => ({ present: library, entered: library, rested: !library, faded: !!reduceMotion() }));
  const rest = useRef(!library);
  const generation = useRef(0);
  const shown = useRef(library);
  const activeScope = useRef(library ? libraryScope(windowId) : null);
  const unwatch = useRef<(() => void) | null>(null);
  const faceRested = useRef(onFaceRest);
  faceRested.current = onFaceRest;
  const [settle] = useState(() => () => {
    generation.current++;
    unwatch.current?.();
    unwatch.current = null;
    slide.stopAnimation();
    face.stopAnimation();
    slide.setValue(0);
    face.setValue(0);
    rest.current = true;
    setPhase((p) => ({ ...p, present: false, entered: false, rested: true }));
    faceRested.current();
  });

  useLayoutEffect(() => {
    if (shown.current === library) return;
    shown.current = library;
    const mine = ++generation.current;
    unwatch.current?.();
    unwatch.current = null;
    slide.stopAnimation();
    face.stopAnimation();
    rest.current = false;
    const scope = activeScope.current;
    if (!library && libraryInvalid(windowId, scope)) return settle();
    const current = () => generation.current === mine;
    const completed =
      (apply: () => void) =>
      ({ finished }: { finished: boolean }) => {
        if (!finished) return;
        void Promise.resolve().then(() => {
          if (current()) apply();
        });
      };
    setPhase({ present: true, entered: false, rested: false, faded: !!reduceMotion() });
    const slid = Animated.timing(slide, { toValue: library ? 1 : 0, duration: SLIDE_MS, easing: MOTION_EASING, useNativeDriver: true });
    if (library) {
      slid.start(completed(() => setPhase((p) => ({ ...p, entered: true }))));
      Animated.timing(face, { toValue: 1, duration: FACE_OUT_MS, easing: MOTION_EASING, useNativeDriver: true }).start();
      return;
    }
    let slidOut = false;
    let faceIn = false;
    const exited = () => {
      if (!slidOut || !faceIn) return;
      unwatch.current?.();
      unwatch.current = null;
    };
    unwatch.current = whenLibraryInvalid(windowId, scope, () => current() && settle());
    slid.start(
      completed(() => {
        slidOut = true;
        setPhase((p) => ({ ...p, present: false }));
        exited();
      }),
    );
    Animated.timing(face, { toValue: 0, duration: FACE_IN_MS, delay: FACE_IN_DELAY_MS, easing: MOTION_EASING, useNativeDriver: true }).start(
      completed(() => {
        faceIn = true;
        rest.current = true;
        setPhase((p) => ({ ...p, rested: true }));
        faceRested.current();
        exited();
      }),
    );
  }, [library]);

  useLayoutEffect(() => {
    if (library) activeScope.current = libraryScope(windowId);
  });

  useEffect(
    () => () => {
      generation.current++;
      unwatch.current?.();
      unwatch.current = null;
      slide.stopAnimation();
      face.stopAnimation();
    },
    [],
  );

  const faded = phase.faded;
  const faceStyle = useMemo(
    () => ({
      opacity: face.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      transform: faded
        ? []
        : [
            { translateX: face.interpolate({ inputRange: [0, 1], outputRange: [0, (1 - FACE_SCALE) * (width / 2 + FACE_ANCHOR_PAST)] }) },
            { scale: face.interpolate({ inputRange: [0, 1], outputRange: [1, FACE_SCALE] }) },
          ],
    }),
    [face, width, faded],
  );
  const slideStyle = useMemo(
    () => (faded ? { opacity: slide } : { transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }] }),
    [slide, width, faded],
  );
  const entered = library && phase.entered;
  const rested = !library && phase.rested;
  return { view: kept.current, present: library || phase.present, entered, rested, moving: !entered && !rested, rest, faceStyle, slideStyle };
}
