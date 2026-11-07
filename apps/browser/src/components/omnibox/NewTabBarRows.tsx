import { displayUrl, type Suggestion } from "@ardia/core";
import { memo, type ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Button, ink, Symbol, useHover, useTheme, type Theme } from "../ui";
import { mix } from "../../lib/color";
import { fixedThemeSource, ThemeContext, themeFor } from "../ui/theme";
import { Favicon } from "../favicon/Favicon";
import { isRemovable, sameSuggestion, type RowActions } from "./SuggestionRow";
import { NEW_TAB_BAR, NEW_TAB_BAR_COLORS, NEW_TAB_BAR_TYPE, SUGGESTION, type NewTabBarColors } from "./tokens";

const ROW = NEW_TAB_BAR.row;
const GLYPH_BOX = { width: ROW.glyph + 3, height: ROW.glyph + 3 } as const;
const LIGHT_ICONS = fixedThemeSource(themeFor("plum:light"));

export const newTabBarAccent = (theme: Theme) => {
  const accent = theme.powerUpColor ?? theme.accent;
  return theme.dark ? mix(accent, ink.white, NEW_TAB_BAR.selectedLift) : accent;
};

function glyphOf(s: Suggestion): string | null {
  switch (s.kind) {
    case "search":
      return "magnifyingglass";
    case "calc":
      return "equal.circle";
    case "action":
      return s.icon ?? "command";
    case "extension":
      return s.icon ? null : "puzzlepiece.extension";
    default:
      return null;
  }
}

export function NewTabBarIcon({ suggestion: s, color, size = ROW.favicon }: { suggestion: Suggestion; color: string; size?: number }) {
  const glyph = glyphOf(s);
  if (glyph) return <Symbol name={glyph} size={ROW.glyph} weight="medium" color={color} style={GLYPH_BOX} />;
  if (s.kind === "extension" && s.icon) return <Image source={{ uri: s.icon }} style={{ width: size, height: size }} />;
  if (s.kind === "create") return <Favicon url={`https://${s.site}`} size={size} />;
  if (s.kind === "page") return <Favicon url={s.url} favicon={s.favicon} size={size} />;
  return null;
}

function labels(s: Suggestion): { title: string; url: string | null; hint: string | null } {
  switch (s.kind) {
    case "page":
      if (s.tabId) return { title: s.title || displayUrl(s.url), url: null, hint: "Switch to Tab" };
      return s.title ? { title: s.title, url: displayUrl(s.url), hint: null } : { title: displayUrl(s.url), url: null, hint: null };
    case "search":
      return { title: s.bang ? `Search ${s.engine} for ${s.query}` : s.query, url: null, hint: null };
    case "calc":
      return { title: s.value, url: s.expression, hint: null };
    case "action":
      return { title: s.title, url: null, hint: s.hint ?? null };
    case "create":
      return { title: s.title, url: null, hint: null };
    case "extension":
      return { title: s.title, url: null, hint: s.open === "action" ? "Open Extension" : "Extension Options" };
  }
}

export const NewTabBarList = memo(function NewTabBarList({
  items,
  selectedIndex,
  trailing,
  actions,
}: {
  items: Suggestion[];
  selectedIndex: number;
  trailing: string | null;
  actions: RowActions;
}) {
  const theme = useTheme();
  const colors = NEW_TAB_BAR_COLORS[theme.dark ? "dark" : "light"];
  const accent = newTabBarAccent(theme);
  return (
    <View style={{ paddingHorizontal: NEW_TAB_BAR.list.x, paddingTop: NEW_TAB_BAR.list.above, paddingBottom: NEW_TAB_BAR.list.below }}>
      {items.map((s, i) => (
        <NewTabBarRow key={i} suggestion={s} selected={i === selectedIndex} trailing={i === 0 ? trailing : null} actions={actions} colors={colors} accent={accent} />
      ))}
    </View>
  );
});

function IconBox({ selected, children }: { selected: boolean; children: ReactNode }) {
  const box = { width: ROW.iconBox, height: ROW.iconBox, borderRadius: ROW.iconRadius, alignItems: "center", justifyContent: "center" } as const;
  if (!selected) return <View style={box}>{children}</View>;
  return (
    <ThemeContext.Provider value={LIGHT_ICONS}>
      <View style={{ ...box, backgroundColor: NEW_TAB_BAR_COLORS.dark.selectedBox }}>{children}</View>
    </ThemeContext.Provider>
  );
}

const NewTabBarRow = memo(function NewTabBarRow({
  suggestion: s,
  selected,
  trailing,
  actions,
  colors,
  accent,
}: {
  suggestion: Suggestion;
  selected: boolean;
  trailing: string | null;
  actions: RowActions;
  colors: NewTabBarColors;
  accent: string;
}) {
  const { hovered, hoverProps } = useHover();
  const { title, url, hint: ownHint } = labels(s);
  const hint = trailing ?? ownHint;
  const switches = s.kind === "page" && !!s.tabId;
  const onRemove = isRemovable(s) ? () => actions.remove(s.url) : undefined;
  const removable = !!onRemove && hovered;
  const ink = selected ? colors.selectedText : colors.text;
  return (
    <View {...hoverProps}>
      <Pressable onPress={() => actions.choose(s)}>
        <View
          style={{
            height: ROW.height,
            marginVertical: ROW.gapY,
            borderRadius: ROW.radius,
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: ROW.iconLeft,
            paddingRight: ROW.right,
            backgroundColor: selected ? accent : hovered ? colors.hover : undefined,
          }}
        >
          <IconBox selected={selected}>
            <NewTabBarIcon suggestion={s} color={selected ? accent : colors.text} />
          </IconBox>
          <Text numberOfLines={1} style={{ flexShrink: 1, marginLeft: ROW.textGap, ...NEW_TAB_BAR_TYPE.row, color: ink }}>
            {title}
            {url ? <Text style={{ ...NEW_TAB_BAR_TYPE.url, color: selected ? colors.selectedUrl : colors.secondary }}>{` — ${url}`}</Text> : null}
          </Text>
          <View style={{ flex: 1, minWidth: ROW.accessoryGap }} />
          {hint && !removable ? <Text style={{ ...NEW_TAB_BAR_TYPE.row, color: selected ? colors.selectedText : colors.secondary }}>{hint}</Text> : null}
          {switches ? (
            <View
              style={{
                width: ROW.arrow.box,
                height: ROW.arrow.box,
                marginLeft: ROW.accessoryGap,
                borderRadius: ROW.arrow.radius,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? colors.selectedBox : colors.accessoryFill,
              }}
            >
              <Symbol name="arrow.right" size={ROW.arrow.glyph} weight="semibold" color={selected ? accent : colors.accessoryInk} style={{ width: ROW.arrow.glyph + 3, height: ROW.arrow.glyph + 3 }} />
            </View>
          ) : null}
          {removable ? (
            <Button variant="icon" icon="xmark" size={SUGGESTION.remove.glyph} box={ROW.arrow.box} radius={ROW.arrow.radius} color={selected ? colors.selectedText : colors.secondary} tooltip="Remove from History" onPress={onRemove} />
          ) : null}
        </View>
      </Pressable>
    </View>
  );
},
(a, b) => a.selected === b.selected && a.trailing === b.trailing && a.actions === b.actions && a.colors === b.colors && a.accent === b.accent && sameSuggestion(a.suggestion, b.suggestion));
