import { useRef } from "react";
import { ArcUrlFieldBackground, ArcUrlFieldText } from "@ardia/shell";
import { Image, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useActiveTabId, useTabLive, useWindowId } from "../../store/hooks";
import { usePageProgress } from "../../store/pageProgress";
import { splitOf } from "../../store/splits";
import { extensionsFitting, ToolbarExtensions, useToolbarExtensionsWidth } from "../extensions/ToolbarExtensions";
import { useHistoryAvailability } from "../layout/history";
import { toolbarPalette, type ToolbarPalette } from "../layout/toolbarColors";
import { ToolbarButton, type ButtonHit } from "../layout/controls";
import { addressBarInSidebar, setUrlAnchor, SIDEBAR_FIELD } from "../layout/windowLayout";
import { useHover } from "../primitives";
import { HistoryButton, ReloadButton, UrlField, useToolbarTab } from "../Toolbar";
import { ARC_LIGHTS_CENTER, HEADER_TOOLS, navButtonsFitting, type HeaderButton } from "../layout/dockMotion";

const BUTTON = layout.toolbarButton;
const { toggleX: TOGGLE_X, edge: EDGE } = HEADER_TOOLS;
const LIGHTS_Y = ARC_LIGHTS_CENTER[1];
const PLATE = 32;
const PLATE_RADIUS = 6;
const HEADER_GLYPH = 16;
const HEADER_WEIGHT = "medium";
const HEADER_INACTIVE = 5 / 12;
const DARK_ICON = "#FFFFFF99";
const DARK_ICON_DISABLED = "#FFFFFF40";

export function SidebarHeaderTools({ width }: { width: number }) {
  const windowId = useWindowId();
  const tab = useToolbarTab(useActiveTabId());
  const theme = useTheme();
  const base = toolbarPalette(theme, null);
  const palette = theme.dark ? { ...base, icon: DARK_ICON, iconDisabled: DARK_ICON_DISABLED } : base;
  const inactiveOpacity = theme.dark ? HEADER_INACTIVE : undefined;
  const toggle = useBrowser((s) => s.settings.showSidebarButton !== false);
  const { buttons, step } = navButtonsFitting(width, BUTTON, toggle);
  const shown = tab ? buttons : [];
  const last = width - EDGE - BUTTON / 2;
  const centres = shown.map((_, i) => last - (shown.length - 1 - i) * step);
  const at = toggle ? [TOGGLE_X, ...centres] : centres;
  const place = (center: number) => ({
    style: { position: "absolute" as const, top: LIGHTS_Y - PLATE / 2, left: center - PLATE / 2 },
    hit: { width: PLATE, height: PLATE, plateX: 0, plateY: 0, box: PLATE, radius: PLATE_RADIUS },
  });
  return (
    <>
      {toggle && (
        <ToolbarButton
          {...place(at[0]!)}
          palette={palette}
          icon="sidebar.left"
          size={HEADER_GLYPH}
          weight={HEADER_WEIGHT}
          inactiveOpacity={inactiveOpacity}
          onPress={() => useBrowser.getState().toggleSidebar(windowId)}
          tooltip="Auto-Hide Tabs (⌘S)"
        />
      )}
      {tab ? (
        <NavigationButtons tab={tab} palette={palette} inactiveOpacity={inactiveOpacity} buttons={shown} slots={at.slice(toggle ? 1 : 0).map(place)} />
      ) : null}
    </>
  );
}

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

export function SidebarAddressRow({ width }: { width: number }) {
  const windowId = useWindowId();
  const tab = useToolbarTab(useActiveTabId());
  const field = useRef<View>(null);
  const anchor = () =>
    field.current?.measureInWindow((x, y, width, height) => {
      if (width && addressBarInSidebar(useBrowser.getState(), windowId)) setUrlAnchor(windowId, { left: x, top: y, width, sidebar: { height } });
    });

  return (
    <View
      ref={field}
      onLayout={anchor}
      style={{ position: "absolute", left: layout.sidebarInset, right: layout.sidebarInset, top: SIDEBAR_FIELD.top, height: SIDEBAR_FIELD.height }}
    >
      {tab?.url ? <PageField tab={tab} windowId={windowId} width={width - 2 * layout.sidebarInset} /> : <EmptyField windowId={windowId} />}
    </View>
  );
}

const HOST_ROOM = 84;
const PLACEHOLDER_TEXT = { light: "#0000004D", dark: "#FFFFFF4D" } as const;
const SEARCH_ICON = { rest: { light: "#00000066", dark: "#FFFFFF66" }, hover: { light: "#000000CC", dark: "#FFFFFFCC" } } as const;
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
  const loading = useTabLive(tab.id, (l) => l.isLoading);
  const loaded = usePageProgress(tab.id);
  const progress = loading ? loaded : null;
  const inSplit = useBrowser((s) => !!splitOf(s, tab.id));
  const limit = extensionsFitting(width - 10 - 3 - HOST_ROOM);
  const extensionsWidth = useToolbarExtensionsWidth(windowId, limit);
  return (
    <UrlField
      tab={tab}
      palette={palette}
      windowId={windowId}
      inSplit={inSplit}
      onFocus={alreadyFocused}
      sidebar={{
        height: SIDEBAR_FIELD.height,
        progress,
        accessory: extensionsWidth ? (
          <View style={{ width: extensionsWidth - 6, height: 28 }}>
            <ToolbarExtensions tabId={tab.id} windowId={windowId} palette={palette} top={0} right={0} limit={limit} />
          </View>
        ) : null,
      }}
    />
  );
}

function EmptyField({ windowId }: { windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const searchIcon = useHover();
  const appearance = theme.dark ? "dark" : "light";
  const iconState = searchIcon.hovered ? "hover" : "rest";
  const open = () => useBrowser.getState().openPanel(windowId, "");
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
