import { FolderShape, type FolderShapeProps } from "@ardia/shell";
import { useMemo } from "react";
import { Image, type ImageRequireSource } from "react-native";
import { colorHex, colorHexAlpha, fromOklab, hexColor, oklab, resolveTheme } from "../../lib/profileTheme";
import { useTheme } from "../../lib/theme";
import type { GroupColor } from "../../store/types";
import { SYMBOL_PREFIX } from "./TabIcon";
import { GROUP_COLORS } from "./tokens";

const SLOT = 16;
const BACK_LIGHTNESS = 0.7;

export type FolderColors = { front: string; frontExtendedSRGB?: [number, number, number]; back: string; stroke: string };

export function folderBack(front: string): string {
  if (!/^#[0-9a-f]{6}/i.test(front)) return front;
  const [, a, b] = oklab(hexColor(front));
  const [red, green, blue] = fromOklab([BACK_LIGHTNESS, a, b]);
  return colorHex({ r: red, g: green, b: blue, a: 1 });
}

export const folderSymbol = (icon: string | null | undefined) => (icon?.startsWith(SYMBOL_PREFIX) ? icon.slice(SYMBOL_PREFIX.length) : null);

export function useFolderColors(color: GroupColor | null): FolderColors {
  const theme = useTheme();
  const front = color ? GROUP_COLORS[color].hex : (theme.powerUpPalette?.[0] ?? theme.icon);
  const frontExtendedSRGB = useMemo((): [number, number, number] | undefined => {
    const stop = !color && theme.custom ? resolveTheme(theme.custom, theme.dark).stops[0]?.color : undefined;
    return stop && [stop.r, stop.g, stop.b];
  }, [color, theme.custom, theme.dark]);
  const supplied = color ? undefined : theme.custom?.foregroundSecondary;
  const back = supplied ? colorHexAlpha(theme.dark ? supplied.dark : supplied.light) : folderBack(front);
  const contrast = theme.custom?.maxContrastColor;
  const stroke = contrast ? colorHexAlpha(theme.dark ? contrast.dark : contrast.light) : theme.dark ? "#FFFFFFE6" : theme.icon;
  return { front, frontExtendedSRGB, back, stroke };
}

export function FolderGlyph({
  colors,
  open = false,
  dots = false,
  symbol = null,
  image,
}: {
  colors: FolderColors;
  open?: boolean;
  dots?: boolean;
  symbol?: string | null;
  image?: ImageRequireSource;
}) {
  const { front, frontExtendedSRGB, back, stroke } = colors;
  const mark = useMemo(
    (): FolderShapeProps["mark"] => (dots ? { kind: "dots" } : image !== undefined ? { kind: "image", uri: Image.resolveAssetSource(image).uri } : symbol ? { kind: "symbol", name: symbol } : null),
    [dots, image, symbol],
  );
  return <FolderShape front={front} frontExtendedSRGB={frontExtendedSRGB} back={back} stroke={stroke} open={open} mark={mark} pointerEvents="none" style={{ width: SLOT, height: SLOT }} />;
}
