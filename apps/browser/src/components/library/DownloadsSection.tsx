import { cancelDownload, pauseDownload, resumeDownload } from "@ardia/ardiacore";
import { ContextMenuArea, fileExists, fileThumbnail, MouseArea, openFile, revealFile } from "@ardia/shell";
import { memo, useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { downloadSession, downloadsIn, type StoredDownload } from "../../store/ui";
import { downloadMenu, downloadStatus, FileIcon } from "../Downloads";
import { hostLabel, matchesQuery } from "../pages/PageLayout";
import { IconButton, useHover } from "../primitives";
import { downloadMatches, fileKind, groupByDay, kindLabel, LIBRARY_ROW, type DownloadFilter } from "./groups";

const THUMB = 28;

export function LibraryGroupTitle({ title }: { title: string }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 12, fontWeight: "600", color: theme.textSecondary, paddingHorizontal: 8, paddingTop: 12, paddingBottom: 4 }}>{title}</Text>;
}

export function LibraryEmpty({ title }: { title: string }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 13, color: theme.textTertiary, paddingHorizontal: 8, paddingTop: 16 }}>{title}</Text>;
}

export function DownloadsSection({ windowId, query, filter, visible }: { windowId: string; query: string; filter: DownloadFilter; visible: boolean }) {
  const downloads = useBrowser(useShallow((s) => downloadsIn(s, windowId)));
  const groups = useMemo(() => {
    const shown = downloads.filter((d) => downloadMatches(filter, d.filename, d.mimeType) && matchesQuery(query, d.filename, d.url));
    return groupByDay(shown, (d) => d.seenAt);
  }, [downloads, filter, query]);
  if (!groups.length) return <LibraryEmpty title={downloads.length ? "No Matching Downloads" : "No Downloads"} />;
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
      {groups.map((group) => (
        <View key={group.label}>
          <LibraryGroupTitle title={group.label} />
          {group.items.map((d) => (
            <DownloadRow key={d.id} d={d} windowId={windowId} visible={visible} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const DownloadRow = memo(function DownloadRow({ d, windowId, visible }: { d: StoredDownload; windowId: string; visible: boolean }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const exists = d.state !== "finished" || fileExists(d.path);
  const done = d.state === "finished" && exists;
  const progress = d.total > 0 ? d.received / d.total : 0;
  const subtitle = done ? `${kindLabel(d.filename, d.mimeType)} from ${hostLabel(d.url)}` : downloadStatus(d, exists);
  return (
    <ContextMenuArea onContextMenu={() => void downloadMenu(d, windowId)}>
      <MouseArea path={done ? d.path : null}>
        <Pressable
          {...hoverProps}
          disabled={!done}
          onPress={() => void openFile(d.path)}
          style={{ height: LIBRARY_ROW, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, borderRadius: layout.rowRadius, backgroundColor: hovered ? theme.tabHover : undefined }}
        >
          <View style={{ width: THUMB, height: THUMB, alignItems: "center", justifyContent: "center", opacity: exists ? 1 : 0.45 }}>
            <DownloadThumb d={d} size={THUMB} visible={visible} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: "500", color: exists ? theme.textPrimary : theme.textSecondary, textDecorationLine: exists ? "none" : "line-through" }}>
              {d.filename || "Preparing…"}
            </Text>
            {d.state === "downloading" ? (
              <View style={{ height: 3, borderRadius: 1.5, marginVertical: 2, backgroundColor: theme.tabHover }}>
                <View style={{ width: `${Math.max(progress, 0.03) * 100}%`, height: 3, borderRadius: 1.5, backgroundColor: d.paused ? theme.textTertiary : theme.accent }} />
              </View>
            ) : null}
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.textSecondary }}>
              {subtitle}
            </Text>
          </View>
          {hovered && d.state === "downloading" ? (
            <>
              <IconButton icon={d.paused ? "play.circle" : "pause.circle"} size={14} box={24} radius={6} onPress={() => void (d.paused ? resumeDownload(d.id) : pauseDownload(d.id))} tooltip={d.paused ? "Resume" : "Pause"} />
              <IconButton icon="xmark.circle" size={14} box={24} radius={6} onPress={() => void cancelDownload(d.id)} tooltip="Cancel" />
            </>
          ) : hovered && done ? (
            <IconButton icon="magnifyingglass" size={13} box={24} radius={6} onPress={() => void revealFile(d.path)} tooltip="Show in Finder" />
          ) : null}
        </Pressable>
      </MouseArea>
    </ContextMenuArea>
  );
});

type Thumbnail = { key: string; uri: string | null };

export const DownloadThumb = memo(function DownloadThumb({ d, size, visible }: { d: StoredDownload; size: number; visible: boolean }) {
  const kind = fileKind(d.filename, d.mimeType);
  const media = d.state === "finished" && (kind === "image" || kind === "movie") && !!d.path && fileExists(d.path);
  const key = media ? [d.id, d.path, d.seenAt ?? "", size, d.profile ?? "", d.offTheRecord ? "otr" : "", downloadSession(d) ?? ""].join("\n") : null;
  const [thumbnail, setThumbnail] = useState<Thumbnail | null>(null);
  const known = !!key && thumbnail?.key === key;
  const uri = key && thumbnail?.key === key ? thumbnail.uri : null;
  useEffect(() => {
    if (!key || !visible || known) return;
    let current = true;
    fileThumbnail(d.path, size).then(
      (made) => current && setThumbnail({ key, uri: fileExists(d.path) ? made : null }),
      () => current && setThumbnail({ key, uri: null }),
    );
    return () => {
      current = false;
    };
  }, [key, visible, known]);
  if (uri) return <Image source={{ uri }} resizeMode="contain" style={{ width: size, height: size }} />;
  return <FileIcon path={d.path || d.filename} size={size} />;
});
