import { memo } from "react";
import { Image, Text, View } from "react-native";
import { useIsSleeping } from "../../state/tabs/tabLifecycle";
import { Symbol } from "../ui";
import { useTheme } from "../ui/theme";
import { sidebarTokens } from "./tokens";
import { useTab } from "../../state/browser/hooks";
import { ENGINE_NAMES, ENGINE_SYMBOLS, type PageEngine } from "../../state/engines/engines";
import { FADED, markedEngine, useIconMarks } from "../../state/sidebar/rowState";
import { NO_GROUP_ICON } from "../../state/groups/groupIcons";
import { iconSymbol } from "../../lib/customIcon";
import { Favicon, type FaviconSourceListener } from "../favicon/Favicon";
import { arcIconSource, isArcIcon } from "./arcFolderIcons";

export const TabIcon = memo(function TabIcon({
  tabId,
  url,
  favicon,
  icon,
  size = 16,
  color,
  profileId: profile,
  direct,
  onSource,
  marks: givenMarks,
}: {
  tabId?: string;
  url: string;
  favicon?: string | null;
  icon?: string | null;
  size?: number;
  color?: string;
  profileId?: string;
  direct?: boolean;
  onSource?: FaviconSourceListener;
  marks?: number;
}) {
  const sleeping = useIsSleeping(tabId ?? "");
  const marks = useIconMarks(tabId, givenMarks);
  const engine = tabId && size >= 14 ? markedEngine(marks) : null;
  const props = { url, favicon, icon, size, color, direct, onSource };
  return (
    <View style={{ opacity: sleeping || marks & FADED ? SLEEPING_OPACITY : 1 }}>
      {profile || !tabId ? <Icon {...props} profileId={profile} /> : <TabProfileIcon {...props} tabId={tabId} />}
      {engine ? <EngineMark mark={engine} size={size} /> : null}
    </View>
  );
});

function EngineMark({ mark, size }: { mark: PageEngine; size: number }) {
  const theme = useTheme();
  const box = Math.round(size * 0.6);
  return (
    <View
      pointerEvents="none"
      accessibilityLabel={`Opens in ${ENGINE_NAMES[mark]}`}
      style={{
        position: "absolute",
        right: -box / 3,
        bottom: -box / 3,
        width: box,
        height: box,
        borderRadius: box / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: sidebarTokens(theme).engineMarkPlate,
      }}
    >
      <Symbol name={ENGINE_SYMBOLS[mark]} size={box - 3} weight="semibold" color={theme.icon} style={{ width: box, height: box }} />
    </View>
  );
}

function TabProfileIcon({ tabId, ...props }: Omit<Parameters<typeof Icon>[0], "profileId"> & { tabId: string }) {
  const profileId = useTab(tabId, (t) => t?.profileId);
  return <Icon {...props} profileId={profileId} />;
}

const SLEEPING_OPACITY = 0.45;

function Icon({
  url,
  favicon,
  icon,
  size = 16,
  color,
  profileId,
  direct,
  onSource,
}: {
  url: string;
  favicon?: string | null;
  icon?: string | null;
  size?: number;
  color?: string;
  profileId?: string;
  direct?: boolean;
  onSource?: FaviconSourceListener;
}) {
  const theme = useTheme();
  const symbol = iconSymbol(icon);
  if (symbol) {
    const ink = icon === NO_GROUP_ICON ? sidebarTokens(theme).noGroupIcon : theme.icon;
    return <Symbol name={symbol} size={size - 3} weight="medium" color={color ?? ink} style={{ width: size, height: size }} />;
  }
  const arcSource = arcIconSource(icon);
  if (arcSource !== undefined) {
    const tint = color ?? theme.icon;
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Image key={tint} source={arcSource} accessible={false} style={{ width: size - 3, height: size - 3, tintColor: tint }} />
      </View>
    );
  }
  if (icon && !isArcIcon(icon)) {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size - 3, lineHeight: size }}>{icon}</Text>
      </View>
    );
  }
  return <Favicon url={url} favicon={favicon} size={size} profileId={profileId} direct={direct} onSource={onSource} />;
}
