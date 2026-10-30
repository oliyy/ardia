import { memo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { Button, ContextMenuArea, radius, Symbol, useHover, weight } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { useProfile } from "../../state/browser/hooks";
import { setPinnedCollapsed } from "../../state/sidebar/pinnedFold";
import { openSpaceMenu } from "../../state/sidebar/arcMenus";
import { iconMenuItems, ProfileGlyph } from "../profiles/ProfileIcons";
import { SPACE_HEADER_INK } from "./tokens";

const ICON = 16;
const TEXT_GAP = layout.rowLabelGap + 2;
const NAME_SIZE = 13;
const NAME_OFFSET = 0.5;
const CHEVRON = 12;
const MORE_BOX = 22;
const MORE_GLYPH = 13;
const GLYPH_TINTS = [SPACE_HEADER_INK.darkGlyph, SPACE_HEADER_INK.lightGlyph];
const sidebarIconItems = (current: string | null) => iconMenuItems(current, "None");

export const SpaceHeader = memo(function SpaceHeader({ windowId, profileId, top }: { windowId: string; profileId: string; top: number }) {
  const theme = useTheme();
  const profile = useProfile(profileId, useShallow((p) => ({ name: p?.name ?? "", icon: p?.icon ?? null })));
  const collapsed = useProfile(profileId, (p) => !!p?.pinnedCollapsed);
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  const openMenu = () => void openSpaceMenu(windowId, profileId, sidebarIconItems);
  const chevron = collapsed || hovered;
  return (
    <View {...hoverProps} style={{ marginTop: top }}>
      <ContextMenuArea onContextMenu={openMenu}>
        <View
          style={{
            height: layout.rowHeight,
            borderRadius: layout.rowRadius,
            flexDirection: "row",
            alignItems: "center",
            paddingRight: layout.rowPadding,
            backgroundColor: pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={profile.name}
            accessibilityState={{ expanded: !collapsed }}
            onPress={() => setPinnedCollapsed(profileId, !collapsed)}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            style={{ flex: 1, alignSelf: "stretch", flexDirection: "row", alignItems: "center", paddingLeft: layout.rowPadding }}
          >
            <View style={{ width: ICON, height: ICON, alignItems: "center", justifyContent: "center" }}>
              <View style={{ opacity: chevron ? 0 : 1 }}>
                <ProfileGlyph profile={profile} glyph={ICON} imageSize={ICON} color={theme.dark ? SPACE_HEADER_INK.darkGlyph : SPACE_HEADER_INK.lightGlyph} tints={GLYPH_TINTS} />
              </View>
              {chevron ? (
                <Symbol
                  name={collapsed ? "chevron.right" : "chevron.down"}
                  size={CHEVRON}
                  weight="bold"
                  color={theme.dark ? SPACE_HEADER_INK.darkChevron : theme.icon}
                  style={{ position: "absolute", left: 0, top: 0, width: ICON, height: ICON }}
                />
              ) : null}
            </View>
            <Text numberOfLines={1} style={{ flexShrink: 1, marginLeft: TEXT_GAP, fontSize: NAME_SIZE, fontWeight: weight.semibold, color: theme.dark ? SPACE_HEADER_INK.darkName : theme.textSecondary, top: NAME_OFFSET }}>
              {profile.name}
            </Text>
          </Pressable>
          <View style={{ opacity: hovered ? 1 : 0 }}>
            <Button variant="icon" icon="ellipsis" size={MORE_GLYPH} box={MORE_BOX} radius={radius.m} color={theme.icon} tooltip="More" onPress={openMenu} />
          </View>
        </View>
      </ContextMenuArea>
    </View>
  );
});
