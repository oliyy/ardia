import { layout } from "../ui/theme";
import { currentSettings } from "../../state/browser/current";
import type { DragSource } from "../../state/drag/drops";
import { descendantGroupIds, resolveDropNow } from "../../state/sidebar/current";
import { tabDragOutside } from "../../state/drag/tabDrag";
import { dragMarksOf, markDrag, type DropLine } from "../../state/sidebar/dragMarks";
import { folderPanel } from "../../state/sidebar/tileFolderUi";
import { overPins, pinGridHeight } from "./pinZone";
import { boxed, type Drop, FOLDER_HOLD_MS, folderOf, inside, type Item, ROW_GAP, spring } from "./dragModel";
import { aimAt, type Pointing } from "./dragZones";
import { DragGeometry } from "./dragGeometry";
import { hapticTick } from "../../state/drag/dragNative";

export class DragTargeting extends DragGeometry {
  protected clearHold() {
    const hold = this.session?.hold;
    if (!hold) return;
    clearTimeout(hold.timer);
    hold.timer = undefined;
    hold.key = null;
    hold.ready = null;
  }

  protected holdOver(target: Item) {
    const session = this.drag;
    const { hold } = session;
    if (hold.key === target.key) return;
    this.clearHold();
    hold.key = target.key;
    if (folderOf(target)) return void (hold.ready = target.key);
    hold.timer = setTimeout(() => {
      if (this.session !== session || hold.key !== target.key || !session.sources.length) return;
      hold.ready = target.key;
      this.retarget();
    }, FOLDER_HOLD_MS);
  }

  protected retarget() {
    const session = this.drag;
    const { x, y } = session.pointer;
    const { sources, external, regionFrames, inline } = session;
    const source = sources[0]!;
    const sourceKeys = new Set(sources.map((s) => s.key));
    const subtree = source.kind === "group" ? new Set([source.groupId, ...descendantGroupIds(source.groupId)]) : null;
    const live = [...this.items.values()].filter(
      (i) =>
        !sourceKeys.has(i.key) &&
        i.frame &&
        !i.hidden &&
        !(subtree && (i.ancestors.some((id) => subtree.has(id)) || (i.parentGroup && subtree.has(i.parentGroup)) || (i.kind === "group" && subtree.has(i.groupId)))),
    );
    const cy = (i: Item) => {
      const f = this.shown(i);
      return f.y + Math.min(f.h, i.headerFrame?.h ?? f.h) / 2;
    };
    const byY = (a: Item, b: Item) => this.at(a.frame, this.still(a))!.y - this.at(b.frame, this.still(b))!.y || a.frame!.x - b.frame!.x;
    const dragged = new Set(sources.flatMap((s) => s.tabIds));
    const firstTab = (i: Item | undefined) => i?.tabIds.find((id) => !dragged.has(id)) ?? null;
    const tabsDrag = source.kind === "row" || source.kind === "tile";
    const count = external || (folderOf(source) ? 1 : dragged.size);
    const rowPitch = (boxed(source) ? source.foldedHeight() : layout.rowHeight * (source.kind === "split" ? 1 : Math.max(1, session.ghost?.count ?? external ?? 1))) + ROW_GAP;
    const dragSource: DragSource = {
      kind: source.kind === "group" || source.kind === "split" || source.kind === "live" ? source.kind : "tab",
      groupId: source.kind === "group" ? source.groupId : undefined,
      folderId: folderOf(source),
      external: !!external,
    };

    const sidebar = session.viewport ?? this.rootFrame;
    const tiles = this.at(regionFrames.get("tiles") ?? null, this.tilesFixed);
    const balanced = currentSettings().balancedTopApps;
    const away = x > sidebar.x + sidebar.w + 40 || x < sidebar.x - 40 || tabDragOutside();
    const cells = live.filter((i) => i.kind === "tile").sort(byY);
    const { gridBase } = session;
    const overTiles = !away && tabsDrag && !!tiles && (gridBase ? overPins(y, this.pinFloor(live, tiles), this.pinning) : inside(tiles, x, y, 6));
    if (gridBase)
      session.gridGrowth = Math.min(pinGridHeight(cells.length + (overTiles ? count : 0), gridBase.w, layout.pinnedHeight, this.tilesColumns, balanced), this.tilesFixed ? this.tilesRoom : Infinity) - gridBase.h;
    const panel = folderPanel();
    const panelFrame = panel ? (regionFrames.get("folder") ?? null) : null;
    const wasAway = dragMarksOf(this.marks).folderAway;
    const inPanel = !away && !wasAway && tabsDrag && !external && !!panelFrame && inside(panelFrame, x, y);
    const folderAway = source.section === "folder" && !inPanel;
    const canFolder = tabsDrag && !external && !folderOf(source);
    const home = source.section === "tiles" && source.frame ? cells.filter((c) => byY(c, source) < 0).length : null;
    const spot = !away && tabsDrag && overTiles && tiles ? this.pointed(tiles, cells, count, home, x, y, canFolder) : null;
    const target = spot?.part === "centre" ? spot.cell : null;
    if (target) this.holdOver(target);
    else this.clearHold();

    const pointing: Pointing = {
      x,
      y,
      source,
      live,
      cy,
      byY,
      firstTab,
      tabsDrag,
      external: !!external,
      inline: !!inline,
      away,
      inPanel,
      held: target && session.hold.ready === target.key ? target : null,
      overTiles,
      tiles,
      spot,
      cells,
      count,
      balanced,
      columns: this.tilesColumns,
      grid: !!gridBase,
      kept: { gapKey: session.gapKey, pitch: session.pitch },
      shown: (i) => this.shown(i),
      at: (f) => this.at(f),
      ontoTarget: (section) => this.ontoTarget(live, y, section),
      overPinned: () => this.overPinned(y),
      leadTab: (key) => this.items.get(key)!.tabIds[0]!,
    };
    const aim = aimAt(pointing);
    const resolved = resolveDropNow(dragSource, aim.spot);
    const pinnedSpot = aim.spot?.zone === "pinned" ? { parent: aim.spot.parent, before: aim.spot.before } : undefined;
    const drop: Drop = resolved.type !== "none" && pinnedSpot ? { ...resolved, spot: pinnedSpot } : resolved;
    const dropped = drop.type !== "none";
    const gapKey = dropped ? aim.gapKey : null;
    const pitch = aim.pitch ?? rowPitch;
    const into = dropped ? (aim.into ?? null) : null;
    const onto = drop.type === "onto" ? (aim.onto ?? null) : null;
    const folderTarget = aim.folderTarget ?? null;

    if (folderAway !== dragMarksOf(this.marks).folderAway) markDrag(this.marks, { folderAway });
    if (inline) {
      const line = this.lineAt(drop, gapKey, into);
      const was = dragMarksOf(this.marks).line;
      if (line?.x !== was?.x || line?.y !== was?.y || line?.w !== was?.w) markDrag(this.marks, { line });
    }
    const key = JSON.stringify(drop);
    if (key === session.dropKey && gapKey === session.gapKey) return;
    if (session.dropKey && drop.type !== "none" && currentSettings().tabReorderHaptics) hapticTick();
    session.dropKey = key;
    session.drop = drop;
    session.into = into;
    session.pinnedZone = !!aim.pinnedZone;
    const pins = drop.type === "tabs" && drop.placement.pinned && !drop.placement.row;
    const held = drop.type === "folder" && !inPanel;
    markDrag(this.marks, { dropInto: into, onto, folderTarget, pins: pins || held, pinCount: pins || held ? count : 0, pinBefore: pins || held ? gapKey : null });
    if (gapKey !== session.gapKey) {
      const prev = session.gapKey && this.items.get(session.gapKey);
      if (prev && !this.inGrid(prev) && !this.flat(prev)) spring(prev.gap, 0).start();
      const next = gapKey && this.items.get(gapKey);
      if (next && !this.inGrid(next) && !this.flat(next)) spring(next.gap, pitch).start();
      session.gapKey = gapKey;
      session.pitch = pitch;
    }
  }

  private unmoved(target: Item): boolean {
    const source = this.drag.sources[0];
    if (!source?.frame) return true;
    const sibling = (i: Item) => i.section === source.section && (i.parentGroup ?? null) === (source.parentGroup ?? null);
    if (!sibling(target)) return false;
    const next = [...this.items.values()]
      .filter((i) => i !== source && i.frame && !i.hidden && sibling(i) && i.frame.y > source.frame!.y)
      .sort((a, b) => a.frame!.y - b.frame!.y)[0];
    return next === target;
  }

  private lineAt(drop: Drop, gapKey: string | null, into: string | null): DropLine | null {
    const target = gapKey ? this.items.get(gapKey) : undefined;
    if (!target?.frame || !this.flat(target) || into || (drop.type !== "tabs" && drop.type !== "group")) return null;
    if ((drop.type === "tabs" && drop.placement.pinned && !drop.placement.row) || this.unmoved(target)) return null;
    const f = this.at(target.frame)!;
    const y = target.kind === "tail" ? f.y + ROW_GAP / 2 : f.y - ROW_GAP / 2;
    const view = this.drag.viewport;
    if (view && (y < view.y || y > view.y + view.h)) return null;
    return { x: f.x - this.rootFrame.x, y: y - this.rootFrame.y, w: f.w };
  }
}
