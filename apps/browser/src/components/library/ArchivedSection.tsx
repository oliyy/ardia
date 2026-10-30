import { memo, useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { copyText, showMenu } from "../../state/app/system";
import { plural } from "../../state/browser/model";
import { groupByDay, type ArchiveFilter } from "../../state/library/groups";
import { useArchivedRows } from "../../state/library/hooks";
import type { ArchivedRow } from "../../state/pins/archive";
import { restoreArchived } from "../../state/windows/actions";
import { Favicon } from "../favicon/Favicon";
import { hostLabel, matchesQuery } from "../pages/PageLayout";
import { Button, ContextMenuArea, layout, Symbol, useHover, useTheme, weight } from "../ui";
import { LibraryEmpty, LibraryGroupTitle } from "./DownloadsSection";
import { LIBRARY_ROW } from "./tokens";

const ICON = 16;

export function ArchivedSection({ windowId, query, filter }: { windowId: string; query: string; filter: ArchiveFilter }) {
  const rows = useArchivedRows(windowId);
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

const restore = (windowId: string, key: string) => restoreArchived(windowId, key);

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
          <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: weight.medium, color: theme.textPrimary }}>
            {row.title}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textSecondary }}>
            {group ? plural(row.count, "Tab") : hostLabel(row.url)}
          </Text>
        </View>
        <View pointerEvents={hovered ? "auto" : "none"} style={{ opacity: hovered ? 1 : 0 }}>
          <Button variant="icon" icon="arrow.uturn.backward" size={13} box={26} radius={6} onPress={() => restore(windowId, row.key)} tooltip="Restore" />
        </View>
      </View>
    </ContextMenuArea>
  );
});
