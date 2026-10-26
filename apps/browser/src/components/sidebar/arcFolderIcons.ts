import type { ImageRequireSource } from "react-native";

export const ARC_ICON_PREFIX = "arc:";

export const ARC_FOLDER_ICONS: readonly { id: string; source: ImageRequireSource }[] = [
  { id: "airplane", source: require("../../../assets/arc-folder-icons/airplane.png") },
  { id: "book", source: require("../../../assets/arc-folder-icons/book.png") },
  { id: "bulb", source: require("../../../assets/arc-folder-icons/bulb.png") },
  { id: "chatBubbleEllipses", source: require("../../../assets/arc-folder-icons/chatbubble-ellipses.png") },
  { id: "code", source: require("../../../assets/arc-folder-icons/code.png") },
  { id: "construction", source: require("../../../assets/arc-folder-icons/construct.png") },
  { id: "fileTrayFull", source: require("../../../assets/arc-folder-icons/file-tray-full.png") },
  { id: "flash", source: require("../../../assets/arc-folder-icons/flash.png") },
  { id: "github", source: require("../../../assets/arc-folder-icons/logo-github.png") },
  { id: "map", source: require("../../../assets/arc-folder-icons/map.png") },
  { id: "musicalNote", source: require("../../../assets/arc-folder-icons/musical-notes.png") },
  { id: "planet", source: require("../../../assets/arc-folder-icons/planet.png") },
  { id: "shapes", source: require("../../../assets/arc-folder-icons/shapes.png") },
  { id: "skull", source: require("../../../assets/arc-folder-icons/skull.png") },
  { id: "star", source: require("../../../assets/arc-folder-icons/star.png") },
  { id: "triangle", source: require("../../../assets/arc-folder-icons/triangle.png") },
];

const SOURCES = new Map(ARC_FOLDER_ICONS.map((icon) => [icon.id, icon.source]));

export const isArcIcon = (icon: string | null | undefined): boolean => !!icon?.startsWith(ARC_ICON_PREFIX);

export const arcIconSource = (icon: string | null | undefined) => (icon?.startsWith(ARC_ICON_PREFIX) ? SOURCES.get(icon.slice(ARC_ICON_PREFIX.length)) : undefined);

export const arcIconWords = (id: string) => id.replace(/([A-Z])/g, " $1").toLowerCase();
