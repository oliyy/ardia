import { memo, useLayoutEffect, useRef } from "react";
import { findNodeHandle, Image, Pressable, StyleSheet, View, type NativeSyntheticEvent, type ViewStyle } from "react-native";
import { layout, useTheme } from "../ui/theme";
import { useActiveTabId, useSettings, useTabLive, useWindowId } from "../../state/browser/hooks";
import { currentWindow } from "../../state/browser/current";
import { useShortcutHint, withShortcut } from "../../state/commands/commandShortcuts";
import { openPanel, toggleSidebar } from "../../state/windows/actions";
import { isAddressBarInSidebar } from "../../state/sidebar/current";
import { setUrlAnchor } from "../../state/windows/layout";
import { useHistoryAvailability } from "../../state/tabs/navigation";
import { ARC_LIGHTS_CENTER } from "../../state/windows/dockMotion";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "../../state/sidebar/sidebarWidth";
import { extensionsFitting, ToolbarExtensions, useToolbarExtensionsWidth } from "../extensions/ToolbarExtensions";
import { toolbarPalette, type ToolbarPalette } from "../ui/toolbarColors";
import { ArcUrlFieldBackground, ArcUrlFieldText, Button, type ButtonHit, useHover } from "../ui";
import { useToolbarTab } from "../toolbar/Toolbar";
import { SidebarUrlField } from "../toolbar/SidebarUrlField";
import { HistoryButton, ReloadButton } from "../toolbar/NavButtons";
import { HEADER_TOOLS, navButtonsFitting, type HeaderButton } from "../window/dockMotion";
import { SIDEBAR_FIELD } from "./geometry";
import { ADDRESS_HEADER_ICON, ADDRESS_PLACEHOLDER_TEXT, ADDRESS_SEARCH_ICON } from "./tokens";

const BUTTON = layout.toolbarButton;
const { toggleX: TOGGLE_X, edge: EDGE, pitch: PITCH } = HEADER_TOOLS;
const LIGHTS_Y = ARC_LIGHTS_CENTER[1];
const PLATE = 32;
const PLATE_RADIUS = 6;
const END_INSET = EDGE + BUTTON / 2 - PLATE / 2;
const HEADER_GLYPH = 16;
const HEADER_WEIGHT = "medium";
const HEADER_INACTIVE = 5 / 12;

export function SidebarHeaderTools({ width }: { width: number }) {
  const toggle = useSettings((s) => s.showSidebarButton !== false);
  const { buttons, step } = navButtonsFitting(width, BUTTON, toggle);
  const anchored = Number.isFinite(width) && Math.fround(width) === width && width >= SIDEBAR_MIN_WIDTH && width <= SIDEBAR_MAX_WIDTH && step === PITCH;
  return <HeaderTools toggle={toggle} buttons={buttons.join(" ")} last={anchored ? null : width - EDGE - BUTTON / 2} step={anchored ? null : step} />;
}

const HeaderTools = memo(function HeaderTools({ toggle, buttons, last, step }: { toggle: boolean; buttons: string; last: number | null; step: number | null }) {
  const windowId = useWindowId();
  const tab = useToolbarTab(useActiveTabId());
  const theme = useTheme();
  const base = toolbarPalette(theme, null);
  const palette = theme.dark ? { ...base, icon: ADDRESS_HEADER_ICON.dark, iconDisabled: ADDRESS_HEADER_ICON.darkDisabled } : base;
  const sidebarHint = useShortcutHint("toggleSidebar");
  const inactiveOpacity = theme.dark ? HEADER_INACTIVE : undefined;
  const shown = tab && buttons ? (buttons.split(" ") as HeaderButton[]) : [];
  const place = (edge: Pick<ViewStyle, "left" | "right">) => ({
    style: { position: "absolute" as const, top: LIGHTS_Y - PLATE / 2, ...edge },
    hit: { width: PLATE, height: PLATE, plateX: 0, plateY: 0, box: PLATE, radius: PLATE_RADIUS },
  });
  const slots = shown.map((_, i) => {
    const fromEnd = shown.length - 1 - i;
    return last === null || step === null ? place({ left: undefined, right: END_INSET + fromEnd * PITCH }) : place({ left: last - fromEnd * step - PLATE / 2, right: undefined });
  });
  return (
    <>
      {toggle && (
        <Button
          variant="icon"
          toolbar
          {...place({ left: TOGGLE_X - PLATE / 2 })}
          palette={palette}
          icon="sidebar.left"
          size={HEADER_GLYPH}
          weight={HEADER_WEIGHT}
          inactiveOpacity={inactiveOpacity}
          onPress={() => toggleSidebar(windowId)}
          tooltip={withShortcut("Auto-Hide Tabs", sidebarHint)}
        />
      )}
      {tab ? <NavigationButtons tab={tab} palette={palette} inactiveOpacity={inactiveOpacity} buttons={shown} slots={slots} /> : null}
    </>
  );
});

const alreadyFocused = () => {};

function NavigationButtons({
  tab,
  palette,
  inactiveOpacity,
  buttons,
  slots,
}: {
  tab: NonNullable<ReturnType<typeof useToolbarTab>>;
  palette: ToolbarPalette;
  inactiveOpacity: number | undefined;
  buttons: HeaderButton[];
  slots: { style: ViewStyle; hit: ButtonHit }[];
}) {
  const loading = useTabLive(tab.id, (l) => l.isLoading);
  const history = useHistoryAvailability(tab.id);
  return (
    <>
      {buttons.map((b, i) =>
        b === "reload" ? (
          <ReloadButton
            key={b}
            {...slots[i]!}
            tab={tab}
            loading={loading}
            palette={palette}
            onFocus={alreadyFocused}
            size={HEADER_GLYPH}
            weight={HEADER_WEIGHT}
            inactiveOpacity={inactiveOpacity}
          />
        ) : (
          <HistoryButton
            key={b}
            {...slots[i]!}
            tabId={tab.id}
            windowId={tab.windowId}
            direction={b === "back" ? -1 : 1}
            icon={b === "back" ? "arrow.left" : "arrow.right"}
            disabled={b === "back" ? !history.back : !history.forward}
            palette={palette}
            onFocus={alreadyFocused}
            size={HEADER_GLYPH}
            weight={HEADER_WEIGHT}
            inactiveOpacity={inactiveOpacity}
          />
        ),
      )}
    </>
  );
}

type MountReceipt = { receipt: number; target: number; x: number; y: number; width: number; height: number };

const validFrame = (x: number, y: number, width: number, height: number) => [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0;

const fieldShown = (windowId: string) => !!currentWindow(windowId) && isAddressBarInSidebar(windowId);

export function SidebarAddressRow({ width, receipt }: { width: number; receipt: number | undefined }) {
  const windowId = useWindowId();
  const tab = useToolbarTab(useActiveTabId());
  const field = useRef<View>(null);
  const latest = useRef({ windowId, receipt });
  latest.current = { windowId, receipt };
  const seen = useRef(0);
  if (receipt !== undefined && receipt > seen.current) seen.current = receipt;
  const floor = useRef(0);
  const epoch = useRef(0);
  const local = useRef<{ view: View; windowId: string; x: number; y: number; height: number } | null>(null);
  const anchored = useRef<{ view: View; windowId: string } | null>(null);
  const receiptMode = useRef(false);
  const session = receipt !== undefined;
  const wasSession = useRef(session);
  const anchor = () => {
    const view = field.current;
    if (!view) return;
    const mine = ++epoch.current;
    const id = latest.current.windowId;
    view.measureInWindow((x, y, w, h) => {
      if (epoch.current !== mine || field.current !== view || latest.current.windowId !== id || !validFrame(x, y, w, h) || !fieldShown(id)) return;
      anchored.current = { view, windowId: id };
      setUrlAnchor(id, { left: x, top: y, width: w, sidebar: { height: h } });
    });
  };
  const received = (e: NativeSyntheticEvent<MountReceipt>) => {
    if (!receiptMode.current) return;
    const { receipt: token, target, x, y, width: w, height: h } = e.nativeEvent;
    const now = latest.current;
    const view = field.current;
    if (!view || now.receipt === undefined || !Number.isSafeInteger(token) || token <= floor.current || token > now.receipt || !validFrame(x, y, w, h)) return;
    const tag = findNodeHandle(view);
    if (tag === null || target !== tag || !fieldShown(now.windowId)) return;
    epoch.current++;
    floor.current = token;
    setUrlAnchor(now.windowId, { left: x, top: y, width: w, sidebar: { height: h } });
  };
  useLayoutEffect(() => {
    epoch.current++;
    floor.current = Math.max(floor.current, receipt === undefined ? seen.current : receipt - 1);
    const view = field.current;
    if (local.current && (local.current.view !== view || local.current.windowId !== windowId)) local.current = null;
    if (anchored.current && (anchored.current.view !== view || anchored.current.windowId !== windowId)) anchored.current = null;
    receiptMode.current = session && !!view && !!local.current && !!anchored.current;
    const ended = wasSession.current && !session;
    wasSession.current = session;
    if (!ended) return;
    const frame = requestAnimationFrame(anchor);
    return () => cancelAnimationFrame(frame);
  }, [session, windowId]);

  return (
    <View
      ref={field}
      mountReceipt={receipt}
      onMountReceipt={received}
      onLayout={(e) => {
        const { x, y, height } = e.nativeEvent.layout;
        const view = field.current;
        const id = latest.current.windowId;
        const prev = local.current;
        const valid = !!view && [x, y, height].every(Number.isFinite) && height > 0;
        const unchanged = valid && !!prev && prev.view === view && prev.windowId === id && prev.x === x && prev.y === y && prev.height === height;
        local.current = valid && view ? { view, windowId: id, x, y, height } : null;
        if (receiptMode.current && unchanged) return;
        receiptMode.current = false;
        anchor();
      }}
      style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, top: SIDEBAR_FIELD.top, height: SIDEBAR_FIELD.height }}
    >
      {tab?.url ? <PageField tab={tab} windowId={windowId} width={width - 2 * layout.sidebarInset} /> : <EmptyField windowId={windowId} />}
    </View>
  );
}

const HOST_ROOM = 84;
const PLACEHOLDER_TEXT = ADDRESS_PLACEHOLDER_TEXT;
const SEARCH_ICON = ADDRESS_SEARCH_ICON;
const SEARCH_ICON_HOVER = { left: 7, size: 22 } as const;
const SEARCH_GLYPH = require("../../../assets/arc-url-icons/search.png");
const SEARCH_ICON_LAYERS = [
  ["light", "rest"],
  ["light", "hover"],
  ["dark", "rest"],
  ["dark", "hover"],
] as const;

function PageField({ tab, windowId, width }: { tab: NonNullable<ReturnType<typeof useToolbarTab>>; windowId: string; width: number }) {
  const palette = toolbarPalette(useTheme(), null);
  const limit = extensionsFitting(width - 10 - 3 - HOST_ROOM);
  const extensionsWidth = useToolbarExtensionsWidth(windowId, limit);
  return (
    <SidebarUrlField
      tab={tab}
      palette={palette}
      windowId={windowId}
      onFocus={alreadyFocused}
      height={SIDEBAR_FIELD.height}
      accessory={
        extensionsWidth ? (
          <View style={{ width: extensionsWidth - 6, height: 28 }}>
            <ToolbarExtensions tabId={tab.id} windowId={windowId} palette={palette} top={0} right={0} limit={limit} />
          </View>
        ) : null
      }
    />
  );
}

function EmptyField({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const searchIcon = useHover();
  const appearance = theme.dark ? "dark" : "light";
  const iconState = searchIcon.hovered ? "hover" : "rest";
  const open = () => openPanel(windowId, "");
  return (
    <View {...hoverProps}>
      <Pressable onPress={open}>
        <View
          style={{
            height: SIDEBAR_FIELD.height,
            borderRadius: SIDEBAR_FIELD.radius,
            borderCurve: "continuous",
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: layout.rowPadding,
          }}
        >
          <ArcUrlFieldBackground dark={theme.dark} hovered={hovered} pointerEvents="none" style={StyleSheet.absoluteFill} />
          <View accessible accessibilityRole="image" accessibilityLabel="Search" style={{ width: 16, height: 16 }}>
            {SEARCH_ICON_LAYERS.map(([look, state]) => (
              <Image
                key={`${look}-${state}`}
                source={SEARCH_GLYPH}
                accessible={false}
                style={{ position: "absolute", left: 0, top: 0, width: 16, height: 16, tintColor: SEARCH_ICON[state][look], opacity: look === appearance && state === iconState ? 1 : 0 }}
              />
            ))}
          </View>
          <View
            pointerEvents="none"
            {...searchIcon.hoverProps}
            style={{ position: "absolute", left: SEARCH_ICON_HOVER.left, top: (SIDEBAR_FIELD.height - SEARCH_ICON_HOVER.size) / 2, width: SEARCH_ICON_HOVER.size, height: SEARCH_ICON_HOVER.size }}
          />
          <ArcUrlFieldText text="" placeholder="Search or Enter URL…" alignment="leading" color={theme.dark ? PLACEHOLDER_TEXT.dark : PLACEHOLDER_TEXT.light} hoverButtonsWidth={0} pointerEvents="none" style={{ flex: 1, alignSelf: "stretch", marginLeft: 6 }} />
        </View>
      </Pressable>
    </View>
  );
}
