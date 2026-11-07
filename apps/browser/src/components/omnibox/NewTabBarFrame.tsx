import type { SearchScope, Suggestion } from "@ardia/core";
import { useState, type ReactNode, type RefObject } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ContextMenuArea, Symbol, useHover, useTheme } from "../ui";
import { useSettings } from "../../state/browser/hooks";
import { openSuggestionSettings } from "../../state/omnibox/suggestionsPrivacy";
import { ScopeChip } from "./ScopeChip";
import { INCOGNITO_ICON } from "../ui/tokens";
import { NewTabBarIcon } from "./NewTabBarRows";
import { FIELD_TEXT_INSET, NEW_TAB_BAR, NEW_TAB_BAR_COLORS, NEW_TAB_BAR_TYPE } from "./tokens";

export function NewTabBarFrame({
  rootRef,
  onContextMenu,
  leading,
  incognito,
  scope,
  field,
  list,
}: {
  rootRef: RefObject<View | null>;
  onContextMenu(): void;
  leading: Suggestion | null;
  incognito: boolean;
  scope: SearchScope | null;
  field: ReactNode;
  list: ReactNode;
}) {
  const theme = useTheme();
  const colors = NEW_TAB_BAR_COLORS[theme.dark ? "dark" : "light"];
  const suggests = useSettings((s) => s.searchSuggestions);
  const [noteShown, setNoteShown] = useState(false);
  return (
    <View ref={rootRef}>
      <ContextMenuArea captureDescendants onContextMenu={onContextMenu}>
        <View style={{ height: NEW_TAB_BAR.fieldHeight, flexDirection: "row", alignItems: "center", paddingLeft: NEW_TAB_BAR.textLeft - FIELD_TEXT_INSET, paddingRight: NEW_TAB_BAR.fieldRight, gap: NEW_TAB_BAR.fieldGap }}>
          <View style={{ position: "absolute", left: NEW_TAB_BAR.iconCentre - NEW_TAB_BAR.iconSlot / 2, width: NEW_TAB_BAR.iconSlot, height: NEW_TAB_BAR.iconSlot, alignItems: "center", justifyContent: "center" }}>
            {leading ? (
              <NewTabBarIcon suggestion={leading} color={theme.textPrimary} size={NEW_TAB_BAR.faviconInField} />
            ) : (
              <Symbol name={incognito ? INCOGNITO_ICON : "magnifyingglass"} size={NEW_TAB_BAR.fieldIcon} weight="semibold" color={theme.textPrimary} style={{ width: NEW_TAB_BAR.iconSlot, height: NEW_TAB_BAR.iconSlot }} />
            )}
          </View>
          {scope && <ScopeChip scope={scope} />}
          {field}
          {suggests ? <InfoButton fill={colors.infoFill} ink={colors.accessoryInk} pressed={noteShown} onPress={() => setNoteShown((shown) => !shown)} /> : null}
        </View>
      </ContextMenuArea>
      {suggests && noteShown ? (
        <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: NEW_TAB_BAR.textLeft, paddingRight: NEW_TAB_BAR.fieldRight, paddingBottom: NEW_TAB_BAR.note.below, gap: NEW_TAB_BAR.note.gap }}>
          <Text numberOfLines={2} style={{ ...NEW_TAB_BAR_TYPE.note, color: colors.secondary, flex: 1 }}>
            Ardia asks your search engine for suggestions as you type.
          </Text>
          <NoteButton title="Search Settings" fill={colors.accessoryFill} ink={colors.text} onPress={openSuggestionSettings} />
        </View>
      ) : null}
      {list ? (
        <>
          <View style={{ height: StyleSheet.hairlineWidth, marginHorizontal: NEW_TAB_BAR.divider.inset, backgroundColor: theme.divider }} />
          {list}
        </>
      ) : null}
    </View>
  );
}

function InfoButton({ fill, ink, pressed, onPress }: { fill: string; ink: string; pressed: boolean; onPress(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityLabel="About Search Suggestions">
        <View style={{ width: NEW_TAB_BAR.info.box, height: NEW_TAB_BAR.info.box, borderRadius: NEW_TAB_BAR.info.box / 2, backgroundColor: fill, alignItems: "center", justifyContent: "center" }}>
          <Symbol name="info.circle" size={NEW_TAB_BAR.info.glyph} weight="medium" color={hovered || pressed ? theme.textPrimary : ink} style={{ width: NEW_TAB_BAR.info.glyph + 2, height: NEW_TAB_BAR.info.glyph + 2 }} />
        </View>
      </Pressable>
    </View>
  );
}

function NoteButton({ title, fill, ink, onPress }: { title: string; fill: string; ink: string; onPress(): void }) {
  return (
    <Pressable onPress={onPress}>
      <View style={{ height: NEW_TAB_BAR.note.button.height, paddingHorizontal: NEW_TAB_BAR.note.button.padX, borderRadius: NEW_TAB_BAR.note.button.radius, backgroundColor: fill, justifyContent: "center" }}>
        <Text style={{ ...NEW_TAB_BAR_TYPE.note, color: ink }}>{title}</Text>
      </View>
    </Pressable>
  );
}
