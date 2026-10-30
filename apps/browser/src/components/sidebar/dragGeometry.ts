import type { ScrollView, View } from "react-native";
import { layout } from "../ui/theme";
import { currentSettings } from "../../state/browser/current";
import { createDragMarks, dragMarksOf, markDrag, marksResting } from "../../state/sidebar/dragMarks";
import type { InlineDrag } from "../../state/drag/inlineDrag";
import { overPins, pinGrid, pinSlot, TILE_GAP } from "./pinZone";
import { SCROLL_EDGE } from "./ScrollEdge";
import { apart, type Drop, type Frame, type Ghost, type Item, PIN_SLOT, type Pointed, ROW_GAP, tailKey } from "./dragModel";
import { NO_DROP } from "../../state/drag/drops";

export type DragSession = {
  sources: Item[];
  pointer: { x: number; y: number };
  startScrollY: number;
  measured: boolean;
  regionFrames: Map<string, Frame | null>;
  viewport: Frame | null;
  grab: { x: number; y: number };
  ghost: Ghost | null;
  gapKey: string | null;
  pitch: number;
  into: string | null;
  pinnedZone: boolean;
  dropKey: string;
  drop: Drop;
  gridBase: Frame | null;
  gridGrowth: number;
  external: number;
  escapable: boolean;
  inline: InlineDrag | null;
  unwatch: (() => void) | null;
  scrollTimer: ReturnType<typeof setInterval> | undefined;
  hold: { key: string | null; ready: string | null; timer: ReturnType<typeof setTimeout> | undefined };
};

export const newDragSession = (sources: Item[], pointer: { x: number; y: number }, scrollY: number): DragSession => ({
  sources,
  pointer,
  startScrollY: scrollY,
  measured: false,
  regionFrames: new Map(),
  viewport: null,
  grab: { x: 0, y: 0 },
  ghost: null,
  gapKey: null,
  pitch: 0,
  into: null,
  pinnedZone: false,
  dropKey: "",
  drop: NO_DROP,
  gridBase: null,
  gridGrowth: 0,
  external: 0,
  escapable: false,
  inline: null,
  unwatch: null,
  scrollTimer: undefined,
  hold: { key: null, ready: null, timer: undefined },
});

export class DragGeometry {
  items = new Map<string, Item>();
  regions = new Map<string, View | null>();
  root: View | null = null;
  scroll: ScrollView | null = null;
  scrollY = 0;
  tilesFixed = true;
  tilesRoom = Infinity;
  tilesColumns = Infinity;
  tilesGap = SCROLL_EDGE.gap + SCROLL_EDGE.line;
  windowId = "";
  setGhost: (ghost: Ghost | null) => void = () => {};
  marks = createDragMarks();
  setSources = (sources: Set<string>) => markDrag(this.marks, { sources });
  setLanding = (landing: string | null) => markDrag(this.marks, { landing });

  protected session: DragSession | null = null;
  protected rootFrame: Frame = { x: 0, y: 0, w: 0, h: 0 };
  protected token: object | null = null;
  private pages = new Map<string, Map<string, Item>>();
  private page = "";
  landed: { key: string; x: number; y: number } | null = null;

  protected get drag(): DragSession {
    return this.session!;
  }

  register(page: string, key: string, item: Item) {
    let items = this.pages.get(page);
    if (!items) this.pages.set(page, (items = new Map()));
    items.set(key, item);
    if (this.live(page)) this.items.set(key, item);
    return () => {
      if (items.get(key) === item) items.delete(key);
      if (!items.size && this.pages.get(page) === items) this.pages.delete(page);
      if (this.items.get(key) === item) this.items.delete(key);
    };
  }

  activate(page: string) {
    if (page === this.page) return false;
    const dragging = !!this.session?.sources.length;
    if (dragging)
      for (const i of this.pages.get(this.page)?.values() ?? []) {
        i.gap.stopAnimation();
        i.gap.setValue(0);
      }
    this.page = page;
    this.items = new Map([...(this.pages.get("") ?? []), ...(dragging ? [] : (this.pages.get(page) ?? []))]);
    if (!marksResting(dragMarksOf(this.marks))) markDrag(this.marks, {});
    return dragging;
  }

  live(page: string) {
    return !page || page === this.page;
  }

  protected still(i: Item): boolean {
    return (this.tilesFixed && i.section === "tiles") || i.section === "folder";
  }

  protected at(f: Frame | null, fixed = false): Frame | null {
    if (!f) return null;
    if (fixed) return f;
    const { gridBase, startScrollY, gridGrowth } = this.drag;
    const below = !!gridBase && (this.tilesFixed || f.y >= gridBase.y + gridBase.h);
    return { ...f, y: f.y - (this.scrollY - startScrollY) + (below ? gridGrowth : 0) };
  }

  protected pinFloor(live: Item[], tiles: Frame): number {
    const list = this.at(this.drag.regionFrames.get("list") ?? null);
    const pinnedArea = this.at(this.drag.regionFrames.get("pinned") ?? null);
    const rows = live.filter((i) => i.kind !== "tail" && i.section === "pinned").map((i) => this.at(i.frame)!.y);
    const top = Math.min(list?.y ?? tiles.y + tiles.h + TILE_GAP, pinnedArea?.y ?? Infinity, ...rows);
    return this.tilesFixed ? Math.max(top, tiles.y + tiles.h + this.drag.gridGrowth + this.tilesGap) : top;
  }

  protected overPinned(y: number): boolean {
    const list = this.at(this.drag.regionFrames.get("list") ?? null);
    return !!list && overPins(y, list.y, this.drag.pinnedZone);
  }

  protected inGrid(i: Item) {
    return i.section === "tiles" && !!this.drag.gridBase;
  }

  protected flat(i: Item) {
    return !!this.drag.inline && (i.section === "list" || i.section === "pinned");
  }

  protected get pinning() {
    const { drop } = this.drag;
    return drop.type === "tabs" && drop.placement.pinned && !drop.placement.row;
  }

  protected shown(i: Item): Frame {
    const f = this.at(i.frame, this.still(i))!;
    const { dropKey, gapKey, pitch, sources, inline } = this.drag;
    if (inline || !dropKey) return f;
    const [top, bottom] = [i.frame!.y, i.frame!.y + i.frame!.h];
    let dy = 0;
    let dh = 0;
    const gap = gapKey ? this.items.get(gapKey) : undefined;
    if (gap?.frame && gap.section !== "tiles" && !apart(gap, i)) {
      if (gap.frame.y <= top) dy += pitch;
      else if (gap.frame.y < bottom) dh += pitch;
    }
    for (const s of sources) {
      if (s.kind === "tile" || !s.frame || s === i || apart(s, i)) continue;
      const closed = s.frame.h + (s.parentGroup ? 0 : ROW_GAP);
      if (s.frame.y < top) dy -= closed;
      else if (s.frame.y < bottom) dh -= closed;
    }
    return { ...f, y: f.y + dy, h: f.h + dh };
  }

  protected ontoTarget(live: Item[], y: number, section: "list" | "pinned"): string | null {
    for (const i of live) {
      if (i.kind !== "row" || i.parentGroup || i.section !== section) continue;
      const f = this.shown(i);
      if (y > f.y + f.h * 0.25 && y < f.y + f.h * 0.75) return i.key;
    }
    return null;
  }

  protected pointed(tiles: Frame, cells: Item[], count: number, home: number | null, x: number, y: number, folders: boolean): Pointed | null {
    const marks = dragMarksOf(this.marks);
    if (!this.drag.gridBase) return null;
    if (!marks.pins && home === null) count = 0;
    const total = cells.length + count;
    if (!total) return null;
    const balanced = currentSettings().balancedTopApps;
    const slot = pinSlot(tiles, total, layout.pinnedHeight, x, y, this.tilesColumns, balanced);
    const found = !marks.pins ? (home ?? cells.length) : marks.pinBefore === tailKey("tiles") ? cells.length : cells.findIndex((c) => c.key === marks.pinBefore);
    const gap = found < 0 ? cells.length : found;
    const index = slot < gap ? slot : slot >= gap + count ? slot - count : -1;
    const cell = index >= 0 ? cells[index] : undefined;
    if (!cell) return { cell: null, index: gap, gap, part: "gap" };
    const { columns, width } = pinGrid(total, tiles.w, this.tilesColumns, balanced);
    const mid = tiles.x + (slot % columns) * (width + TILE_GAP) + width / 2;
    const top = tiles.y + Math.floor(slot / columns) * PIN_SLOT;
    const reach = this.drag.hold.ready === cell.key ? 0.45 : 0.3;
    const centre = folders && Math.abs(x - mid) < width * reach && Math.abs(y - (top + layout.pinnedHeight / 2)) <= (layout.pinnedHeight + TILE_GAP) / 2;
    return { cell, index, gap, part: centre ? "centre" : x < mid ? "before" : "after" };
  }
}
