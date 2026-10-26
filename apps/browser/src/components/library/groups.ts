export type DateGroup<T> = { label: string; items: T[] };

export const LIBRARY_ROW = 50;

const DAY_MS = 86_400_000;
const EARLIER = "Earlier";

const startOfDay = (at: number) => {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

export function dayLabel(at: number | undefined, now = Date.now()): string {
  if (at === undefined || !Number.isFinite(at)) return EARLIER;
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return count(days, "day");
  if (days < 30) return count(Math.floor(days / 7), "week");
  if (days < 365) return count(Math.max(1, Math.floor(days / 30)), "month");
  return count(Math.floor(days / 365), "year");
}

export function groupByDay<T>(items: T[], at: (item: T) => number | undefined, now = Date.now()): DateGroup<T>[] {
  const groups: DateGroup<T>[] = [];
  const byLabel = new Map<string, DateGroup<T>>();
  let earlier: DateGroup<T> | null = null;
  for (const item of items) {
    const label = dayLabel(at(item), now);
    if (label === EARLIER) {
      (earlier ??= { label, items: [] }).items.push(item);
      continue;
    }
    let group = byLabel.get(label);
    if (!group) {
      group = { label, items: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return earlier ? [...groups, earlier] : groups;
}

export type FileKind = "image" | "movie" | "audio" | "archive" | "diskImage" | "document" | "other";

const EXTENSIONS: Record<string, FileKind> = {
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", heic: "image", heif: "image", bmp: "image", tif: "image", tiff: "image", svg: "image", avif: "image",
  mp4: "movie", mov: "movie", m4v: "movie", webm: "movie", mkv: "movie", avi: "movie",
  mp3: "audio", m4a: "audio", wav: "audio", aac: "audio", flac: "audio", ogg: "audio", opus: "audio",
  zip: "archive", gz: "archive", tgz: "archive", tar: "archive", bz2: "archive", xz: "archive", "7z": "archive", rar: "archive",
  dmg: "diskImage", iso: "diskImage",
  pdf: "document", txt: "document", md: "document", rtf: "document", doc: "document", docx: "document", pages: "document", csv: "document", xls: "document", xlsx: "document", numbers: "document", ppt: "document", pptx: "document", key: "document", json: "document",
};

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export function fileKind(filename: string, mimeType = ""): FileKind {
  const known = EXTENSIONS[extensionOf(filename)];
  if (known) return known;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "movie";
  if (mimeType.startsWith("audio/")) return "audio";
  return "other";
}

const KIND_LABELS: Record<FileKind, (ext: string) => string> = {
  image: () => "Image",
  movie: () => "Movie",
  audio: () => "Audio",
  archive: (ext) => (ext === "zip" ? "Zip Archive" : "Archive"),
  diskImage: () => "Disk Image",
  document: (ext) => (ext === "pdf" ? "PDF Document" : "Download"),
  other: () => "Download",
};

export const kindLabel = (filename: string, mimeType = "") => KIND_LABELS[fileKind(filename, mimeType)](extensionOf(filename));

export const DOWNLOAD_FILTERS = [
  { id: "all", title: "All Downloads" },
  { id: "image", title: "Images" },
  { id: "movie", title: "Movies" },
  { id: "audio", title: "Audio" },
  { id: "document", title: "Documents" },
  { id: "archive", title: "Archives & Disk Images" },
  { id: "other", title: "Other" },
] as const;

export type DownloadFilter = (typeof DOWNLOAD_FILTERS)[number]["id"];

export function downloadMatches(filter: DownloadFilter, filename: string, mimeType = ""): boolean {
  if (filter === "all") return true;
  const kind = fileKind(filename, mimeType);
  return filter === "archive" ? kind === "archive" || kind === "diskImage" : kind === filter;
}

export const ARCHIVE_FILTERS = [
  { id: "all", title: "All Archived Tabs" },
  { id: "closedTab", title: "Closed Tabs" },
  { id: "closedGroup", title: "Closed Groups" },
  { id: "cleaned", title: "Auto-Archived" },
] as const;

export type ArchiveFilter = (typeof ARCHIVE_FILTERS)[number]["id"];
