import type { ImageRequireSource } from "react-native";
import type { ArcFolderIconId } from "../../state/groups/iconChoices";
import { ARC_ICON_PREFIX } from "../../lib/customIcon";

const SOURCE_TABLE: Record<ArcFolderIconId, ImageRequireSource> = {
  airplane: require("../../../assets/arc-folder-icons/airplane.png"),
  book: require("../../../assets/arc-folder-icons/book.png"),
  bulb: require("../../../assets/arc-folder-icons/bulb.png"),
  chatBubbleEllipses: require("../../../assets/arc-folder-icons/chatbubble-ellipses.png"),
  code: require("../../../assets/arc-folder-icons/code.png"),
  construction: require("../../../assets/arc-folder-icons/construct.png"),
  fileTrayFull: require("../../../assets/arc-folder-icons/file-tray-full.png"),
  flash: require("../../../assets/arc-folder-icons/flash.png"),
  github: require("../../../assets/arc-folder-icons/logo-github.png"),
  map: require("../../../assets/arc-folder-icons/map.png"),
  musicalNote: require("../../../assets/arc-folder-icons/musical-notes.png"),
  planet: require("../../../assets/arc-folder-icons/planet.png"),
  shapes: require("../../../assets/arc-folder-icons/shapes.png"),
  skull: require("../../../assets/arc-folder-icons/skull.png"),
  star: require("../../../assets/arc-folder-icons/star.png"),
  triangle: require("../../../assets/arc-folder-icons/triangle.png"),
};

const SOURCES = new Map<string, ImageRequireSource>(Object.entries(SOURCE_TABLE));

export const isArcIcon = (icon: string | null | undefined): boolean => !!icon?.startsWith(ARC_ICON_PREFIX);

export const arcIconSource = (icon: string | null | undefined) => (icon?.startsWith(ARC_ICON_PREFIX) ? SOURCES.get(icon.slice(ARC_ICON_PREFIX.length)) : undefined);
