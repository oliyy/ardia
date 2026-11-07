import { memo, useRef, useState } from "react";
import { Animated, Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { Button, ContextMenuArea, FadeLabel, font, radius, Symbol, useHover } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { HoverSlot } from "../ui/HoverSlot";
import { newTab } from "../../state/tabs/actions";
import { useCleanedCount } from "../../state/sidebar/hooks";
import { openNewTabInSplit } from "../../state/splits/actions";
import { openOverflowMenu, openSidebarMenu } from "../../state/sidebar/menus";
import { toggleNewTabBar } from "../../state/omnibox/newTabBar";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { useWindowUiOf } from "../../state/windows/hooks";
import { modifiersOf } from "../../lib/keys";
import { useClipped, useShift, type ClipSource } from "./EntryMotion";
import { ARC_NEW_TAB, useSidebarTokens } from "./tokens";

const CLIPPED = { marginTop: -layout.rowGap, paddingTop: layout.rowGap, overflow: "hidden" } as const;
const NEW_TAB_LABEL_X = 30;
const CLEANED_HINT_RIGHT = 30;
const CLEANED_HINT_GAP = 8;
const MEASURE_OFFSCREEN = { position: "absolute", width: 1000, height: 0, overflow: "hidden", opacity: 0 } as const;

export const NewTabRow = memo(function NewTabRow({ windowId, shift = null, clip = null }: { windowId: string; shift?: Animated.Value | null; clip?: ClipSource | null }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const cleaned = useCleanedCount(windowId);
  const addressBar = useAddressBarInSidebar();
  const restingChevron = !addressBar;
  const arcDark = addressBar && theme.dark;
  const barOpen = useWindowUiOf(windowId, (ui) => !!ui?.panel.open && !!ui.panel.newTab);
  const { hovered, hoverProps } = useHover();
  const [moved, movedRef] = useShift(shift);
  const [movedButtons, movedButtonsRef] = useShift(shift);
  const clipped = useClipped(clip);
  const widths = useRef({ row: 0, label: 0, hint: 0 });
  const [hintFits, setHintFits] = useState(false);
  const measure = (key: keyof typeof widths.current) => (e: LayoutChangeEvent) => {
    const width = Math.ceil(e.nativeEvent.layout.width);
    if (widths.current[key] === width) return;
    const next = { ...widths.current, [key]: width };
    widths.current = next;
    setHintFits(next.hint > 0 && NEW_TAB_LABEL_X + next.label + CLEANED_HINT_GAP + next.hint <= next.row - CLEANED_HINT_RIGHT);
  };
  const hint = `${cleaned} cleaned`;
  return (
    <View {...hoverProps} onLayout={measure("row")} style={[{ flexDirection: "row", alignItems: "center" }, clipped ? CLIPPED : null]}>
      <View pointerEvents="none" style={MEASURE_OFFSCREEN}>
        <Text numberOfLines={1} style={{ alignSelf: "flex-start", fontSize: layout.rowFontSize }} onLayout={measure("label")}>
          New Tab
        </Text>
        {cleaned > 0 ? (
          <Text numberOfLines={1} style={{ alignSelf: "flex-start", ...font.caption }} onLayout={measure("hint")}>
            {hint}
          </Text>
        ) : null}
      </View>
      <ContextMenuArea style={{ flex: 1 }} onContextMenu={() => void openSidebarMenu(windowId)}>
        <Pressable
          onPress={(e) => {
            if (modifiersOf(e).altKey) openNewTabInSplit(windowId);
            else toggleNewTabBar(windowId) || newTab(windowId, { newTabCommand: true });
          }}
        >
          {({ pressed }) => (
            <View
              {...moved}
              ref={movedRef}
              style={[
                {
                  height: layout.rowHeight,
                  borderRadius: layout.rowRadius,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingLeft: layout.rowPadding,
                  paddingRight: 34,
                  backgroundColor: barOpen ? tokens.selectedFill : pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
                },
                moved.style as object,
              ]}
            >
              <Symbol name="plus" size={addressBar ? ARC_NEW_TAB.size : 13} weight="medium" color={barOpen ? theme.textPrimary : arcDark ? ARC_NEW_TAB.icon : tokens.newTabIcon} style={{ width: 16, height: 16 }} />
              <FadeLabel text="New Tab" fontSize={layout.rowFontSize} color={barOpen ? theme.textPrimary : arcDark ? ARC_NEW_TAB.label : tokens.newTabLabel} style={{ flex: 1, height: 18, marginLeft: layout.rowLabelGap }} />
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
      <View {...movedButtons} ref={movedButtonsRef} style={[{ position: "absolute", right: 6, flexDirection: "row", alignItems: "center" }, movedButtons.style as object]}>
        <HoverSlot hovered={hovered && cleaned > 0 && hintFits} width={0} hover={<Text style={{ ...font.caption, color: theme.textTertiary, marginRight: 2 }}>{hint}</Text>} />
        <View style={{ opacity: hovered || restingChevron ? 1 : 0 }}>
          <Button
            variant="icon"
            icon="chevron.down"
            size={10}
            weight="semibold"
            box={22}
            radius={radius.m}
            color={hovered ? theme.textSecondary : theme.textTertiary}
            tooltip="Open and recently closed tabs"
            onPress={() => void openOverflowMenu(windowId)}
          />
        </View>
      </View>
    </View>
  );
});
