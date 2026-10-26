import { FileDropArea, type DroppedItem, type DropUpdate } from "@ardia/shell";
import { fixupUrl } from "@ardia/core";
import { forwardRef, useEffect, useRef, type ReactNode } from "react";
import type { StyleProp, View, ViewStyle } from "react-native";
import { useBrowser } from "../../store/browser";
import type { TabPlacement } from "../../store/organize";

export type DropPoint = [number, number];
export type TabDropTarget = {
  windowId: string;
  accepts?(): boolean;
  enter(count: number, at: DropPoint, token: number): unknown;
  move(at: DropPoint, token: number): void;
  leave(token: number): void;
  drop(at: DropPoint, token: number): TabPlacement | null;
};
type LandedDrop = { windowId: string; profileId: string; placement: TabPlacement | null };
type EnteredDrop = { token: number; windowId: string; profileId: string | undefined; epoch: number };

const MAX_DROPPED_TABS = 50;

export function droppedUrls(items: DroppedItem[]): string[] {
  const urls = items.flatMap((item) => {
    if (item.kind === "file") return /^file:\/\/\/[^/]/i.test(item.url) ? [item.url] : [];
    const raw = item.kind === "url" ? item.url.trim() : item.text.trim();
    const url = item.kind === "url" ? raw : /\s/.test(raw) ? null : fixupUrl(raw);
    return url && /^https?:\/\/[^/\s]/i.test(url) ? [url] : [];
  });
  return urls.slice(0, MAX_DROPPED_TABS);
}

function openDropped({ windowId, profileId, placement }: LandedDrop, urls: string[]): string[] {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (!urls.length || !w || !(s.profiles[profileId] || w.profileId === profileId)) return [];
  const paged = w.profileId !== profileId;
  const ids = urls.map((url, i) => s.newTab(windowId, { url, background: paged || i > 0, profileId })).filter(Boolean);
  if (ids.length && placement && !paged) useBrowser.getState().placeTabs(ids, placement);
  return ids;
}

let tokens = 0;

const profileIn = (windowId: string) => useBrowser.getState().windows[windowId]?.profileId;

const originOf = (view: View | null): Promise<DropPoint> =>
  new Promise((resolve) => (view ? view.measureInWindow((x, y) => resolve([x, y])) : resolve([0, 0])));

type Props = { target: TabDropTarget; style?: StyleProp<ViewStyle>; children?: ReactNode };

export const TabDropArea = forwardRef<View, Props>(function TabDropArea({ target, style, children }, ref) {
  const view = useRef<View | null>(null);
  const latest = useRef(target);
  latest.current = target;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const origin = useRef<DropPoint>([0, 0]);
  const generation = useRef(++tokens);
  const inside = useRef(false);
  const entered = useRef<EnteredDrop | null>(null);
  const count = useRef(0);
  const epoch = useRef(0);
  const run = <T,>(step: () => T | Promise<T>): Promise<T | null> => {
    const next = queue.current.then(step).catch(() => null);
    queue.current = next;
    return next;
  };
  const at = (e: DropUpdate): DropPoint => [origin.current[0] + e.x, origin.current[1] + e.y];
  const close = () => {
    const token = generation.current;
    generation.current = ++tokens;
    inside.current = false;
    return token;
  };
  const ready = () => latest.current.accepts?.() === true;
  const leaveGated = (token: number) => {
    if (entered.current?.token !== token) return;
    entered.current = null;
    latest.current.leave(token);
  };
  const enterGated = async (token: number, point: DropPoint) => {
    const windowId = latest.current.windowId;
    const profileId = profileIn(windowId);
    const since = epoch.current;
    if (token !== generation.current || !ready()) return;
    await latest.current.enter(count.current, point, token);
    if (token === generation.current && epoch.current === since && latest.current.windowId === windowId && profileIn(windowId) === profileId && ready())
      entered.current = { token, windowId, profileId, epoch: since };
    else latest.current.leave(token);
  };

  useEffect(() => {
    if (!latest.current.accepts) return;
    return useBrowser.subscribe((s, prev) => {
      const windowId = latest.current.windowId;
      if (s.windows[windowId]?.profileId !== prev.windows[windowId]?.profileId) epoch.current++;
    });
  }, []);

  useEffect(
    () => () => {
      if (latest.current.accepts) {
        const token = close();
        void run(() => leaveGated(token));
        return;
      }
      if (!inside.current) return;
      const token = close();
      void run(() => latest.current.leave(token));
    },
    [],
  );

  const onDropUpdate = (e: DropUpdate) => {
    if (e.phase === "enter") {
      if (inside.current) {
        const stale = close();
        void run(() => latest.current.leave(stale));
      }
      const token = (generation.current = ++tokens);
      inside.current = true;
      void run(async () => {
        const measured = await originOf(view.current);
        if (token !== generation.current) return;
        origin.current = measured;
        count.current = e.count;
        if (latest.current.accepts) return enterGated(token, at(e));
        await latest.current.enter(e.count, at(e), token);
      });
    } else if (e.phase === "move") {
      const token = generation.current;
      void run(() => {
        if (token !== generation.current) return;
        if (!latest.current.accepts) return latest.current.move(at(e), token);
        const session = entered.current;
        if (session?.token === token && (session.epoch !== epoch.current || session.windowId !== latest.current.windowId || session.profileId !== profileIn(session.windowId))) leaveGated(token);
        if (!ready()) return;
        if (entered.current?.token === token) return latest.current.move(at(e), token);
        return enterGated(token, at(e));
      });
    } else if (e.phase === "exit") {
      const token = close();
      void run(() => latest.current.leave(token));
    } else {
      const token = generation.current;
      inside.current = false;
      const windowId = latest.current.windowId;
      const profileId = useBrowser.getState().windows[windowId]?.profileId;
      const readyAtDrop = ready();
      const epochAtDrop = epoch.current;
      const urls = droppedUrls(e.items);
      void run(() => {
        if (latest.current.accepts) {
          const session = entered.current;
          const landed =
            readyAtDrop &&
            token === generation.current &&
            epoch.current === epochAtDrop &&
            latest.current.windowId === windowId &&
            session?.token === token &&
            session.epoch === epochAtDrop &&
            session.windowId === windowId &&
            session.profileId === profileId &&
            profileIn(windowId) === profileId &&
            ready();
          if (token === generation.current) generation.current = ++tokens;
          if (!landed) return leaveGated(token);
          entered.current = null;
          const placement = latest.current.drop(at(e), token);
          if (profileId) openDropped({ windowId, profileId, placement }, urls);
          return;
        }
        const current = token === generation.current;
        const placement = current ? latest.current.drop(at(e), token) : null;
        if (current) generation.current = ++tokens;
        if (profileId) openDropped({ windowId, profileId, placement }, urls);
      });
    }
  };

  return (
    <FileDropArea
      ref={(v) => {
        view.current = v;
        if (typeof ref === "function") ref(v);
        else if (ref) ref.current = v;
      }}
      style={style}
      onDropUpdate={onDropUpdate}
    >
      {children}
    </FileDropArea>
  );
});
