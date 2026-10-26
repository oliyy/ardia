import { ContextMenuArea, showMenu, Symbol, WindowDragRegion } from "@ardia/shell";
import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { SIDEBAR_FIELD, SIDEBAR_FOOTER_BUTTON } from "../layout/windowLayout";
import { IconButton, useHover } from "../primitives";
import { useSidebarTokens } from "../sidebar/tokens";
import { ArchivedSection } from "./ArchivedSection";
import { DownloadsSection } from "./DownloadsSection";
import { ARCHIVE_FILTERS, DOWNLOAD_FILTERS } from "./groups";
import { closeLibrary, updateLibrary, useLibraryView, type LibrarySection } from "./store";

const TILE_HEIGHT = 76;
const TILE_GAP = 24;
const FIELD_HEIGHT = 34;

const SECTIONS: { id: LibrarySection; title: string; icon: string; placeholder: string }[] = [
  { id: "downloads", title: "Downloads", icon: "arrow.down.circle", placeholder: "Search Downloads…" },
  { id: "archived", title: "Archived Tabs", icon: "archivebox", placeholder: "Search Archived Tabs…" },
];

const railWidth = (width: number) => Math.round(Math.min(120, Math.max(86, width * 0.3)));

export function LibraryPanel({ windowId, width }: { windowId: string; width: number }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const view = useLibraryView(windowId);
  const field = useRef<TextInput>(null);
  const section = view?.section;
  useEffect(() => {
    if (section) field.current?.focus();
  }, [section]);
  if (!view) return null;
  const rail = railWidth(width);
  const current = SECTIONS.find((s) => s.id === view.section)!;
  const filtered = view.section === "downloads" ? view.downloadFilter !== "all" : view.archiveFilter !== "all";
  const chooseFilter = async () => {
    const items =
      view.section === "downloads"
        ? DOWNLOAD_FILTERS.map((f) => ({ id: f.id, title: f.title, checked: view.downloadFilter === f.id }))
        : ARCHIVE_FILTERS.map((f) => ({ id: f.id, title: f.title, checked: view.archiveFilter === f.id }));
    const asked = view.section;
    const choice = await showMenu(items);
    const downloads = DOWNLOAD_FILTERS.find((f) => f.id === choice);
    const archived = ARCHIVE_FILTERS.find((f) => f.id === choice);
    updateLibrary(windowId, (v) => {
      if (v.section !== asked) return {};
      if (asked === "downloads" && downloads) return { downloadFilter: downloads.id };
      if (asked === "archived" && archived) return { archiveFilter: archived.id };
      return {};
    });
  };
  return (
    <View style={[StyleSheet.absoluteFill, { flexDirection: "row" }]}>
      <WindowDragRegion style={{ position: "absolute", left: 0, right: 0, top: 0, height: SIDEBAR_FIELD.top }} />
      <View style={{ width: rail }}>
        <View style={{ flex: 1, justifyContent: "center", gap: TILE_GAP, paddingHorizontal: 8 }}>
          {SECTIONS.map((s) => (
            <RailTile
              key={s.id}
              title={s.title}
              icon={s.icon}
              selected={view.section === s.id}
              fill={tokens.fieldFill}
              onPress={() => updateLibrary(windowId, () => ({ section: s.id }))}
              onContextMenu={s.id === "archived" ? () => void archiveMenu(windowId) : undefined}
            />
          ))}
        </View>
        <View style={{ position: "absolute", left: layout.sidebarInset, bottom: SIDEBAR_FOOTER_BUTTON.bottom }}>
          <IconButton icon="arrow.left" size={16} weight="medium" color={theme.textSecondary} box={SIDEBAR_FOOTER_BUTTON.size} radius={10} tooltip="Back" onPress={() => closeLibrary(windowId)} />
        </View>
      </View>
      <View style={{ flex: 1, paddingRight: layout.sidebarInset }}>
        <View style={{ height: SIDEBAR_FIELD.top, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ flex: 1, height: FIELD_HEIGHT, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderRadius: SIDEBAR_FIELD.radius, backgroundColor: tokens.fieldFill }}>
            <Symbol name="magnifyingglass" size={13} weight="medium" color={theme.textSecondary} style={{ width: 16, height: 16 }} />
            <TextInput
              ref={field}
              value={view.query[view.section]}
              onChangeText={(text) => updateLibrary(windowId, (v) => ({ query: { ...v.query, [v.section]: text } }))}
              placeholder={current.placeholder}
              placeholderTextColor={theme.placeholder}
              selectionColor={theme.selection}
              enableFocusRing={false}
              keyDownEvents={[{ key: "Escape" }]}
              onKeyDown={(e) => e.nativeEvent.key === "Escape" && closeLibrary(windowId)}
              style={{ flex: 1, fontSize: 14, color: theme.textPrimary, paddingVertical: 0 }}
            />
          </View>
          <Pressable
            onPress={() => void chooseFilter()}
            style={{ height: FIELD_HEIGHT, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, borderRadius: SIDEBAR_FIELD.radius, backgroundColor: tokens.fieldFill }}
          >
            <Symbol name={filtered ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"} size={14} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
            <Text style={{ fontSize: 14, color: theme.textPrimary }}>Filter</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1, display: view.section === "downloads" ? "flex" : "none" }}>
          <DownloadsSection windowId={windowId} query={view.query.downloads} filter={view.downloadFilter} visible={view.section === "downloads"} />
        </View>
        <View style={{ flex: 1, display: view.section === "archived" ? "flex" : "none" }}>
          <ArchivedSection windowId={windowId} query={view.query.archived} filter={view.archiveFilter} />
        </View>
      </View>
    </View>
  );
}

async function archiveMenu(windowId: string) {
  const choice = await showMenu([{ id: "clear", title: "Clear Archive" }]);
  if (choice === "clear") useBrowser.getState().clearArchive(windowId);
}

function RailTile({ title, icon, selected, fill, onPress, onContextMenu }: { title: string; icon: string; selected: boolean; fill: string; onPress: () => void; onContextMenu?: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <ContextMenuArea onContextMenu={onContextMenu}>
      <Pressable
        {...hoverProps}
        onPress={onPress}
        style={{ height: TILE_HEIGHT, alignItems: "center", justifyContent: "center", gap: 6, borderRadius: layout.rowRadius, backgroundColor: selected ? fill : hovered ? theme.tabHover : undefined }}
      >
        <Symbol name={icon} size={20} weight="medium" color={selected ? theme.textPrimary : theme.textSecondary} style={{ width: 24, height: 24 }} />
        <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: selected ? theme.textPrimary : theme.textSecondary }}>
          {title}
        </Text>
      </Pressable>
    </ContextMenuArea>
  );
}
