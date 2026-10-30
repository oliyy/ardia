import { cancelDownload } from "@ardia/ardiacore";
import { ContextMenuArea, copyFile, fileExists, fileOpenerName, fileThumbnail, MouseArea, openFile, revealFile, sharePageVia, showMenu, Surface, type MenuItem, type SurfaceFadeMask, type SurfaceProps } from "@ardia/shell";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { markHoverProps } from "../../lib/hoverShift";
import { hex, useTheme } from "../../lib/theme";
import { useBrowser, type BrowserState } from "../../store/browser";
import { downloadsIn, type StoredDownload } from "../../store/ui";
import { downloadStatus, FileIcon, trashDownload } from "../Downloads";
import { SIDEBAR_FOOTER_HEIGHT } from "../layout/windowLayout";
import { fileKind } from "../library/groups";
import { libraryVisible, watchLibrary } from "../library/store";
import { IconButton, useHover } from "../primitives";
import { useArcLabel } from "./tokens";

const MAX_ROWS = 4;
const ROW = 56;
const ROW_INSET = 4;
const ROW_TRAILING = 12;
const THUMB = 40;
const THUMB_RADIUS = 6;
const THUMB_REQUEST = 128;
const TEXT_GAP = 12;
const HIGHLIGHT_RADIUS = 12;
const DARK_ROW_HOVER = "rgba(255,255,255,0.09)";
const CANCEL_BOX = 24;
const FOOTER_OVERHANG = 11;
const BUTTON_ROOM = 32;
const RISE = 55;
const DWELL = 150;
const DOCK_REST = 500;
const HOVER_SETTLE = 16;
const STAGGER = 50;
const STAGGER_ROWS = 4;
const SPRING_OMEGA = (2 * Math.PI) / 0.15;
const ROW_SPRING = { stiffness: SPRING_OMEGA * SPRING_OMEGA, damping: 2 * 0.86 * SPRING_OMEGA, mass: 1 };
const SCRIM = { rampShare: 0.15, edgeShare: -0.04, collapsedShare: 0.1, collapsedFade: 0.2, duration: 240, exitDelay: 120, exitDuration: 235, end: 375 };
const SCRIM_EASE = Easing.bezier(0.25, 0.1, 0.25, 1);
const SCRIM_STEPS = 12;

type Key = [time: number, offsetShare: number, fade: number];

const scrimSteps = (from: number, duration: number, at: (eased: number) => [number, number]): Key[] =>
  Array.from({ length: SCRIM_STEPS + 1 }, (_, i) => {
    const [offset, fade] = at(SCRIM_EASE(i / SCRIM_STEPS));
    return [from + (duration * i) / SCRIM_STEPS, offset, fade];
  });

const SCRIM_IN: Key[] = scrimSteps(0, SCRIM.duration, (e) => [SCRIM.collapsedShare * (1 - e), SCRIM.collapsedFade + (1 - SCRIM.collapsedFade) * e]);
const SCRIM_OUT: Key[] = [[0, 0, 1], ...scrimSteps(SCRIM.exitDelay, SCRIM.exitDuration, (e) => [SCRIM.collapsedShare * e, 1 - (1 - SCRIM.collapsedFade) * e])];

type Peek = { shown: boolean; at: number; count: number; token: number };
type Hover = { button: boolean; dock: boolean; panel: boolean; menu: boolean; timer?: ReturnType<typeof setTimeout> };

const usePeek = create<Record<string, Peek | undefined>>()(() => ({}));
const hovers = new Map<string, Hover>();
const hoverProps = new Map<string, { button: object; dock: object }>();
let peekTokens = 0;

function hoverOf(windowId: string) {
  let h = hovers.get(windowId);
  if (!h) hovers.set(windowId, (h = { button: false, dock: false, panel: false, menu: false }));
  return h;
}

export function recentDownloads(s: Pick<BrowserState, "downloads" | "windows">, windowId: string) {
  return downloadsIn(s, windowId)
    .filter((d) => d.state === "finished" || d.state === "downloading")
    .slice(0, MAX_ROWS);
}

const setPeek = (windowId: string, peek: Peek | undefined) => usePeek.setState({ [windowId]: peek });

function show(windowId: string) {
  const count = recentDownloads(useBrowser.getState(), windowId).length;
  if (!count || libraryVisible(windowId)) return;
  setPeek(windowId, { shown: true, at: Date.now(), count, token: ++peekTokens });
}

function hide(windowId: string) {
  const peek = usePeek.getState()[windowId];
  if (!peek?.shown) return;
  const token = ++peekTokens;
  setPeek(windowId, { ...peek, shown: false, at: Date.now(), token });
  setTimeout(() => usePeek.getState()[windowId]?.token === token && setPeek(windowId, undefined), SCRIM.end);
}

function settle(windowId: string) {
  const h = hoverOf(windowId);
  clearTimeout(h.timer);
  h.timer = setTimeout(() => decide(windowId), HOVER_SETTLE);
}

function decide(windowId: string) {
  const h = hoverOf(windowId);
  const shown = !!usePeek.getState()[windowId]?.shown;
  if (h.panel || h.menu || (h.button && shown)) return;
  if (h.button) h.timer = setTimeout(() => show(windowId), DWELL - HOVER_SETTLE);
  else if (shown && h.dock) h.timer = setTimeout(() => hide(windowId), DOCK_REST - HOVER_SETTLE);
  else if (shown) hide(windowId);
}

function dismiss(windowId: string) {
  clearTimeout(hoverOf(windowId).timer);
  if (usePeek.getState()[windowId]) setPeek(windowId, undefined);
}

function regionProps(windowId: string, region: "button" | "dock" | "panel") {
  return markHoverProps({
    onMouseEnter: () => {
      hoverOf(windowId)[region] = true;
      settle(windowId);
    },
    onMouseLeave: () => {
      hoverOf(windowId)[region] = false;
      settle(windowId);
    },
  });
}

function windowHoverProps(windowId: string) {
  let props = hoverProps.get(windowId);
  if (!props) hoverProps.set(windowId, (props = { button: regionProps(windowId, "button"), dock: regionProps(windowId, "dock") }));
  return props;
}

export const recentDownloadsButtonHover = (windowId: string) => windowHoverProps(windowId).button;
export const recentDownloadsDockHover = (windowId: string) => windowHoverProps(windowId).dock;

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
  const peek = usePeek((all) => all[windowId]);
  const last = useRef<Peek | undefined>(undefined);
  const fadeMask = useMemo(() => {
    const previous = last.current;
    last.current = peek;
    return peek ? fadeMaskOf(peek, scrimKeys(peek, previous)) : null;
  }, [peek]);
  return <Surface {...props} fadeMask={fadeMask} />;
}

export function RecentDownloadsPeek({ windowId }: { windowId: string }) {
  const peek = usePeek((all) => all[windowId]);
  useEffect(() => watchLibrary(() => libraryVisible(windowId) && dismiss(windowId)), [windowId]);
  useEffect(
    () => () => {
      dismiss(windowId);
      hovers.delete(windowId);
      hoverProps.delete(windowId);
    },
    [windowId],
  );
  return peek ? <Panel windowId={windowId} peek={peek} /> : null;
}

function Panel({ windowId, peek }: { windowId: string; peek: Peek }) {
  const live = useBrowser(useShallow((s) => recentDownloads(s, windowId).map((d) => d.id)));
  const shownIds = useRef(live);
  if (peek.shown) shownIds.current = live;
  const ids = shownIds.current;
  const [panelHover] = useState(() => regionProps(windowId, "panel"));
  useEffect(() => {
    if (!peek.shown) return;
    if (!live.length) hide(windowId);
    else if (live.length !== peek.count) setPeek(windowId, { ...peek, count: live.length });
  }, [peek, live.length]);
  useEffect(
    () => () => {
      const h = hoverOf(windowId);
      h.panel = false;
      h.menu = false;
    },
    [],
  );
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
  const live = useBrowser((s) => s.downloads.find((d) => d.id === id));
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
    const h = hoverOf(windowId);
    h.menu = true;
    setMenuOpen(true);
    try {
      await recentDownloadMenu(d, windowId);
    } finally {
      h.menu = false;
      setMenuOpen(false);
      settle(windowId);
    }
  };
  return (
    <View style={{ height: ROW, paddingVertical: (ROW - THUMB) / 2 - ROW_INSET }}>
      <View {...rowHover} style={{ flex: 1 }}>
        <ContextMenuArea onContextMenu={() => void onMenu()}>
          <MouseArea path={exists ? d.path : null}>
            <Pressable disabled={!exists} onPress={() => void openFile(d.path)}>
              <View style={{ height: THUMB + ROW_INSET * 2, flexDirection: "row", alignItems: "center", paddingLeft: ROW_INSET, paddingRight: ROW_INSET * 2 }}>
                {hovered || menuOpen ? <Surface fill={hex(theme.dark ? DARK_ROW_HOVER : theme.rowHover)} cornerRadius={HIGHLIGHT_RADIUS} style={StyleSheet.absoluteFill} /> : null}
                <Thumb d={d} exists={exists} downloading={downloading} />
                <View style={{ flex: 1, marginLeft: TEXT_GAP }}>
                  <Text numberOfLines={1} style={{ fontSize: 14, color: arcLabel ?? theme.textPrimary }}>
                    {d.filename || "Preparing…"}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textSecondary }}>
                    {downloading ? downloadStatus(d) : d.seenAt ? numericAgo(d.seenAt) : ""}
                  </Text>
                </View>
                {downloading ? <IconButton icon="xmark" size={11} weight="semibold" box={CANCEL_BOX} radius={6} tooltip="Cancel Download" onPress={() => void cancelDownload(d.id)} /> : null}
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
        backgroundColor: "rgba(0,0,0,0)",
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

const fileUrl = (path: string) => `file://${path.split("/").map(encodeURIComponent).join("/")}`;

function copyTitle(d: StoredDownload) {
  if (/\.pdf$/i.test(d.filename) || d.mimeType === "application/pdf") return "Copy PDF";
  const kind = fileKind(d.filename, d.mimeType);
  return kind === "image" ? "Copy Image" : kind === "movie" ? "Copy Video" : "Copy File";
}

async function recentDownloadMenu(d: StoredDownload, windowId: string) {
  if (d.state === "downloading") {
    if ((await showMenu([{ id: "cancel", title: "Cancel Download" }])) === "cancel") void cancelDownload(d.id);
    return;
  }
  if (d.state !== "finished") return;
  const exists = fileExists(d.path);
  const opener = exists ? await fileOpenerName(d.path) : null;
  const items: MenuItem[] = [
    { id: "copy", title: copyTitle(d), enabled: exists },
    { separator: true },
    { id: "messages", title: "Send via iMessage", enabled: exists },
    { id: "airdrop", title: "AirDrop", enabled: exists },
    { separator: true },
    { id: "open", title: opener ? `Open in ${opener}` : "Open", enabled: exists },
    { id: "reveal", title: "Show in Finder", enabled: exists },
    { separator: true },
    { id: "hide", title: "Hide from Ardia" },
    { id: "trash", title: "Move to Trash", enabled: exists },
  ];
  const choice = await showMenu(items);
  if (choice === "copy") void copyFile(d.path);
  if (choice === "messages") void sharePageVia("Messages", fileUrl(d.path), d.filename, windowId);
  if (choice === "airdrop") void sharePageVia("AirDrop", fileUrl(d.path), d.filename, windowId);
  if (choice === "open") void openFile(d.path);
  if (choice === "reveal") void revealFile(d.path);
  if (choice === "hide") useBrowser.getState().removeDownload(d.id);
  if (choice === "trash") void trashDownload(d);
}
