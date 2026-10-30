import { useEffect, type RefObject } from "react";
import type { ScrollView, View } from "react-native";
import { watchRevealRequests, watchRevealTargets, windowProfileNow } from "../../state/sidebar/reveal";
import { measureRow } from "../../state/sidebar/sidebarUi";
import { revealSpot } from "../../state/sidebar/geometry";
import type { SidebarGeometry } from "./pageLayout";

export function useRevealTabs(windowId: string, scroll: RefObject<ScrollView | null>, scrollY: RefObject<number>, geometry: RefObject<SidebarGeometry>, ready: () => boolean) {
  useEffect(() => {
    let switched: string | null = null;
    let opened: string | null = null;
    let frame = 0;
    let reveals = 0;
    const show = (view: ScrollView, y: number, height: number) => {
      const top = scrollY.current ?? 0;
      const { viewport, room, pad } = geometry.current;
      if (y - top < room) view.scrollTo({ y: Math.max(0, y - pad), animated: true });
      else if (y + height - top > viewport - 8) view.scrollTo({ y: y + height - viewport + 8, animated: true });
    };
    const forget = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      switched = opened = null;
      reveals++;
    };
    const reveal = () => {
      frame = 0;
      const scroller = scroll.current;
      if (!geometry.current.viewport || !scroller || !ready()) return;
      const mine = ++reveals;
      const tabId = switched ?? opened;
      switched = opened = null;
      const profileId = windowProfileNow(windowId);
      if (!tabId || !profileId) return;
      const stillWanted = () => mine === reveals && scroll.current === scroller && windowProfileNow(windowId) === profileId && ready();
      const spot = revealSpot(windowId, tabId, geometry.current.tilesFixed, geometry.current.newTabAtTop);
      if (!spot) return;
      if ("span" in spot) return show(scroller, geometry.current.pad + geometry.current.regions[spot.span.section] + spot.span.top, spot.span.height);
      const view = scroller as unknown as View;
      const keys = spot.keys;
      const firstShown = (i: number): Promise<Awaited<ReturnType<typeof measureRow>>> =>
        i >= keys.length || !stillWanted() ? Promise.resolve(null) : measureRow(windowId, keys[i]!).then((row) => row ?? firstShown(i + 1));
      void firstShown(0).then((row) => row && stillWanted() && view.measureInWindow((_x, y) => stillWanted() && show(scroller, row.y - y + (scrollY.current ?? 0), row.height)));
    };
    const schedule = () => {
      if ((switched || opened) && !frame) frame = requestAnimationFrame(reveal);
    };
    const unrequest = watchRevealRequests(windowId, (id) => {
      switched = id;
      reveals++;
      schedule();
    });
    const unsubscribe = watchRevealTargets(windowId, (nowSwitched, nowOpened, crossed) => {
      if (crossed) forget();
      if (nowSwitched) {
        switched = nowSwitched;
        reveals++;
      }
      if (nowOpened) {
        opened = nowOpened;
        reveals++;
      }
      schedule();
    });
    geometry.current.laidOut = schedule;
    return () => {
      forget();
      unsubscribe();
      unrequest();
      geometry.current.laidOut = undefined;
    };
  }, [windowId]);
}
