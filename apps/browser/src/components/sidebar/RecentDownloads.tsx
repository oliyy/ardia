import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { fileExists, fileThumbnail, openFile } from "../../state/app/system";
import { cancelDownload } from "../../state/downloads/actions";
import type { StoredDownload } from "../../state/downloads/downloadsSlice";
import { downloadStatus } from "../../state/downloads/status";
import {
  dismissRecentPeekWithLibrary,
  forgetRecentPeek,
  hideRecentPeek,
  leaveRecentPanel,
  openRecentDownloadMenu,
  recentPeekRegion,
  updateRecentPeekCount,
  useRecentDownloadIds,
  useRecentPeek,
  useStoredDownload,
  type RecentPeek as Peek,
} from "../../state/library/recentDownloads";
import { RECENT_SCRIM as SCRIM } from "../../state/library/tokens";
import { FileIcon } from "../downloads/Downloads";
import { RECENT_DOWNLOAD_ROW_HOVER_DARK } from "../library/tokens";
import { Button, ContextMenuArea, hex, ink, MouseArea, spring, Surface, useHover, useTheme, type SurfaceFadeMask, type SurfaceProps } from "../ui";
import { curve } from "../ui/motion";
import { SIDEBAR_FOOTER_HEIGHT } from "./geometry";
import { useArcLabel } from "./tokens";

export { recentDownloadsButtonHover, recentDownloadsDockHover } from "../../state/library/recentDownloads";

const ROW = 56;
const ROW_INSET = 4;
const ROW_TRAILING = 12;
const THUMB = 40;
const THUMB_RADIUS = 6;
const THUMB_REQUEST = 128;
const TEXT_GAP = 12;
const HIGHLIGHT_RADIUS = 12;
const CANCEL_BOX = 24;
const FOOTER_OVERHANG = 11;
const BUTTON_ROOM = 32;
const RISE = 55;
const STAGGER = 50;
const STAGGER_ROWS = 4;
const ROW_SPRING = spring({ response: 0.15, damping: 0.86 });
const SCRIM_EASE = curve.cssEase;
const SCRIM_STEPS = 12;

type Key = [time: number, offsetShare: number, fade: number];

const scrimSteps = (from: number, length: number, at: (eased: number) => [number, number]): Key[] =>
  Array.from({ length: SCRIM_STEPS + 1 }, (_, i) => {
    const [offset, fade] = at(SCRIM_EASE(i / SCRIM_STEPS));
    return [from + (length * i) / SCRIM_STEPS, offset, fade];
  });

const SCRIM_IN: Key[] = scrimSteps(0, SCRIM.duration, (e) => [SCRIM.collapsedShare * (1 - e), SCRIM.collapsedFade + (1 - SCRIM.collapsedFade) * e]);
const SCRIM_OUT: Key[] = [[0, 0, 1], ...scrimSteps(SCRIM.exitDelay, SCRIM.exitDuration, (e) => [SCRIM.collapsedShare * e, 1 - (1 - SCRIM.collapsedFade) * e])];

function sample(keys: Key[], t: number): Key {
  if (t <= keys[0]![0]) return keys[0]!;
  for (let i = 1; i < keys.length; i++) {
    const [t1, o1, f1] = keys[i]!;
    if (t > t1) continue;
    const [t0, o0, f0] = keys[i - 1]!;
    const k = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
    return [t, o0 + (o1 - o0) * k, f0 + (f1 - f0) * k];
  }
  return keys[keys.length - 1]!;
}

function resumeAt(keys: Key[], fade: number, rising: boolean): Key[] {
  if (rising ? fade <= keys[0]![2] : fade >= keys[0]![2]) return keys;
  const next = keys.findIndex(([, , f]) => (rising ? f > fade : f < fade));
  if (next <= 0) return next === 0 ? keys : [[0, ...keys[keys.length - 1]!.slice(1)] as Key];
  const [t0, , f0] = keys[next - 1]!;
  const [t1, , f1] = keys[next]!;
  const at = t0 + ((fade - f0) / (f1 - f0)) * (t1 - t0);
  return [sample(keys, at), ...keys.slice(next)].map(([t, o, f]): Key => [t - at, o, f]);
}

function scrimKeys(peek: Peek, previous: Peek | undefined): Key[] {
  const keys = peek.shown ? SCRIM_IN : SCRIM_OUT;
  if (previous?.token === peek.token) return [[0, ...keys[keys.length - 1]!.slice(1)] as Key];
  if (!previous || previous.shown === peek.shown) return keys;
  const fade = sample(previous.shown ? SCRIM_IN : SCRIM_OUT, peek.at - previous.at)[2];
  return resumeAt(keys, fade, peek.shown);
}

const fadeMaskOf = (peek: Peek, keys: Key[]): SurfaceFadeMask => ({
  edgeInset: SIDEBAR_FOOTER_HEIGHT + peek.count * ROW + BUTTON_ROOM,
  edgeShare: SCRIM.edgeShare,
  rampShare: SCRIM.rampShare,
  baseInset: SIDEBAR_FOOTER_HEIGHT,
  times: keys.map(([t]) => t),
  offsetShares: keys.map(([, o]) => o),
  fades: keys.map(([, , f]) => f),
  token: peek.token,
});

export function RecentDownloadsSurface({ windowId, ...props }: SurfaceProps & { windowId: string }) {
  const peek = useRecentPeek(windowId);
  const last = useRef<Peek | undefined>(undefined);
  const fadeMask = useMemo(() => {
    const previous = last.current;
    last.current = peek;
    return peek ? fadeMaskOf(peek, scrimKeys(peek, previous)) : null;
  }, [peek]);
  return <Surface {...props} fadeMask={fadeMask} />;
}

export function RecentDownloadsPeek({ windowId }: { windowId: string }) {
  const peek = useRecentPeek(windowId);
  useEffect(() => dismissRecentPeekWithLibrary(windowId), [windowId]);
  useEffect(() => () => forgetRecentPeek(windowId), [windowId]);
  return peek ? <Panel windowId={windowId} peek={peek} /> : null;
}

function Panel({ windowId, peek }: { windowId: string; peek: Peek }) {
  const live = useRecentDownloadIds(windowId);
  const shownIds = useRef(live);
  if (peek.shown) shownIds.current = live;
  const ids = shownIds.current;
  const [panelHover] = useState(() => recentPeekRegion(windowId, "panel"));
  useEffect(() => {
    if (!peek.shown) return;
    if (!live.length) hideRecentPeek(windowId);
    else if (live.length !== peek.count) updateRecentPeekCount(windowId, peek, live.length);
  }, [peek, live.length]);
  useEffect(() => () => leaveRecentPanel(windowId), []);
  return (
    <View
      {...panelHover}
      pointerEvents={peek.shown ? "auto" : "none"}
      style={{ position: "absolute", left: ROW_INSET, right: ROW_TRAILING, bottom: SIDEBAR_FOOTER_HEIGHT - FOOTER_OVERHANG, height: ids.length * ROW, overflow: "hidden" }}
    >
      {ids
        .map((id, order) => <DownloadRowItem key={id} id={id} windowId={windowId} shown={peek.shown} order={order} />)
        .reverse()}
    </View>
  );
}

const DownloadRowItem = memo(function DownloadRowItem({ id, windowId, shown, order }: { id: string; windowId: string; shown: boolean; order: number }) {
  const live = useStoredDownload(id);
  const last = useRef(live);
  if (live) last.current = live;
  const [progress] = useState(() => new Animated.Value(0));
  const [motion] = useState(() => ({
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [RISE, 0] }) }],
  }));
  useEffect(() => {
    const animation = Animated.spring(progress, {
      ...ROW_SPRING,
      toValue: shown ? 1 : 0,
      delay: STAGGER * Math.min(order / STAGGER_ROWS, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [shown, order]);
  const d = last.current;
  if (!d) return null;
  return (
    <Animated.View style={[{ height: ROW }, motion]}>
      <DownloadRow d={d} windowId={windowId} />
    </Animated.View>
  );
});

function DownloadRow({ d, windowId }: { d: StoredDownload; windowId: string }) {
  const theme = useTheme();
  const arcLabel = useArcLabel();
  const { hovered, hoverProps: rowHover } = useHover();
  const [menuOpen, setMenuOpen] = useState(false);
  const downloading = d.state === "downloading";
  const exists = !downloading && fileExists(d.path);
  const onMenu = async () => {
    setMenuOpen(true);
    try {
      await openRecentDownloadMenu(d, windowId);
    } finally {
      setMenuOpen(false);
    }
  };
  return (
    <View style={{ height: ROW, paddingVertical: (ROW - THUMB) / 2 - ROW_INSET }}>
      <View {...rowHover} style={{ flex: 1 }}>
        <ContextMenuArea onContextMenu={() => void onMenu()}>
          <MouseArea path={exists ? d.path : null}>
            <Pressable disabled={!exists} onPress={() => void openFile(d.path)}>
              <View style={{ height: THUMB + ROW_INSET * 2, flexDirection: "row", alignItems: "center", paddingLeft: ROW_INSET, paddingRight: ROW_INSET * 2 }}>
                {hovered || menuOpen ? <Surface fill={hex(theme.dark ? RECENT_DOWNLOAD_ROW_HOVER_DARK : theme.rowHover)} cornerRadius={HIGHLIGHT_RADIUS} style={StyleSheet.absoluteFill} /> : null}
                <Thumb d={d} exists={exists} downloading={downloading} />
                <View style={{ flex: 1, marginLeft: TEXT_GAP }}>
                  <Text numberOfLines={1} style={{ fontSize: 14, color: arcLabel ?? theme.textPrimary }}>
                    {d.filename || "Preparing…"}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textSecondary }}>
                    {downloading ? downloadStatus(d) : d.seenAt ? numericAgo(d.seenAt) : ""}
                  </Text>
                </View>
                {downloading ? <Button variant="icon" icon="xmark" size={11} weight="semibold" box={CANCEL_BOX} radius={6} tooltip="Cancel Download" onPress={() => void cancelDownload(d.id)} /> : null}
              </View>
            </Pressable>
          </MouseArea>
        </ContextMenuArea>
      </View>
    </View>
  );
}

const thumbnails = new Map<string, string | null>();
const THUMBNAIL_CACHE = 24;

function remember(key: string, uri: string | null) {
  thumbnails.delete(key);
  thumbnails.set(key, uri);
  while (thumbnails.size > THUMBNAIL_CACHE) thumbnails.delete(thumbnails.keys().next().value!);
}

const Thumb = memo(function Thumb({ d, exists, downloading }: { d: StoredDownload; exists: boolean; downloading: boolean }) {
  const theme = useTheme();
  const key = exists ? `${d.path}\n${d.seenAt ?? ""}` : null;
  const [made, setMade] = useState<{ key: string; uri: string | null } | null>(() => (key && thumbnails.has(key) ? { key, uri: thumbnails.get(key) ?? null } : null));
  const uri = made && made.key === key ? made.uri : null;
  useEffect(() => {
    if (!key || made?.key === key) return;
    if (thumbnails.has(key)) return setMade({ key, uri: thumbnails.get(key) ?? null });
    let current = true;
    const settled = (result: string | null) => {
      remember(key, result);
      if (current) setMade({ key, uri: result });
    };
    fileThumbnail(d.path, THUMB_REQUEST).then(settled, () => settled(null));
    return () => {
      current = false;
    };
  }, [key]);
  return (
    <View
      style={{
        width: THUMB,
        height: THUMB,
        alignItems: "center",
        justifyContent: "center",
        opacity: exists || downloading ? 1 : 0.45,
        borderRadius: THUMB_RADIUS,
        borderCurve: "continuous",
        overflow: "hidden",
        backgroundColor: ink.clear,
        ...(downloading ? { borderWidth: 1, borderStyle: "dashed" as const, borderColor: theme.textTertiary } : null),
      }}
    >
      {uri ? <Image source={{ uri }} resizeMode="cover" style={{ width: THUMB, height: THUMB }} /> : <FileIcon path={d.path || d.filename} size={downloading ? THUMB - 8 : THUMB} />}
    </View>
  );
});

const AGO_UNITS: [number, string][] = [
  [365 * 86_400, "year"],
  [30 * 86_400, "month"],
  [7 * 86_400, "week"],
  [86_400, "day"],
  [3600, "hour"],
  [60, "minute"],
  [1, "second"],
];

function numericAgo(at: number, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  for (const [size, unit] of AGO_UNITS) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  }
  return "0 seconds ago";
}
