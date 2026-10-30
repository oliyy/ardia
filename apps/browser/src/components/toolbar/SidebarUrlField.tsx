import { cleanUrl } from "@ardia/core";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Image, Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../ui/theme";
import { TOOLBAR_ROWS } from "../../lib/toolbarRow";
import { copyText } from "../../state/app/system";
import { ArcUrlFieldBackground, ArcUrlFieldText, ArcUrlInsecureIcon, ContextMenuArea, curve, spring, Symbol, useHover, type SpringSpec } from "../ui";
import type { ToolbarPalette } from "../ui/toolbarColors";
import { SIDEBAR_FIELD } from "../sidebar/geometry";
import { useSidebarHovered } from "../sidebar/ClearDivider";
import { showUrlBarMenu } from "../../state/omnibox/paste";
import { COPY_LINK, SIDEBAR_FIELD_BUTTONS, SIDEBAR_URL_TEXT } from "./tokens";
import { FieldButtons, LOCK, useUrlField, type UrlFieldProps } from "./Toolbar";

const SITE_CONTROLS_GLYPH = {
  closed: require("../../../assets/arc-url-icons/site-controls.png"),
  open: require("../../../assets/arc-url-icons/site-controls-fill.png"),
} as const;
const RAW_WEB_AUTHORITY = /^https?:\/\/([^/?#]*)/i;

function urlTextAlignment(url: string): "leading" | "trailing" {
  const authority = RAW_WEB_AUTHORITY.exec(url)?.[1] ?? "";
  const host = authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d*$/, "");
  return host ? "trailing" : "leading";
}

export const SidebarUrlField = memo(function SidebarUrlField({ tab, palette, windowId, onFocus, height, accessory }: UrlFieldProps & { height: number; accessory: ReactNode }) {
  const theme = useTheme();
  const field = useUrlField(tab, windowId, onFocus);
  const { insecure, hovered, popover, toggleSiteControls } = field;
  const arcInsecure = insecure === "insecure";
  const sidebarHovered = useSidebarHovered(windowId);
  const buttonsShown = hovered || sidebarHovered;
  const buttonsFade = useFieldButtonsFade(buttonsShown);
  const textLeft = insecure ? LOCK.gap : SIDEBAR_FIELD.textLeft;

  return (
    <View {...field.hoverProps} style={{ flexDirection: "row", alignItems: "center", height, borderRadius: SIDEBAR_FIELD.radius, borderCurve: "continuous", overflow: "hidden" }}>
      <ArcUrlFieldBackground dark={theme.dark} hovered={hovered} pointerEvents="none" style={StyleSheet.absoluteFill} />
      {arcInsecure ? (
        <Pressable onPress={toggleSiteControls} accessibilityRole="button" accessibilityLabel="Connection is not secure" style={{ paddingLeft: LOCK.left }} tooltip="Connection is not secure">
          <InsecureLock dark={theme.dark} />
        </Pressable>
      ) : null}
      {insecure && !arcInsecure && (
        <Pressable onPress={toggleSiteControls} style={{ paddingLeft: LOCK.left }} tooltip="Connection is not secure">
          <Symbol
            name="lock.open.trianglebadge.exclamationmark.fill"
            size={12}
            color={insecure === "certificateError" ? theme.destructive : palette.secondary}
            style={{ width: LOCK.width, height }}
          />
        </Pressable>
      )}
      <View style={{ flex: 1, height }}>
        <ContextMenuArea style={{ flex: 1 }} onContextMenu={() => void showUrlBarMenu(tab)}>
          <Pressable onPress={field.openPanel} style={{ flex: 1, height, justifyContent: "center", paddingLeft: textLeft }}>
            <ArcUrlFieldText
              text={field.host + field.trail}
              alignment={urlTextAlignment(tab.url)}
              color={theme.dark ? SIDEBAR_URL_TEXT.dark : SIDEBAR_URL_TEXT.light}
              hoverButtonsWidth={buttonsShown ? 2 * SIDEBAR_FIELD_BUTTONS.box : 0}
              pointerEvents="none"
              style={{ position: "absolute", left: textLeft, right: 0, top: 0, bottom: 0 }}
            />
          </Pressable>
        </ContextMenuArea>
        <Animated.View pointerEvents={buttonsShown ? "box-none" : "none"} style={{ position: "absolute", right: 0, top: 0, bottom: 0, flexDirection: "row", alignItems: "center", opacity: buttonsFade }}>
          <CopyLinkButton url={tab.url} palette={palette} />
          <FieldButton palette={palette} active={popover === "siteControls"} onPress={toggleSiteControls} tooltip="Site Controls">
            <Image
              source={popover === "siteControls" ? SITE_CONTROLS_GLYPH.open : SITE_CONTROLS_GLYPH.closed}
              accessible={false}
              style={{ width: SIDEBAR_FIELD_BUTTONS.siteControlsGlyph, height: SIDEBAR_FIELD_BUTTONS.siteControlsGlyph, tintColor: palette.icon }}
            />
          </FieldButton>
        </Animated.View>
      </View>
      <FieldButtons tab={tab} palette={palette} row={TOOLBAR_ROWS.regular} onFocus={onFocus} popover={popover} toggleSiteControls={toggleSiteControls} accessory={accessory} zoom={false} />
    </View>
  );
});

function useFieldButtonsFade(shown: boolean) {
  const opacity = useRef(new Animated.Value(shown ? 1 : 0)).current;
  const shownFor = useRef(shown);
  useEffect(() => {
    if (shownFor.current === shown) return;
    shownFor.current = shown;
    Animated.timing(opacity, { toValue: shown ? 1 : 0, duration: SIDEBAR_FIELD_BUTTONS.fade, easing: curve.cssEaseOut, useNativeDriver: true }).start();
  }, [shown]);
  return opacity;
}

function useSpringFlag(on: boolean, springSpec: SpringSpec, delay: number) {
  const progress = useRef(new Animated.Value(on ? 1 : 0)).current;
  const onFor = useRef(on);
  useEffect(() => {
    if (onFor.current === on) return;
    onFor.current = on;
    Animated.spring(progress, { toValue: on ? 1 : 0, ...spring(springSpec), delay, useNativeDriver: true }).start();
  }, [on]);
  return progress;
}

function CopyLinkButton({ url, palette }: { url: string; palette: ToolbarPalette }) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const link = useSpringFlag(!copied, COPY_LINK.linkSpring, copied ? 0 : COPY_LINK.delay);
  const check = useSpringFlag(copied, COPY_LINK.checkSpring, COPY_LINK.delay);
  const linkStyle = useMemo(
    () => ({
      opacity: link.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
      transform: [{ scale: link.interpolate({ inputRange: [0, 1], outputRange: [COPY_LINK.shrink, 1], extrapolateLeft: "clamp" }) }],
    }),
    [link],
  );
  const checkStyle = useMemo(
    () => ({
      opacity: check.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: "clamp" }),
      transform: [{ translateX: check.interpolate({ inputRange: [0, 1], outputRange: [COPY_LINK.slide, 0] }) }],
    }),
    [check],
  );
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const copy = () => {
    if (!url) return;
    copyText(cleanUrl(url));
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPY_LINK.copiedFor);
  };
  const glyph = { position: "absolute", width: COPY_LINK.frame, height: COPY_LINK.frame } as const;
  return (
    <FieldButton palette={palette} onPress={copy} tooltip="Copy URL (⇧⌘C)">
      <Animated.View pointerEvents="none" style={[glyph, checkStyle]}>
        <Symbol name="checkmark" size={COPY_LINK.glyph} weight="medium" color={palette.icon} style={{ width: COPY_LINK.frame, height: COPY_LINK.frame }} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[glyph, linkStyle]}>
        <Symbol name="link" size={COPY_LINK.glyph} weight="medium" color={palette.icon} style={{ width: COPY_LINK.frame, height: COPY_LINK.frame }} />
      </Animated.View>
    </FieldButton>
  );
}

function FieldButton({ palette, active, onPress, tooltip, children }: { palette: ToolbarPalette; active?: boolean; onPress: () => void; tooltip: string; children: ReactNode }) {
  const { hovered, hoverProps } = useHover();
  return (
    <View tooltip={tooltip} mouseDownCanMoveWindow={false} {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={tooltip}>
        {({ pressed }) => (
          <View
            style={{
              width: SIDEBAR_FIELD_BUTTONS.box,
              height: SIDEBAR_FIELD_BUTTONS.box,
              borderRadius: SIDEBAR_FIELD_BUTTONS.radius,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed || active ? palette.pressed : hovered ? palette.hover : undefined,
            }}
          >
            {children}
          </View>
        )}
      </Pressable>
    </View>
  );
}

function InsecureLock({ dark }: { dark: boolean }) {
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} style={{ width: SIDEBAR_FIELD_BUTTONS.insecureIcon, height: SIDEBAR_FIELD_BUTTONS.insecureIcon }}>
      <ArcUrlInsecureIcon dark={dark} hovered={hovered} pointerEvents="none" style={StyleSheet.absoluteFill} />
    </View>
  );
}
