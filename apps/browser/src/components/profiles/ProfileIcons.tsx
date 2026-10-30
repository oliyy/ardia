import type { IconMenuItem } from "../../state/profiles/profileMenu";
import { Image, Text, View, type ImageRequireSource } from "react-native";
import { ink, Symbol, weight } from "../ui";
import { profileAccent } from "../ui/theme";
import type { Profile } from "../../state/browser/types";
import { profileColors, profileSwitcher } from "./tokens";
import { iconSymbol, symbolIcon } from "../../lib/customIcon";

export const PROFILE_SYMBOLS: { name: string; title: string }[] = [
  { name: "house.fill", title: "Home" },
  { name: "briefcase.fill", title: "Work" },
  { name: "graduationcap.fill", title: "School" },
  { name: "chevron.left.forwardslash.chevron.right", title: "Code" },
  { name: "paintpalette.fill", title: "Art" },
  { name: "hammer.fill", title: "Projects" },
  { name: "book.closed.fill", title: "Reading" },
  { name: "music.note", title: "Music" },
  { name: "camera.fill", title: "Photos" },
  { name: "gamecontroller.fill", title: "Games" },
  { name: "cart.fill", title: "Shopping" },
  { name: "banknote.fill", title: "Finance" },
  { name: "airplane", title: "Travel" },
  { name: "figure.run", title: "Fitness" },
  { name: "cup.and.saucer.fill", title: "Café" },
  { name: "leaf.fill", title: "Nature" },
  { name: "pawprint.fill", title: "Pets" },
  { name: "heart.fill", title: "Personal" },
  { name: "star.fill", title: "Favorites" },
  { name: "moon.stars.fill", title: "Evenings" },
];

const EMOJI = ["😀", "😎", "🤓", "🧑‍💻", "💼", "🏠", "🎓", "🎨", "🎮", "🎵", "📚", "✈️", "🌱", "🔥", "⭐️", "🚀", "🐶", "🐱", "🦊", "🍀"];

const ARC_PREFIX = "arc:";
const ARC_ICON_SCALE = 7 / 6;
const ARC_ICONS = new Map<string, ImageRequireSource>([
  ["map", require("../../../assets/arc-space-icons/map.png")],
  ["fileTrayFull", require("../../../assets/arc-space-icons/file-tray-full.png")],
  ["musicalNote", require("../../../assets/arc-space-icons/musical-notes.png")],
  ["airplane", require("../../../assets/arc-space-icons/airplane.png")],
  ["book", require("../../../assets/arc-space-icons/book.png")],
]);
export const isArcIcon = (icon: string | null) => !!icon?.startsWith(ARC_PREFIX);
export const arcIconImage = (icon: string | null) => (icon?.startsWith(ARC_PREFIX) ? ARC_ICONS.get(icon.slice(ARC_PREFIX.length)) : undefined);
export const isEmojiIcon = (icon: string | null): icon is string => !!icon && !iconSymbol(icon) && !icon.startsWith(ARC_PREFIX);

export function iconMenuItems(current: string | null, noneTitle = "Initial"): IconMenuItem[] {
  return [
    { value: { icon: null }, title: noneTitle, checked: !current },
    { separator: true },
    ...PROFILE_SYMBOLS.map((s) => ({ value: { icon: symbolIcon(s.name) }, title: s.title, symbol: s.name, checked: current === symbolIcon(s.name) })),
    { separator: true },
    {
      id: "emoji",
      title: "Emoji",
      checked: isEmojiIcon(current),
      children: EMOJI.map((e) => ({ value: { icon: e }, title: e, checked: current === e })),
    },
  ];
}

export function ProfileGlyph({
  profile,
  glyph,
  color,
  imageSize = glyph * ARC_ICON_SCALE,
  tints,
}: {
  profile: Pick<Profile, "name" | "icon">;
  glyph: number;
  color: string;
  imageSize?: number;
  tints?: readonly string[];
}) {
  const symbol = iconSymbol(profile.icon);
  const arcImage = arcIconImage(profile.icon);
  const emoji = isEmojiIcon(profile.icon) ? profile.icon : null;
  return symbol ? (
    <Symbol name={symbol} size={glyph} weight="semibold" color={color} style={{ width: glyph * 2, height: glyph * 2 }} />
  ) : arcImage && tints ? (
    <View pointerEvents="none" style={{ width: imageSize, height: imageSize }}>
      {tints.map((tint) => (
        <Image key={tint} source={arcImage} accessible={false} style={{ position: "absolute", left: 0, top: 0, width: imageSize, height: imageSize, tintColor: tint, opacity: tint === color ? 1 : 0 }} />
      ))}
    </View>
  ) : arcImage ? (
    <Image key={color} source={arcImage} style={{ width: imageSize, height: imageSize, tintColor: color }} />
  ) : (
    <Text style={{ fontSize: emoji ? glyph * 1.1 : glyph * 0.92, fontWeight: weight.semibold, color }}>
      {emoji ?? (profile.name.trim()[0] ?? "?").toUpperCase()}
    </Text>
  );
}

export const switcherCellWidth = (icon: string | null) => (icon ? profileSwitcher.iconCell : profileSwitcher.dotCell);

export function switcherIcons(icons: (string | null)[], shown: boolean, room: number): (string | null)[] {
  const fits = icons.reduce((width, icon) => width + switcherCellWidth(icon), 0) <= room;
  return shown && fits ? icons : icons.map(() => null);
}

export function SwitcherMark({ icon, color, scale = 1 }: { icon: string | null; color: string; scale?: number }) {
  const { iconCell, icon: size, dot } = profileSwitcher;
  const symbol = iconSymbol(icon);
  if (symbol) return <Symbol name={symbol} size={size * scale} weight="semibold" color={color} style={{ width: iconCell * scale, height: iconCell * scale }} />;
  if (icon)
    return (
      <Text numberOfLines={1} style={{ width: iconCell * scale, fontSize: size * scale, lineHeight: iconCell * scale, textAlign: "center", color }}>
        {icon}
      </Text>
    );
  return <View style={{ width: dot * scale, height: dot * scale, borderRadius: (dot / 2) * scale, backgroundColor: color }} />;
}

export function ProfileBadge({ profile, size = 26 }: { profile: Pick<Profile, "name" | "color" | "icon"> & Partial<Pick<Profile, "theme">>; size?: number }) {
  const swatch = profileAccent(profile);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: swatch,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: size >= 22 ? 0.5 : 0,
        borderColor: profileColors.badgeEdge,
      }}
    >
      <ProfileGlyph profile={profile} glyph={size / 2} color={ink.white} />
    </View>
  );
}
