import { arcIcon, iconSymbol, symbolIcon } from "../../lib/customIcon";
import { NO_GROUP_ICON } from "./groupIcons";

export const EMOJI_CHOICES: readonly (readonly [string, string])[] = [
  ["⭐️", "star favorite"], ["🔥", "fire hot"], ["❤️", "heart love"], ["✅", "check done"], ["📌", "pin"], ["🚀", "rocket launch ship"],
  ["💡", "idea bulb"], ["📝", "note memo write"], ["📚", "books read study"], ["📖", "book read"], ["🎓", "school graduate"], ["💼", "work briefcase"],
  ["🏠", "home house"], ["🛒", "shopping cart"], ["💰", "money"], ["💳", "card pay"], ["📈", "chart growth stocks"], ["📊", "chart data"],
  ["🗓️", "calendar date"], ["⏰", "alarm time"], ["📧", "email mail"], ["💬", "chat message"], ["📞", "phone call"], ["🎥", "video camera"],
  ["🎵", "music song"], ["🎧", "headphones music"], ["🎮", "game play"], ["🎨", "art design paint"], ["📷", "photo camera"], ["🎬", "movie film"],
  ["📺", "tv watch"], ["🍿", "popcorn movie"], ["✈️", "travel plane"], ["🗺️", "map travel"], ["🏖️", "beach holiday"], ["🌍", "world earth globe"],
  ["🍕", "pizza food"], ["🍔", "burger food"], ["☕️", "coffee"], ["🍷", "wine"], ["🍎", "apple fruit"], ["🥗", "salad food healthy"],
  ["🏋️", "gym fitness"], ["⚽️", "football soccer sport"], ["🏀", "basketball sport"], ["🚴", "bike cycling"], ["🧘", "yoga calm"], ["💊", "health pill"],
  ["🐶", "dog pet"], ["🐱", "cat pet"], ["🦊", "fox"], ["🐼", "panda"], ["🦄", "unicorn"], ["🐙", "octopus github"],
  ["🌱", "plant grow"], ["🌸", "flower blossom"], ["🌈", "rainbow"], ["☀️", "sun"], ["🌙", "moon night"], ["❄️", "snow cold"],
  ["⚡️", "lightning fast"], ["💎", "gem diamond"], ["🎁", "gift present"], ["🎉", "party celebrate"], ["🏆", "trophy win"], ["🎯", "target goal"],
  ["🧠", "brain think"], ["👀", "eyes look"], ["🤖", "robot ai bot"], ["👾", "alien game"], ["💻", "laptop computer code"], ["🖥️", "desktop computer"],
  ["⌨️", "keyboard type"], ["🛠️", "tools build"], ["⚙️", "settings gear"], ["🔧", "wrench fix"], ["🧪", "test lab science"], ["🔬", "science research"],
  ["🐛", "bug"], ["🔒", "lock secure"], ["🔑", "key"], ["🧩", "puzzle extension"], ["📦", "package box"], ["🗂️", "folder files"],
  ["📁", "folder"], ["🗃️", "archive"], ["📰", "news paper"], ["🔗", "link"], ["🔍", "search find"], ["🧭", "compass explore"],
  ["🏷️", "tag label"], ["💭", "thought"], ["❓", "question"], ["❗️", "important"], ["⚠️", "warning"], ["🚧", "construction wip"],
  ["🟥", "red square"], ["🟧", "orange square"], ["🟨", "yellow square"], ["🟩", "green square"], ["🟦", "blue square"], ["🟪", "purple square"],
  ["🔴", "red circle"], ["🟠", "orange circle"], ["🟡", "yellow circle"], ["🟢", "green circle"], ["🔵", "blue circle"], ["🟣", "purple circle"],
];

export const SYMBOL_CHOICES: readonly string[] = [
  "star", "heart", "bookmark", "flag", "pin", "bolt", "flame", "leaf", "globe", "house", "briefcase", "cart", "bag", "creditcard",
  "dollarsign.circle", "chart.bar", "chart.line.uptrend.xyaxis", "calendar", "clock", "alarm", "envelope", "bubble.left", "phone", "video",
  "music.note", "headphones", "gamecontroller", "paintbrush", "camera", "film", "tv", "airplane", "map", "car", "fork.knife", "cup.and.saucer",
  "figure.run", "sportscourt", "pawprint", "tree", "sun.max", "moon", "cloud", "snowflake", "sparkles", "gift", "trophy", "target", "brain",
  "eye", "laptopcomputer", "desktopcomputer", "keyboard", "hammer", "wrench.and.screwdriver", "gearshape", "testtube.2", "ant", "lock",
  "key", "puzzlepiece", "shippingbox", "folder", "archivebox", "newspaper", "link", "magnifyingglass", "safari", "tag", "lightbulb",
  "questionmark.circle", "exclamationmark.triangle", "book", "graduationcap", "doc.text", "list.bullet", "checkmark.circle", "person.2",
];

export const ARC_FOLDER_ICON_IDS = [
  "airplane",
  "book",
  "bulb",
  "chatBubbleEllipses",
  "code",
  "construction",
  "fileTrayFull",
  "flash",
  "github",
  "map",
  "musicalNote",
  "planet",
  "shapes",
  "skull",
  "star",
  "triangle",
] as const;

export type ArcFolderIconId = (typeof ARC_FOLDER_ICON_IDS)[number];

export const arcIconWords = (id: string) => id.replace(/([A-Z])/g, " $1").toLowerCase();

const ONE_EMOJI =
  /^(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0F\u{E0020}-\u{E007F}]*\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?)*)$/u;

const ARC_ICONS = new Set<string>(ARC_FOLDER_ICON_IDS.map(arcIcon));

export const isFolderIcon = (icon: string) =>
  icon === NO_GROUP_ICON || ARC_ICONS.has(icon) || (!!iconSymbol(icon) && SYMBOL_CHOICES.includes(iconSymbol(icon)!)) || ONE_EMOJI.test(icon);

export function folderIconChoices(query: string) {
  const q = query.trim().toLowerCase();
  return {
    emoji: EMOJI_CHOICES.filter(([, words]) => !q || words.includes(q)).map(([icon, words]) => ({ icon, words })),
    arc: ARC_FOLDER_ICON_IDS.filter((id) => !q || arcIconWords(id).includes(q)).map(arcIcon),
    symbols: SYMBOL_CHOICES.filter((name) => !q || name.includes(q)).map(symbolIcon),
  };
}
