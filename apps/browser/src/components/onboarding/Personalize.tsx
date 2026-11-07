import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, View } from "react-native";
import { PROFILE_COLORS } from "../ui/theme";
import { useWindow } from "../../state/browser/hooks";
import { choosePresetColor } from "../../state/profiles/themeActions";
import { themeAccent } from "../../lib/profileLook";
import { CompactThemeEditor, CustomSwatch, useThemeDraft } from "../settings/ThemeEditor";
import { settingsInk } from "../settings/tokens";
import type { ProfileColor, ProfileTheme } from "../../state/browser/types";
import { useHover } from "../ui";
import { curve } from "../ui/motion";
import { onboardingMotion } from "./tokens";

const COLORS = Object.keys(PROFILE_COLORS) as ProfileColor[];

export function ThemeColorPicker({
  windowId,
  size = 30,
  gap = size >= 30 ? 8 : 6,
  onPick,
  onTheme,
}: {
  windowId: string;
  size?: number;
  gap?: number;
  onPick?: (color: ProfileColor) => void;
  onTheme?: (theme: ProfileTheme) => void;
}) {
  const profileId = useWindow(windowId, (w) => w?.profileId);
  const incognito = useWindow(windowId, (w) => w?.kind === "private");
  const look = useThemeDraft(profileId ?? "", (theme) => onTheme?.(theme));
  if (!profileId || incognito || !look.profile) return null;
  const { custom } = look;
  return (
    <View style={{ gap: 22 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap }} accessibilityRole="radiogroup" accessibilityLabel="Theme color">
        {COLORS.map((c) => (
          <ColorButton
            key={c}
            name={PROFILE_COLORS[c].name}
            ring={PROFILE_COLORS[c].swatch}
            fill={PROFILE_COLORS[c].swatch}
            size={size}
            selected={!custom && look.profile?.color === c}
            onPress={() => (onPick ? onPick(c) : choosePresetColor(profileId, c))}
          />
        ))}
        {onTheme ? (
          <ColorButton name="Custom" ring={custom ? themeAccent(custom) : settingsInk.customSwatch} fill={<CustomSwatch theme={custom} />} size={size} selected={!!custom} onPress={look.startCustom} />
        ) : null}
      </View>
      {onTheme && custom ? (
        <FadeIn>
          <CompactThemeEditor theme={custom} onChange={look.change} />
        </FadeIn>
      ) : null}
    </View>
  );
}

function FadeIn({ children }: { children: ReactNode }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: onboardingMotion.swatch, easing: curve.outQuad, useNativeDriver: true }).start();
  }, []);
  return <Animated.View style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}>{children}</Animated.View>;
}

function ColorButton({ name, ring, fill, size, selected, onPress }: { name: string; ring: string; fill: string | ReactNode; size: number; selected: boolean; onPress: () => void }) {
  const { hovered, hoverProps } = useHover();
  const t = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: selected ? 1 : 0, duration: onboardingMotion.swatch, easing: curve.outQuad, useNativeDriver: false }).start();
  }, [selected]);
  return (
    <View {...hoverProps} tooltip={name}>
      <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={name}>
        {({ pressed }) => (
          <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.94 : 1 }] }}>
            <Animated.View
              style={{
                position: "absolute",
                width: size,
                height: size,
                borderRadius: size / 2,
                borderWidth: 2,
                borderColor: ring,
                opacity: t,
              }}
            />
            <Animated.View
              style={{
                width: t.interpolate({ inputRange: [0, 1], outputRange: [size - (hovered ? 6 : 8), size - 12] }),
                height: t.interpolate({ inputRange: [0, 1], outputRange: [size - (hovered ? 6 : 8), size - 12] }),
                borderRadius: size / 2,
                overflow: "hidden",
                backgroundColor: typeof fill === "string" ? fill : undefined,
                opacity: hovered || selected ? 1 : 0.85,
              }}
            >
              {typeof fill === "string" ? null : fill}
            </Animated.View>
          </View>
        )}
      </Pressable>
    </View>
  );
}
