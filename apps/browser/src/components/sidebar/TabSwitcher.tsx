import { tabTitle } from "../../state/browser/model";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Panel, weight } from "../ui";
import { useTheme } from "../ui/theme";
import { useTab } from "../../state/browser/hooks";
import type { Tab } from "../../state/browser/types";
import { useSidebarUi } from "../../state/sidebar/sidebarUi";
import { commitSwitcher, hoverSwitcherRow, leaveSwitcherRow } from "../../state/sidebar/switcher";
import { lastPicture, refreshPicture } from "../../state/tabs/tabPictures";
import { TabIcon } from "./TabIcon";
import { SIDEBAR_SHADOW, SWITCHER_CARD_COLORS } from "./tokens";

const MAX_CARDS = 5;
const MARGIN = 20;
const PADDING = 15;
const RADIUS = 25;
const CARD_WIDTH = 175;
const CARD_HEIGHT = 152.5;
const CARD_RADIUS = 7.5;
const INSET = 11.25;
const PREVIEW_WIDTH = CARD_WIDTH - 2 * INSET;
const PREVIEW_HEIGHT = 101.25;
const FAVICON = 15;
const FAVICON_LEFT = 13.75;
const TITLE_GAP = 7.5;
const TITLE_SIZE = 13.75;
const PLACEHOLDER_ICON = 30;
const SELECTED_TINT = 0.45;

export function TabSwitcher({ windowId, windowWidth, windowHeight }: { windowId: string; windowWidth: number; windowHeight: number }) {
  const theme = useTheme();
  const switcher = useSidebarUi((u) => (u.switcher?.windowId === windowId && u.switcher.visible ? u.switcher : null));
  useFreshPictures(switcher?.ids);
  if (!switcher) return null;
  const fit = Math.max(1, Math.min(MAX_CARDS, Math.floor((windowWidth - 2 * MARGIN - 2 * PADDING) / CARD_WIDTH)));
  const start = Math.max(0, Math.min(switcher.index - Math.floor(fit / 2), switcher.ids.length - fit));
  const shown = switcher.ids.slice(start, start + fit);
  const width = shown.length * CARD_WIDTH + 2 * PADDING;
  const height = CARD_HEIGHT + 2 * PADDING;
  return (
    <Panel
      fill={theme.dark ? SWITCHER_CARD_COLORS.darkFill : theme.panel}
      radius={RADIUS}
      border={theme.panelBorder}
      shadow={SIDEBAR_SHADOW.tabSwitcher}
      style={{ position: "absolute", left: (windowWidth - width) / 2, top: Math.max(MARGIN, (windowHeight - height) / 2), width, height, padding: PADDING, flexDirection: "row" }}
    >
      {shown.map((id, i) => (
        <SwitcherCard key={id} tabId={id} focused={start + i === switcher.index} index={start + i} />
      ))}
    </Panel>
  );
}

function useFreshPictures(ids: readonly string[] | undefined) {
  const [, setFresh] = useState(0);
  useEffect(() => {
    if (!ids) return;
    let mounted = true;
    for (const id of ids)
      void refreshPicture(id).then((stored) => {
        if (stored && mounted) setFresh((n) => n + 1);
      });
    return () => {
      mounted = false;
    };
  }, [ids]);
}

function SwitcherCard({ tabId, focused, index }: { tabId: string; focused: boolean; index: number }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  useEffect(() => () => leaveSwitcherRow(index), [index]);
  if (!tab) return null;
  const mode = theme.dark ? "dark" : "light";
  const title = tabTitle(tab);
  return (
    <Pressable onPressIn={() => commitSwitcher(index)} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected: focused }}>
      <View
        onMouseEnter={() => hoverSwitcherRow(index)}
        onMouseLeave={() => leaveSwitcherRow(index)}
        style={{ width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: CARD_RADIUS, backgroundColor: focused ? SWITCHER_CARD_COLORS.selectedUnder[mode] : undefined }}
      >
        {focused && <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, borderRadius: CARD_RADIUS, backgroundColor: theme.backdrop.tintColor, opacity: SELECTED_TINT }} />}
        <Preview tab={tab} empty={SWITCHER_CARD_COLORS.previewEmpty[mode]} />
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", paddingLeft: FAVICON_LEFT, paddingRight: INSET, gap: TITLE_GAP }}>
          <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={FAVICON} profileId={tab.profileId} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: TITLE_SIZE, fontWeight: weight.semibold, color: theme.textPrimary }}>
            {title}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function Preview({ tab, empty }: { tab: Tab; empty: string }) {
  const picture = lastPicture(tab.id);
  const [, , pageWidth, pageHeight] = picture?.frame ?? [0, 0, 0, 0];
  const scale = pageWidth > 0 && pageHeight > 0 ? Math.max(PREVIEW_WIDTH / pageWidth, PREVIEW_HEIGHT / pageHeight) : 0;
  return (
    <View
      style={{
        marginTop: INSET,
        marginLeft: INSET,
        width: PREVIEW_WIDTH,
        height: PREVIEW_HEIGHT,
        borderRadius: CARD_RADIUS,
        overflow: "hidden",
        backgroundColor: empty,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {picture && scale ? (
        <Image
          accessible={false}
          source={{ uri: `data:image/jpeg;base64,${picture.data}` }}
          style={{ position: "absolute", top: 0, left: (PREVIEW_WIDTH - pageWidth * scale) / 2, width: pageWidth * scale, height: pageHeight * scale }}
        />
      ) : (
        <TabIcon url={tab.url} favicon={tab.favicon} icon={tab.customIcon} size={PLACEHOLDER_ICON} profileId={tab.profileId} />
      )}
    </View>
  );
}
