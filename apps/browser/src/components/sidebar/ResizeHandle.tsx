import { useEffect, useRef, useState } from "react";
import { findNodeHandle, View, type NativeSyntheticEvent } from "react-native";
import { useBrowser } from "../../store/browser";
import { useResizeDrag } from "../layout/useResizeDrag";
import { registerResize, setSidebarUi, sidebarUi } from "./state";
import { fittedSidebarWidth, SIDEBAR_MIN_WIDTH, widestSidebar } from "./tokens";
import { useHandleArming } from "./useHandleArming";

type Binding = { view: View; window: string };
type MountReceipt = { receipt: number; target: number; x: number; y: number; width: number; height: number };

const receiptScope = globalThis as typeof globalThis & { __ardiaSidebarResizeReceipt?: number };
if (!("__ardiaSidebarResizeReceipt" in receiptScope)) receiptScope.__ardiaSidebarResizeReceipt = 0;

function allocateReceipt(): number | null {
  const last = receiptScope.__ardiaSidebarResizeReceipt;
  if (last === undefined || !Number.isSafeInteger(last) || last < 0 || last >= Number.MAX_SAFE_INTEGER) return null;
  receiptScope.__ardiaSidebarResizeReceipt = last + 1;
  return last + 1;
}

export function ResizeHandle({ windowId, receipt, onArming }: { windowId: string; receipt: number | undefined; onArming: (arming: boolean) => void }) {
  const latestWindow = useRef(windowId);
  latestWindow.current = windowId;
  const [flow] = useState(() => {
    let issued = 0;
    let view: View | null = null;
    let binding: Binding | null = null;
    let owned: string | null = null;
    const tickets = new Set<number>();
    let submitted: number | null = null;
    let pending: number | null = null;
    const exists = (id: string) => !!useBrowser.getState().windows[id];
    const permitted = () => (binding && binding.view === view && binding.window === latestWindow.current && exists(binding.window) ? binding : null);
    const invalidate = () => {
      tickets.clear();
      submitted = null;
      pending = null;
    };
    const drop = (id: string) => {
      const { dragWidth, dragReceipt } = sidebarUi();
      if (!(id in dragWidth) && !(id in dragReceipt)) return;
      const { [id]: _, ...widths } = dragWidth;
      const { [id]: __, ...receipts } = dragReceipt;
      setSidebarUi({ dragWidth: widths, dragReceipt: receipts });
    };
    const abandon = () => {
      binding = null;
      invalidate();
      const id = owned;
      owned = null;
      if (id !== null) drop(id);
    };
    const submit = (bound: Binding, width: number) => {
      const ticket = allocateReceipt();
      if (ticket === null) return;
      issued = ticket;
      tickets.add(ticket);
      submitted = width;
      owned = bound.window;
      const { dragWidth, dragReceipt } = sidebarUi();
      const { [bound.window]: _, ...widths } = dragWidth;
      const { [bound.window]: __, ...receipts } = dragReceipt;
      setSidebarUi({ dragWidth: { ...widths, [bound.window]: width }, dragReceipt: { ...receipts, [bound.window]: ticket } });
    };
    const received = (e: NativeSyntheticEvent<MountReceipt>) => {
      const bound = permitted();
      if (!bound) return;
      const { receipt: mounted, target, x, y, width, height } = e.nativeEvent;
      if (!Number.isSafeInteger(mounted) || mounted <= 0 || mounted > issued) return;
      const tag = findNodeHandle(bound.view);
      if (tag === null || target !== tag) return;
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
      let covered = false;
      for (const ticket of tickets) {
        if (ticket > mounted) continue;
        tickets.delete(ticket);
        covered = true;
      }
      if (!covered) return;
      const next = pending;
      pending = null;
      if (next !== null && next !== submitted) submit(bound, next);
    };
    const live = (width: number | null) => {
      const bound = permitted();
      if (!bound) return;
      if (width === null) {
        invalidate();
        binding = null;
        owned = null;
        drop(bound.window);
        return;
      }
      const rounded = Math.round(width * 2) / 2;
      if (rounded === submitted) pending = null;
      else if (tickets.size >= 2) pending = rounded;
      else {
        pending = null;
        submit(bound, rounded);
      }
    };
    const commit = (width: number) => {
      if (!permitted()) return;
      invalidate();
      useBrowser.getState().updateSettings({ sidebarWidth: width });
    };
    const grant = () => {
      invalidate();
      const id = latestWindow.current;
      binding = view && exists(id) ? { view, window: id } : null;
    };
    const attach = (next: View | null) => {
      if (view !== null && view !== next) abandon();
      view = next;
    };
    const watch = (windows: Record<string, unknown>) => {
      const id = binding?.window ?? owned;
      if (id !== null && !windows[id]) abandon();
    };
    return { live, commit, grant, attach, abandon, watch, received };
  });
  useEffect(() => flow.abandon, [flow, windowId]);
  useEffect(() => useBrowser.subscribe((s, prev) => void (s.windows !== prev.windows && flow.watch(s.windows))), [flow]);
  const windowWidth = useBrowser((s) => s.windows[windowId]?.frame?.[2]);
  const { handlers, cancel } = useResizeDrag({
    min: SIDEBAR_MIN_WIDTH,
    max: widestSidebar(windowWidth),
    direction: 1,
    saved: () => fittedSidebarWidth(useBrowser.getState(), windowId),
    onLive: flow.live,
    onCommit: flow.commit,
  });
  useEffect(() => registerResize(windowId, cancel), [windowId, cancel]);
  const armingProps = useHandleArming(windowId, onArming);
  return (
    <View
      ref={flow.attach}
      mountReceipt={receipt}
      onMountReceipt={flow.received}
      {...handlers}
      {...armingProps}
      onResponderGrant={(e) => {
        flow.grant();
        handlers.onResponderGrant?.(e);
      }}
      onDoubleClick={() => useBrowser.getState().updateSettings({ sidebarWidth: 190 })}
      style={{ position: "absolute", top: 46, bottom: 0, right: 0, width: 4, cursor: "col-resize" }}
    />
  );
}
