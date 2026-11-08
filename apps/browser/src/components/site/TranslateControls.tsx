import { showMenu } from "../../state/app/system";
import {
  translation,
  defaultTarget,
  isNeverTranslated,
  languageName,
  otherLanguages,
  setNeverTranslate,
  toggleTranslation,
  translatePage,
  translationTarget,
  useTranslateState,
} from "../../state/site/translate";
import { memo, useEffect, useRef } from "react";
import { Animated } from "react-native";
import { useSettings, useTab } from "../../state/browser/hooks";
import { isIncognitoProfile } from "../../state/browser/model";
import { Button, MenuRow, MenuSeparator, Symbol, Toggle, type SymbolProps } from "../ui";
import type { ToolbarPalette } from "../ui/toolbarColors";
import { SettingRow } from "./SiteControlsParts";
import { TRANSLATE_GLYPH } from "./tokens";

export function useTranslateButton(tabId: string) {
  const state = useTranslateState(tabId);
  const shown = !!translation && (!!state.source || state.status !== "idle");
  const on = state.status !== "idle";
  return {
    shown,
    on,
    translating: state.status === "translating",
    tooltip: on ? "Show Original" : `Translate to ${languageName(defaultTarget())}`,
    toggle: () => toggleTranslation(tabId),
  };
}

export function TranslateGlyph({ size, weight, color, frame, translating }: { size: number; weight: SymbolProps["weight"]; color: string; frame: number; translating: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const wasTranslating = useRef(false);
  useEffect(() => {
    if (translating) {
      wasTranslating.current = true;
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: TRANSLATE_GLYPH.pulseLow, duration: TRANSLATE_GLYPH.pulseMs, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: TRANSLATE_GLYPH.pulseMs, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    }
    if (wasTranslating.current) Animated.timing(opacity, { toValue: 1, duration: TRANSLATE_GLYPH.settleMs, useNativeDriver: true }).start();
  }, [translating]);
  return (
    <Animated.View pointerEvents="none" style={{ width: frame, height: frame, opacity }}>
      <Symbol name="translate" size={size} weight={weight} color={color} style={{ width: frame, height: frame }} />
    </Animated.View>
  );
}

export const TranslateButton = memo(function TranslateButton({ tabId, palette, box, radius, onFocus }: { tabId: string; palette: ToolbarPalette; box: number; radius: number; onFocus: () => void }) {
  const button = useTranslateButton(tabId);
  if (!button.shown) return null;
  return (
    <Button
      variant="icon"
      toolbar
      palette={palette}
      box={box}
      radius={radius}
      active={button.on}
      glyph={(tint) => <TranslateGlyph size={TRANSLATE_GLYPH.toolbarSize} weight="regular" color={tint} frame={box} translating={button.translating} />}
      onPress={() => {
        onFocus();
        button.toggle();
      }}
      tooltip={button.tooltip}
    />
  );
});

export function TranslateSetting({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const state = useTranslateState(tabId);
  if (!translation || (!state.source && state.status === "idle")) return null;
  const source = languageName(state.source ?? "");
  const target = languageName(state.status === "idle" ? defaultTarget() : state.target);
  const value = state.status === "translating" ? `Translating to ${target}…` : state.status === "translated" ? `On · ${source} → ${target}` : `${source} → ${target}`;
  return (
    <SettingRow
      icon="translate"
      title="Translate"
      value={value}
      on={state.status !== "idle"}
      onPress={() => {
        onClose();
        toggleTranslation(tabId);
      }}
    />
  );
}

async function chooseLanguage(tabId: string) {
  const languages = await otherLanguages();
  const current = translationTarget(tabId);
  const choice = await showMenu(languages.map((l) => ({ id: l.id, title: l.name, checked: l.id === current })));
  if (choice) void translatePage(tabId, choice);
}

export function TranslateRows({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const state = useTranslateState(tabId);
  const tab = useTab(tabId);
  useSettings((st) => st.neverTranslateSites);
  const never = tab ? isNeverTranslated(tab.profileId, tab.url) : false;
  if (!translation || !tab || (!state.source && state.status === "idle" && !never)) return null;
  return (
    <>
      {!never && (
        <MenuRow
          icon="globe"
          title="Choose Another Language…"
          onPress={() => {
            onClose();
            void chooseLanguage(tabId);
          }}
        />
      )}
      {!isIncognitoProfile(tab.profileId) && (
        <MenuRow icon="nosign" title="Never Translate This Site" accessory={<Toggle look="panel" value={never} onChange={(v) => setNeverTranslate(tabId, v)} />} />
      )}
      <MenuSeparator />
    </>
  );
}
