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
import { useSettings, useTab } from "../../state/browser/hooks";
import { isIncognitoProfile } from "../../state/browser/model";
import { MenuRow, MenuSeparator, Toggle } from "../ui";
import { SettingRow } from "./SiteControlsParts";

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
