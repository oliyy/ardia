import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { font, Panel, radius, Symbol } from "../ui";
import { useTheme } from "../ui/theme";
import { useLive } from "../../state/live/store";
import { setIcon } from "../../state/sidebar/actions";
import { setSidebarUi, useSidebarUi } from "../../state/sidebar/sidebarUi";
import { useIconPickerCurrent } from "../../state/sidebar/hooks";
import { NO_GROUP_ICON } from "../../state/groups/groupIcons";
import { arcIconWords, ARC_FOLDER_ICON_IDS, EMOJI_CHOICES, SYMBOL_CHOICES } from "../../state/groups/iconChoices";
import { arcIcon, iconSymbol, symbolIcon } from "../../lib/customIcon";
import { SIDEBAR_SHADOW, SIDEBAR_TYPE, useSidebarTokens } from "./tokens";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { arcIconSource, isArcIcon } from "./arcFolderIcons";

const COLUMNS = 8;
const CELL = 30;
const WIDTH = COLUMNS * CELL + 16;

export function IconPicker({ windowId, sidebarWidth }: { windowId: string; sidebarWidth: number }) {
  const picker = useSidebarUi((u) => (u.iconPicker?.windowId === windowId ? u.iconPicker : null));
  return picker ? <PickerPanel key={picker.id} picker={picker} sidebarWidth={sidebarWidth} /> : null;
}

type Picker = NonNullable<ReturnType<typeof useSidebarUi.getState>["iconPicker"]>;

function PickerPanel({ picker, sidebarWidth }: { picker: Picker; sidebarWidth: number }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const liveIcon = useLive((s) => (picker.kind === "live" ? s.folders[picker.id.split("|")[1] ?? ""]?.icon : null));
  const current = useIconPickerCurrent(picker.kind, picker.id, liveIcon);
  const arcLayout = useAddressBarInSidebar();
  const arcFolder = picker.kind !== "tab" && picker.kind !== "folder" && arcLayout;
  const emojiCurrent = !!current && !iconSymbol(current) && !isArcIcon(current);
  const [tab, setTab] = useState<"emoji" | "symbols">(emojiCurrent || (!arcFolder && !current) ? "emoji" : "symbols");
  const [query, setQuery] = useState("");
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (tab === "emoji") return EMOJI_CHOICES.filter(([, words]) => !q || words.includes(q)).map(([e]) => e);
    if (arcFolder) return ARC_FOLDER_ICON_IDS.filter((id) => !q || arcIconWords(id).includes(q)).map(arcIcon);
    return SYMBOL_CHOICES.filter((name) => !q || name.includes(q)).map(symbolIcon);
  }, [tab, query, arcFolder]);
  const close = () => setSidebarUi({ iconPicker: null });
  const choose = (icon: string | null) => {
    setIcon(picker, icon);
    close();
  };
  const top = Math.max(8, (picker.anchor?.y ?? 60) - 8);
  const left = picker.anchor ? Math.max(8, Math.min(sidebarWidth + 6, picker.anchor.x + picker.anchor.width + 6)) : sidebarWidth + 6;

  return (
    <>
      <Pressable onPress={close} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      <Panel
        fill={theme.panel}
        radius={radius.sheet}
        border={theme.panelBorder}
        shadow={SIDEBAR_SHADOW.iconPicker}
        style={{ position: "absolute", top, left, width: WIDTH, padding: 8, gap: 8 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ flex: 1, height: 26, borderRadius: radius.l, backgroundColor: theme.urlPill, flexDirection: "row", alignItems: "center", paddingHorizontal: 7 }}>
            <Symbol name="magnifyingglass" size={11} color={theme.textSecondary} style={{ width: 14, height: 14 }} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder={tab === "emoji" ? "Search emoji" : "Search icons"}
              placeholderTextColor={theme.placeholder}
              enableFocusRing={false}
              keyDownEvents={[{ key: "Escape" }]}
              onKeyDown={(e) => e.nativeEvent.key === "Escape" && close()}
              onSubmitEditing={() => items[0] && choose(items[0])}
              style={{ flex: 1, ...font.small, marginLeft: 5, color: theme.textPrimary, paddingVertical: 0 }}
            />
          </View>
          {(["emoji", "symbols"] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)}>
              <View style={{ width: 28, height: 26, borderRadius: radius.l, alignItems: "center", justifyContent: "center", backgroundColor: tab === t ? tokens.pickerCellHover : undefined }}>
                <Symbol name={t === "emoji" ? "face.smiling" : "star.square.on.square"} size={13} color={theme.icon} style={{ width: 16, height: 16 }} />
              </View>
            </Pressable>
          ))}
        </View>
        <ScrollView style={{ maxHeight: CELL * 6 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {items.map((icon) => (
              <Cell key={icon} icon={icon} selected={icon === current} onPress={() => choose(icon)} />
            ))}
            {items.length === 0 ? <Text style={{ padding: 8, ...font.small, color: theme.textTertiary }}>No matches</Text> : null}
          </View>
        </ScrollView>
        {(picker.kind === "group" && !arcFolder) || current ? (
          <View style={{ flexDirection: "row", gap: 6 }}>
            {picker.kind === "group" && !arcFolder ? (
              <FooterButton label="No Icon" selected={current === NO_GROUP_ICON} onPress={() => choose(NO_GROUP_ICON)}>
                <Symbol name="square.stack.fill" size={11} weight="medium" color={tokens.noGroupIcon} style={{ width: 14, height: 14 }} />
              </FooterButton>
            ) : null}
            {current ? <FooterButton label="Reset Icon" selected={false} onPress={() => choose(null)} /> : null}
          </View>
        ) : null}
      </Panel>
    </>
  );
}

function FooterButton({ label, selected, onPress, children }: { label: string; selected: boolean; onPress(): void; children?: React.ReactNode }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} style={{ flex: 1 }}>
      {({ pressed }) => (
        <View
          style={{
            height: 26,
            borderRadius: radius.l,
            flexDirection: "row",
            gap: 5,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed || selected ? tokens.pickerCellHover : theme.urlPill,
          }}
        >
          {children}
          <Text style={{ ...font.small, color: theme.textPrimary }}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

function Cell({ icon, selected, onPress }: { icon: string; selected: boolean; onPress(): void }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const [hovered, setHovered] = useState(false);
  const symbol = iconSymbol(icon);
  const arcSource = arcIconSource(icon);
  return (
    <Pressable onPress={onPress}>
      <View
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: CELL,
          height: CELL,
          borderRadius: radius.l,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: hovered || selected ? tokens.pickerCellHover : undefined,
        }}
      >
        {symbol ? (
          <Symbol name={symbol} size={15} color={theme.icon} style={{ width: 20, height: 20 }} />
        ) : arcSource !== undefined ? (
          <Image key={theme.icon} source={arcSource} accessible={false} style={{ width: 15, height: 15, tintColor: theme.icon }} />
        ) : (
          <Text style={{ fontSize: SIDEBAR_TYPE.emoji }}>{icon}</Text>
        )}
      </View>
    </Pressable>
  );
}
