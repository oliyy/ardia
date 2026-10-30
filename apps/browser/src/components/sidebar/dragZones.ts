import { layout } from "../ui/theme";
import type { DropSpot } from "../../state/drag/drops";
import { pinSlot } from "./pinZone";
import { type Frame, inside, isGroupItem, type Item, PIN_SLOT, type Pointed, tailKey } from "./dragModel";

export type Aim = {
  spot: DropSpot | null;
  gapKey: string | null;
  pitch?: number;
  into?: string;
  onto?: string;
  folderTarget?: string;
  pinnedZone?: boolean;
};

export type Pointing = {
  x: number;
  y: number;
  source: Item;
  live: Item[];
  cy: (i: Item) => number;
  byY: (a: Item, b: Item) => number;
  firstTab: (i: Item | undefined) => string | null;
  tabsDrag: boolean;
  external: boolean;
  inline: boolean;
  away: boolean;
  inPanel: boolean;
  held: Item | null;
  overTiles: boolean;
  tiles: Frame | null;
  spot: Pointed | null;
  cells: Item[];
  count: number;
  balanced: boolean;
  columns: number;
  grid: boolean;
  kept: { gapKey: string | null; pitch: number };
  shown: (i: Item) => Frame;
  at: (f: Frame | null) => Frame | null;
  ontoTarget: (section: "list" | "pinned") => string | null;
  overPinned: () => boolean;
  leadTab: (key: string) => string;
};

type Zone = (p: Pointing) => Aim | null;

const NO_AIM: Aim = { spot: null, gapKey: null };

const away: Zone = (p) => (p.away ? NO_AIM : null);

const folderPanel: Zone = (p) => {
  if (!p.inPanel) return null;
  const members = p.live.filter((i) => i.section === "folder" && i.kind !== "tail").sort(p.byY);
  const before = members.find((m) => p.cy(m) > p.y);
  const anchor = members.find((m) => p.firstTab(m) !== null);
  if (!anchor) return NO_AIM;
  return { spot: { zone: "folder", ontoId: p.firstTab(anchor)!, beforeId: p.firstTab(before) }, gapKey: before?.key ?? tailKey("folder") };
};

const heldFolder: Zone = (p) =>
  p.held ? { spot: { zone: "folder", ontoId: p.firstTab(p.held)! }, gapKey: p.kept.gapKey, pitch: p.kept.pitch, folderTarget: p.held.key } : null;

const tiles: Zone = (p) => {
  if (!p.overTiles || !p.tiles) return null;
  const { spot, cells } = p;
  const index = !spot ? Math.min(cells.length, pinSlot(p.tiles, cells.length + p.count, layout.pinnedHeight, p.x, p.y, p.columns, p.balanced)) : spot.part === "after" ? spot.index + 1 : spot.part === "before" ? spot.index : spot.gap;
  const before = p.grid ? cells[index] : undefined;
  return { spot: { zone: "tiles", beforeId: p.firstTab(before) }, gapKey: before?.key ?? tailKey("tiles"), pitch: PIN_SLOT };
};

function groupHit(p: Pointing): { g: Extract<Item, { kind: "group" }>; into: boolean } | undefined {
  const { x, y, source } = p;
  return p.live
    .filter((i): i is Extract<Item, { kind: "group" }> => isGroupItem(i) && i.section === "list")
    .flatMap((g) => {
      const f = p.shown(g);
      const start = p.at(g.headerFrame);
      const header = start && { ...start, y: start.y + f.y - p.at(g.frame)!.y };
      const onHeader = !!header && inside(header, x, y) && Math.abs(y - (header.y + header.h / 2)) < header.h / 3;
      if (g.collapsed || (source.kind === "group" && onHeader)) return onHeader ? [{ g, into: true, h: f.h }] : [];
      return inside(f, x, y) && (!header || y > header.y + header.h / 2) ? [{ g, into: false, h: f.h }] : [];
    })
    .sort((a, z) => a.h - z.h)[0];
}

const group: Zone = (p) => {
  if (!p.tabsDrag && p.source.kind !== "group" && p.source.kind !== "split") return null;
  const hit = groupHit(p);
  if (!hit) return null;
  const groupId = hit.g.groupId;
  if (hit.into) return { spot: { zone: "group", groupId, beforeId: null }, gapKey: null, into: groupId };
  const members = p.live.filter((i) => (i.kind === "row" || i.kind === "group" || i.kind === "split") && i.parentGroup === groupId).sort(p.byY);
  const before = members.find((m) => p.cy(m) > p.y);
  return { spot: { zone: "group", groupId, beforeId: p.firstTab(before) }, gapKey: before?.key ?? tailKey({ group: groupId }) };
};

const onto: Zone = (p) => {
  if (!p.tabsDrag || p.external || p.inline) return null;
  const target = p.ontoTarget("list");
  return target ? { spot: { zone: "onto", targetId: p.leadTab(target) }, gapKey: p.kept.gapKey, pitch: p.kept.pitch, onto: target } : null;
};

function pinnedFolderHit(p: Pointing): Extract<Item, { kind: "group" }> | undefined {
  const { x, y } = p;
  const hits = p.live.filter((g): g is Extract<Item, { kind: "group" }> => {
    if (!isGroupItem(g) || g.section !== "pinned") return false;
    const f = p.shown(g);
    const start = p.at(g.headerFrame);
    const header = start && { ...start, y: start.y + f.y - p.at(g.frame)!.y };
    if (g.collapsed) return !!header && inside(header, x, y) && Math.abs(y - (header.y + header.h / 2)) < header.h / 3;
    return inside(f, x, y) && (!header || y > header.y + header.h / 2);
  });
  return hits.reduce<Extract<Item, { kind: "group" }> | undefined>((deepest, g) => (!deepest || g.ancestors.length > deepest.ancestors.length ? g : deepest), undefined);
}

const pinned: Zone = (p) => {
  if (!p.overPinned()) return null;
  const target = p.tabsDrag && !p.external && !p.inline ? p.ontoTarget("pinned") : null;
  if (target) return { spot: { zone: "onto", targetId: p.leadTab(target) }, gapKey: p.kept.gapKey, pitch: p.kept.pitch, onto: target, pinnedZone: true };
  const box = pinnedFolderHit(p);
  if (box?.collapsed) return { spot: { zone: "pinned", parent: box.groupId, before: null }, gapKey: null, into: box.groupId, pinnedZone: true };
  const parent = box?.groupId ?? null;
  const members = p.live.filter((i) => i.section === "pinned" && i.kind !== "tail" && (i.parentGroup ?? null) === parent).sort(p.byY);
  const before = members.find((m) => p.cy(m) > p.y && (m.kind !== "split" || p.firstTab(m) !== null));
  return { spot: { zone: "pinned", parent, before: before?.key ?? null }, gapKey: before?.key ?? (parent ? tailKey({ group: parent }) : tailKey("pinned")), pinnedZone: true };
};

const pinnedOnly: Zone = (p) => (p.source.kind === "live" || (p.source.kind === "group" && p.source.section === "pinned" && !p.source.tabIds.length) ? NO_AIM : null);

const list: Zone = (p) => {
  if (p.source.kind === "live") return null;
  const items = p.live.filter((i) => i.section === "list" && !i.parentGroup && i.kind !== "tail" && i.kind !== "tile").sort(p.byY);
  const before = items.find((b) => p.cy(b) > p.y && p.firstTab(b) !== null);
  return { spot: { zone: "list", beforeId: p.firstTab(before) }, gapKey: before?.key ?? tailKey("list") };
};

const ZONES: Zone[] = [away, folderPanel, heldFolder, tiles, pinned, pinnedOnly, group, onto, list];

export function aimAt(p: Pointing): Aim {
  for (const zone of ZONES) {
    const aim = zone(p);
    if (aim) return aim;
  }
  return NO_AIM;
}
