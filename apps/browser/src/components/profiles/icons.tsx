import { Symbol, type MenuItem } from "@ardia/shell";
import { Image, Text, View, type ImageRequireSource } from "react-native";
import { profileAccent } from "../../lib/theme";
import type { Profile } from "../../store/types";

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

const SYMBOL_PREFIX = "symbol:";
const ARC_PREFIX = "arc:";
const ARC_ICON_SCALE = 7 / 6;
const ARC_ICONS = new Map<string, ImageRequireSource>([
  ["map", require("../../../assets/arc-space-icons/map.png")],
  ["fileTrayFull", require("../../../assets/arc-space-icons/file-tray-full.png")],
  ["musicalNote", require("../../../assets/arc-space-icons/musical-notes.png")],
  ["airplane", require("../../../assets/arc-space-icons/airplane.png")],
  ["book", require("../../../assets/arc-space-icons/book.png")],
]);
export const profileSymbol = (icon: string | null) => (icon?.startsWith(SYMBOL_PREFIX) ? icon.slice(SYMBOL_PREFIX.length) : null);
export const isArcIcon = (icon: string | null) => !!icon?.startsWith(ARC_PREFIX);
export const arcIconImage = (icon: string | null) => (icon?.startsWith(ARC_PREFIX) ? ARC_ICONS.get(icon.slice(ARC_PREFIX.length)) : undefined);
export const isEmojiIcon = (icon: string | null): icon is string => !!icon && !icon.startsWith(SYMBOL_PREFIX) && !icon.startsWith(ARC_PREFIX);
export const arcSpaceIcon = (space: { emoji?: string; icon?: string }): string | null => space.emoji || (space.icon ? ARC_PREFIX + space.icon : null);

export function iconMenuItems(current: string | null): MenuItem[] {
  return [
    { id: "icon:", title: "Initial", checked: !current },
    { separator: true },
    ...PROFILE_SYMBOLS.map((s) => ({ id: `icon:${SYMBOL_PREFIX}${s.name}`, title: s.title, symbol: s.name, checked: current === SYMBOL_PREFIX + s.name })),
    { separator: true },
    {
      id: "emoji",
      title: "Emoji",
      checked: isEmojiIcon(current),
      children: EMOJI.map((e) => ({ id: `icon:${e}`, title: e, checked: current === e })),
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
  const symbol = profileSymbol(profile.icon);
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
    <Text style={{ fontSize: emoji ? glyph * 1.1 : glyph * 0.92, fontWeight: "600", color }}>
      {emoji ?? (profile.name.trim()[0] ?? "?").toUpperCase()}
    </Text>
  );
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
        borderColor: "rgba(0,0,0,0.12)",
      }}
    >
      <ProfileGlyph profile={profile} glyph={size / 2} color="#FFFFFF" />
    </View>
  );
}
