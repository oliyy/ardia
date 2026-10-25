import { ContextMenuArea } from "@ardia/shell";
import { memo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { IconButton, useHover } from "../primitives";
import { openProfileMenu } from "../ProfileIndicator";
import { ProfileGlyph } from "../profiles/icons";
import { openSpaceMenu } from "./menus";

const ICON = 16;
const TEXT_GAP = layout.rowLabelGap + 2;
const NAME_SIZE = 13;
const NAME_OFFSET = 0.5;
const DARK_NAME = "#FFFFFF76";
const MORE_BOX = 22;
const MORE_GLYPH = 13;
const MORE_RADIUS = 6;
const DARK_GLYPH_TINT = "#FFFFFFF2";
const LIGHT_GLYPH_TINT = "#000000C6";
const GLYPH_TINTS = [DARK_GLYPH_TINT, LIGHT_GLYPH_TINT];

export const SpaceHeader = memo(function SpaceHeader({ windowId, profileId, top }: { windowId: string; profileId: string; top: number }) {
  const theme = useTheme();
  const profile = useBrowser(useShallow((s) => ({ name: s.profiles[profileId]?.name ?? "", icon: s.profiles[profileId]?.icon ?? null })));
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  const openMenu = () => void openSpaceMenu(windowId, profileId);
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
            tooltip="Switch between profiles"
            onPress={() => void openProfileMenu(windowId)}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            style={{ flex: 1, alignSelf: "stretch", flexDirection: "row", alignItems: "center", paddingLeft: layout.rowPadding }}
          >
            <View style={{ width: ICON, height: ICON, alignItems: "center", justifyContent: "center" }}>
              <ProfileGlyph profile={profile} glyph={ICON} imageSize={ICON} color={theme.dark ? DARK_GLYPH_TINT : LIGHT_GLYPH_TINT} tints={GLYPH_TINTS} />
            </View>
            <Text numberOfLines={1} style={{ flexShrink: 1, marginLeft: TEXT_GAP, fontSize: NAME_SIZE, fontWeight: "600", color: theme.dark ? DARK_NAME : theme.textSecondary, top: NAME_OFFSET }}>
              {profile.name}
            </Text>
          </Pressable>
          <View style={{ opacity: hovered ? 1 : 0 }}>
            <IconButton icon="ellipsis" size={MORE_GLYPH} box={MORE_BOX} radius={MORE_RADIUS} color={theme.icon} tooltip="More" onPress={openMenu} />
          </View>
        </View>
      </ContextMenuArea>
    </View>
  );
});
