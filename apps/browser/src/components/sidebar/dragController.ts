import { Animated, type View } from "react-native";
import { NO_DROP } from "../../state/drag/drops";
import { dropTabs } from "../../state/pins/actions";
import { movingTabsFrom } from "../../state/sidebar/current";
import type { TabPlacement } from "../../state/pins/placing";
import { SLIDE } from "../tabstrip/stripReorder";
import { beginTabDrag, cancelTabDrag, endTabDrag, setDragPicture, updateTabDrag } from "../../state/drag/tabDrag";
import { suppressHover } from "../../state/sidebar/hover";
import { closeFolderPanel } from "../../state/sidebar/tileFolderUi";
import { dragMarksOf, markDrag } from "../../state/sidebar/dragMarks";
import { dropPinnedNow, pinnedPlacementNow } from "../../state/drag/pinnedDrop";
import { inlineDragNow, inlineHoldsNow, watchBrowser, type InlineDrag } from "../../state/drag/inlineDrag";
import { boxed, type Drop, EDGE, type Ghost, isGroupItem, type Item, measure, ROW_GAP, spring, tabCell } from "./dragModel";
import { DragTargeting } from "./dragTargeting";
import { type DragSession, newDragSession } from "./dragGeometry";
import { setDragEscapeCapture } from "../../state/drag/dragNative";
import { entryKey } from "../../state/sidebar/entryKey";
import { withReorderIntent } from "../../state/sidebar/listCapture";
import { SLIDE_EASING, SLIDE_MS } from "./tokens";

export class DragController extends DragTargeting {
  private settle: (() => void) | null = null;

  create(key: string): Item {
    return { key, kind: "row", tabIds: [], section: "list", ancestors: [], hidden: false, view: null, header: null, gap: new Animated.Value(0), size: new Animated.Value(0), frame: null, headerFrame: null };
  }

  get active() {
    return !!this.session?.sources.length;
  }

  async begin(key: string, x: number, y: number) {
    const item = this.items.get(key);
    if (!item || item.kind === "tail") return;
    const lead = tabCell(item) ? item.tabIds[0] : undefined;
    const moving = lead ? movingTabsFrom(lead) : [];
    const sources = moving.length > 1 ? [...this.items.values()].filter((i) => tabCell(i) && i.tabIds.some((id) => moving.includes(id))) : [item];
    this.stopTimers();
    this.settle?.();
    const session = (this.session = newDragSession(sources, { x, y }, this.scrollY));
    this.token = {};
    const flatRow = sources.length === 1 && item.kind === "row" && item.tabIds.length === 1 && (item.section === "list" || item.section === "pinned");
    const inline = (session.inline = flatRow ? inlineDragNow(this.windowId, key, item.tabIds[0]!) : null);
    if (inline)
      session.unwatch = watchBrowser(() => {
        if (this.session === session && session.sources.length && !inlineHoldsNow(inline, this.windowId)) this.end(false);
      });
    suppressHover(true);
    session.escapable = true;
    setDragEscapeCapture(true);
    let seq = 0;
    if (tabCell(item)) {
      const single = sources.length === 1 ? (item.tabIds[0] ?? null) : null;
      seq = beginTabDrag(single, [...new Set(sources.flatMap((i) => i.tabIds))]);
    }
    await this.measureAll(session);
    if (this.session !== session) return;
    if (inline && !inlineHoldsNow(inline, this.windowId)) return this.end(false);
    const frame = item.frame ?? { x, y, w: 176, h: 33 };
    const grab = (session.grab = { x: x - frame.x, y: y - frame.y });
    const count = new Set(sources.flatMap((s) => s.tabIds)).size;
    const height = boxed(item) ? Math.min(frame.h, item.headerFrame?.h ?? 33) : frame.h;
    if (seq) setDragPicture(seq, () => [session.pointer.x - grab.x, session.pointer.y - grab.y, frame.w, height], [x, y]);
    session.ghost = {
      item,
      count,
      width: frame.w,
      height,
      position: new Animated.ValueXY({ x: frame.x - this.rootFrame.x, y: frame.y - this.rootFrame.y }),
      ...(inline ? { face: inline.face } : {}),
    };
    const closing = inline ? [] : sources.filter((s) => s.kind !== "tile");
    for (const s of closing) s.size.setValue(s.frame?.h ?? 0);
    this.setLanding(null);
    markDrag(this.marks, { sources: new Set(sources.map((s) => s.key)), lifted: inline ? key : null });
    this.setGhost(session.ghost);
    if (boxed(item) && !item.collapsed) markDrag(this.marks, { folded: item.key });
    Animated.parallel(closing.map((s) => spring(s.size, 0))).start();
    session.measured = true;
    this.move(session.pointer.x, session.pointer.y);
  }

  private holding(inline: InlineDrag): boolean {
    const source = this.session?.sources[0];
    return inlineHoldsNow(inline, this.windowId) && this.items.get(inline.key) === source && source?.tabIds.length === 1 && source.tabIds[0] === inline.tabId;
  }

  scrolled(y: number) {
    this.scrollY = y;
    if (this.session?.inline && this.session.measured && this.session.sources.length) this.retarget();
  }

  abandon() {
    if (this.active) this.end(false);
    this.settle?.();
    this.token = null;
  }

  async beginExternal(count: number, x: number, y: number) {
    if (this.active && !this.session!.external) return;
    this.reset();
    this.setGhost(null);
    const session = (this.session = newDragSession([this.create("external")], { x, y }, this.scrollY));
    session.external = Math.max(1, count);
    this.token = {};
    suppressHover(true);
    await this.measureAll(session);
    if (this.session !== session) return;
    this.setLanding(null);
    session.measured = true;
    this.move(session.pointer.x, session.pointer.y);
  }

  finishExternal(commit: boolean): TabPlacement | null {
    const session = this.session;
    if (!session?.external) return null;
    const drop: Drop = session.measured ? session.drop : NO_DROP;
    this.reset();
    this.token = null;
    this.setLanding(null);
    if (!commit || drop.type !== "tabs") return null;
    return drop.spot ? pinnedPlacementNow(this.windowId, drop.spot) : drop.placement;
  }

  async tilesLaidOut() {
    const session = this.session;
    const frame = await measure(this.regions.get("tiles") ?? null);
    if (!session || this.session !== session) return;
    session.regionFrames.set("tiles", frame);
    this.retarget();
  }

  protected async measureAll(session: DragSession) {
    const [rootFrame, viewport] = await Promise.all([measure(this.root), measure(this.scroll as unknown as View)]);
    this.rootFrame = rootFrame ?? this.rootFrame;
    session.viewport = viewport;
    session.startScrollY = this.scrollY;
    await Promise.all(
      [...this.items.values()].map(async (i) => {
        [i.frame, i.headerFrame] = i.hidden ? [null, null] : await Promise.all([measure(i.view), measure(i.header)]);
      }),
    );
    for (const [name, view] of this.regions) session.regionFrames.set(name, await measure(view));
    const grid = [...this.items.values()].some((i) => i.kind === "tile");
    session.gridBase = grid ? (session.regionFrames.get("tiles") ?? null) : null;
    session.gridGrowth = 0;
  }

  move(x: number, y: number) {
    const session = this.session;
    if (session) session.pointer = { x, y };
    updateTabDrag(x, y);
    if (!session?.measured || (!session.ghost && !session.external)) return;
    if (session.ghost) session.ghost.position.setValue({ x: this.ghostX(x), y: y - session.grab.y - this.rootFrame.y });
    this.autoScroll(y);
    this.retarget();
  }

  end(commit: boolean) {
    const session = this.session;
    if (session?.external) return void this.finishExternal(false);
    if (!session?.sources.length) return;
    const { inline } = session;
    session.unwatch?.();
    session.unwatch = null;
    const live = commit && (!inline || this.holding(inline));
    if (live && inline && session.measured) this.retarget();
    const { sources, drop, ghost, measured, into } = session;
    const splitDrop = live ? endTabDrag() : (cancelTabDrag(), false);
    const folded = dragMarksOf(this.marks).folded;
    const leftPanel = sources[0]?.section === "folder" && dragMarksOf(this.marks).folderAway;
    const unfold = () => {
      if (folded && dragMarksOf(this.marks).folded === folded) markDrag(this.marks, { folded: null });
    };
    const spot =
      !inline && !splitDrop && measured && ghost && sources.length === 1 && sources[0]!.kind !== "tile" && sources[0]!.section !== "folder" && !into && drop.type !== "onto" && drop.type !== "folder"
        ? this.landingSpot(live ? drop : NO_DROP)
        : null;
    const lands = !!inline && live && !splitDrop && measured && !!ghost && (drop.type === "tabs" || drop.type === "group") && !into && !(drop.type === "tabs" && drop.placement.pinned && !drop.placement.row);
    if (live && !splitDrop && measured && sources.length) {
      if (inline) withReorderIntent({ windowId: inline.windowId, profileId: inline.profileId, key: inline.key }, () => this.apply(drop, sources));
      else this.apply(drop, sources);
    }
    this.reset();
    if (leftPanel) closeFolderPanel();
    if (lands && inline && ghost) return this.landInline(ghost, inline);
    if (!spot || !ghost) {
      this.token = null;
      this.setLanding(null);
      this.setGhost(null);
      unfold();
      return;
    }
    const token = (this.token = {});
    this.setLanding(ghost.item.key);
    this.setGhost({ ...ghost, landing: true });
    const done = () => {
      unfold();
      if (this.token !== token) return;
      this.token = null;
      this.setLanding(null);
      this.setGhost(null);
    };
    void spot.then((at) => {
      if (this.token !== token) return unfold();
      if (__DEV__) this.landed = at && { key: ghost.item.key, x: at.x, y: at.y };
      if (!at) return done();
      Animated.spring(ghost.position, { toValue: { x: at.x - this.rootFrame.x, y: at.y - this.rootFrame.y }, ...SLIDE }).start(done);
    });
  }

  private apply(drop: Drop, sources: Item[]) {
    if (drop.spot) return dropPinnedNow(this.windowId, drop, drop.spot, sources);
    dropTabs(sources.flatMap((i) => i.tabIds), drop);
  }

  private landInline(ghost: Ghost, inline: InlineDrag) {
    const token = (this.token = {});
    const { key } = inline;
    this.setLanding(key);
    this.setGhost({ ...ghost, landing: true });
    let stop = () => {};
    const done = () => {
      stop();
      if (this.settle === done) this.settle = null;
      if (this.token !== token) return;
      this.token = null;
      this.setLanding(null);
      this.setGhost(null);
    };
    this.settle = done;
    stop = watchBrowser(() => {
      if (!inlineHoldsNow(inline, this.windowId)) done();
    });
    requestAnimationFrame(() => {
      if (this.token !== token || !inlineHoldsNow(inline, this.windowId)) return done();
      void measure(this.items.get(key)?.view ?? null).then((at) => {
        if (this.token !== token || !inlineHoldsNow(inline, this.windowId)) return done();
        if (__DEV__) this.landed = at && { key, x: at.x, y: at.y };
        if (!at) return done();
        Animated.timing(ghost.position, { toValue: { x: at.x - this.rootFrame.x, y: at.y - this.rootFrame.y }, duration: SLIDE_MS, easing: SLIDE_EASING, useNativeDriver: false }).start(done);
      });
    });
  }

  protected stopTimers() {
    clearInterval(this.session?.scrollTimer);
    this.clearHold();
  }

  protected reset() {
    const session = this.session;
    session?.unwatch?.();
    this.stopTimers();
    for (const i of this.items.values()) {
      i.gap.stopAnimation();
      i.gap.setValue(0);
    }
    for (const i of session?.sources ?? []) i.size.stopAnimation();
    this.session = null;
    if (session?.escapable) setDragEscapeCapture(false);
    suppressHover(false);
    this.setSources(new Set());
    markDrag(this.marks, { dropInto: null, onto: null, pins: false, pinCount: 0, pinBefore: null, folderTarget: null, folderAway: false, lifted: null, line: null });
  }

  protected landingSpot(drop: Drop): Promise<{ x: number; y: number } | null> | null {
    const { sources, gapKey } = this.drag;
    const source = sources[0]!;
    if (drop.type === "tabs" && drop.placement.pinned && !drop.placement.row) return null;
    const target = drop.type !== "none" && gapKey ? this.items.get(gapKey) : undefined;
    const ref = target ?? source;
    const top = ref.frame?.y;
    if (top === undefined) return null;
    const now = (v: Animated.Value) => {
      let value = 0;
      v.stopAnimation((x) => (value = x));
      return value;
    };
    let closing = 0;
    for (const i of this.items.values()) if (i.frame && i.section !== "tiles" && (i === ref || i.frame.y < top)) closing += now(i.gap);
    const parent = source.parentGroup ? this.items.get(entryKey("group", source.parentGroup)) : undefined;
    const group = parent && isGroupItem(parent) ? parent : undefined;
    const above = !!group?.frame && group.frame.y < top && group !== ref;
    const vanishes = above && group!.tabIds.every((id) => source.tabIds.includes(id)) && (group!.section === "list" || group!.count === 1);
    const emptied = above && group!.section === "pinned" && group!.count === 1;
    if (!vanishes && source !== ref && source.frame && source.frame.y < top && !source.hidden)
      closing += source.parentGroup ? Math.max(0, now(source.size) - ROW_GAP) + (emptied ? (group!.padTop ?? 0) : ROW_GAP) : now(source.size);
    const container = ref.kind === "tail" ? [...this.items.values()].find((i) => i !== source && i.kind !== "tail" && !i.hidden && i.frame && i.section === ref.section && i.parentGroup === ref.parentGroup) : ref;
    const home = target ? null : this.at(source.frame, this.still(source));
    if (home) return Promise.resolve({ x: home.x, y: home.y });
    return Promise.all([measure(ref.view), vanishes ? measure(group!.view) : null]).then(([f, gone]) => {
      if (!f) return null;
      return { x: container?.frame?.x ?? f.x, y: f.y - closing - (gone ? gone.h + ROW_GAP : 0) + (ref.kind === "tail" ? ROW_GAP : 0) };
    });
  }

  protected autoScroll(y: number) {
    const session = this.drag;
    const v = session.viewport;
    const speed = !v ? 0 : y < v.y + EDGE ? -Math.ceil((v.y + EDGE - y) / 4) : y > v.y + v.h - EDGE ? Math.ceil((y - (v.y + v.h - EDGE)) / 4) : 0;
    clearInterval(session.scrollTimer);
    session.scrollTimer = undefined;
    if (!speed || !this.scroll) return;
    session.scrollTimer = setInterval(() => {
      const next = Math.max(0, this.scrollY + speed);
      if (next === this.scrollY) return;
      this.scroll?.scrollTo({ y: next, animated: false });
      if (session.inline) return;
      this.scrollY = next;
      this.retarget();
    }, 16);
  }

  protected ghostX(x: number): number {
    const left = x - this.drag.grab.x - this.rootFrame.x;
    const source = this.drag.sources[0];
    const home = source?.frame;
    if (!home || !source || !boxed(source)) return left;
    return home.x - this.rootFrame.x;
  }
}
