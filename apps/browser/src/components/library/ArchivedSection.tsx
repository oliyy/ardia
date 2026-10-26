import { ContextMenuArea, copyText, showMenu, Symbol } from "@ardia/shell";
import { memo, useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { layout, useTheme } from "../../lib/theme";
import { archivedEntries, type ArchivedRow } from "../../store/archive";
import { useBrowser } from "../../store/browser";
import { plural } from "../../store/model";
import { hostLabel, matchesQuery } from "../pages/PageLayout";
import { Favicon, IconButton, useHover } from "../primitives";
import { LibraryEmpty, LibraryGroupTitle } from "./DownloadsSection";
import { groupByDay, LIBRARY_ROW, type ArchiveFilter } from "./groups";

const ICON = 16;

export function ArchivedSection({ windowId, query, filter }: { windowId: string; query: string; filter: ArchiveFilter }) {
  const inputs = useBrowser(
    useShallow((s) => ({
      windows: s.windows,
      tabs: s.tabs,
      parkedPins: s.parkedPins,
      closedTabs: s.closedTabs,
      closedGroups: s.closedGroups,
      cleanedTabs: s.cleanedTabs,
      privateCleanedTabs: s.privateCleanedTabs,
    })),
  );
  const rows = useMemo(() => archivedEntries(inputs, windowId), [inputs, windowId]);
  const groups = useMemo(() => {
    const shown = rows.filter((r) => (filter === "all" || r.source === filter) && matchesQuery(query, r.title, r.url));
    return groupByDay(shown, (r) => r.closedAt);
  }, [rows, filter, query]);
  if (!groups.length) return <LibraryEmpty title={rows.length ? "No Matching Tabs" : "No Archived Tabs"} />;
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
      {groups.map((group) => (
        <View key={group.label}>
          <LibraryGroupTitle title={group.label} />
          {group.items.map((row) => (
            <ArchivedRowItem key={row.key} row={row} windowId={windowId} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const restore = (windowId: string, key: string) => useBrowser.getState().restoreArchived(windowId, key);

async function archivedMenu(windowId: string, row: ArchivedRow) {
  const choice = await showMenu([{ id: "restore", title: "Restore" }, ...(row.source !== "closedGroup" && row.url ? [{ id: "copy", title: "Copy Link" }] : [])]);
  if (choice === "restore") restore(windowId, row.key);
  if (choice === "copy") copyText(row.url);
}

const ArchivedRowItem = memo(function ArchivedRowItem({ row, windowId }: { row: ArchivedRow; windowId: string }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const group = row.source === "closedGroup";
  return (
    <ContextMenuArea onContextMenu={() => void archivedMenu(windowId, row)}>
      <View
        {...hoverProps}
        style={{ height: LIBRARY_ROW, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 8, paddingRight: 4, borderRadius: layout.rowRadius, backgroundColor: hovered ? theme.tabHover : undefined }}
      >
        <View style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
          {group ? (
            <Symbol name="folder" size={ICON} color={theme.icon} style={{ width: ICON + 2, height: ICON + 2 }} />
          ) : (
            <Favicon url={row.url} favicon={row.favicon} size={ICON} profileId={row.profileId} />
          )}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: "500", color: theme.textPrimary }}>
            {row.title}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textSecondary }}>
            {group ? plural(row.count, "Tab") : hostLabel(row.url)}
          </Text>
        </View>
        <View pointerEvents={hovered ? "auto" : "none"} style={{ opacity: hovered ? 1 : 0 }}>
          <IconButton icon="arrow.uturn.backward" size={13} box={26} radius={6} onPress={() => restore(windowId, row.key)} tooltip="Restore" />
        </View>
      </View>
    </ContextMenuArea>
  );
});
