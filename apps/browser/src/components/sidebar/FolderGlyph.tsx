import { useMemo } from "react";
import { Image, type ImageRequireSource } from "react-native";
import { iconSymbol } from "../../lib/customIcon";
import { colorHex, colorHexAlpha, fromOklab, hexColor, oklab, resolveTheme } from "../../lib/profileLook";
import type { GroupColor } from "../../state/browser/types";
import { NO_GROUP_ICON } from "../../state/groups/groupIcons";
import { FolderShape, hex, ink, useTheme, withAlpha, type FolderShapeProps } from "../ui";
import { arcIconSource, isArcIcon } from "./arcFolderIcons";
import { groupTint } from "./tokens";

const SLOT = 16;
const BACK_LIGHTNESS = 0.7;

export type FolderColors = { front: string; frontExtendedSRGB?: [number, number, number]; back: string; stroke: string };

export function folderBack(front: string): string {
  if (!/^#[0-9a-f]{6}/i.test(front)) return front;
  const [, a, b] = oklab(hexColor(front));
  const [red, green, blue] = fromOklab([BACK_LIGHTNESS, a, b]);
  return colorHex({ r: red, g: green, b: blue, a: 1 });
}

function customMark(icon: string | null | undefined): FolderShapeProps["mark"] {
  if (!icon || icon === NO_GROUP_ICON) return null;
  if (isArcIcon(icon)) {
    const source = arcIconSource(icon);
    return source === undefined ? null : { kind: "image", uri: Image.resolveAssetSource(source).uri };
  }
  const symbol = iconSymbol(icon);
  if (symbol) return { kind: "symbol", name: symbol };
  return { kind: "emoji", text: icon };
}

export function useFolderColors(color: GroupColor | null): FolderColors {
  const theme = useTheme();
  const tint = groupTint(color);
  const front = tint ?? theme.powerUpPalette?.[0] ?? theme.icon;
  const frontExtendedSRGB = useMemo((): [number, number, number] | undefined => {
    const stop = !tint && theme.custom ? resolveTheme(theme.custom, theme.dark).stops[0]?.color : undefined;
    return stop && [stop.r, stop.g, stop.b];
  }, [tint, theme.custom, theme.dark]);
  const supplied = tint ? undefined : theme.custom?.foregroundSecondary;
  const back = supplied ? colorHexAlpha(theme.dark ? supplied.dark : supplied.light) : folderBack(front);
  const contrast = theme.custom?.maxContrastColor;
  const stroke = contrast ? colorHexAlpha(theme.dark ? contrast.dark : contrast.light) : theme.dark ? hex(withAlpha(ink.white, 0.9)) : theme.icon;
  return { front, frontExtendedSRGB, back, stroke };
}

export function FolderGlyph({
  colors,
  open = false,
  dots = false,
  icon = null,
  image,
}: {
  colors: FolderColors;
  open?: boolean;
  dots?: boolean;
  icon?: string | null;
  image?: ImageRequireSource;
}) {
  const { front, frontExtendedSRGB, back, stroke } = colors;
  const mark = useMemo(
    (): FolderShapeProps["mark"] =>
      customMark(icon) ?? (dots ? { kind: "dots" } : image !== undefined ? { kind: "image", uri: Image.resolveAssetSource(image).uri } : null),
    [dots, image, icon],
  );
  return <FolderShape front={front} frontExtendedSRGB={frontExtendedSRGB} back={back} stroke={stroke} open={open} mark={mark} pointerEvents="none" style={{ width: SLOT, height: SLOT }} />;
}
