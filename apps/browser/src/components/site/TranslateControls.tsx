import { showMenu, translation, type MenuItem } from "@ardia/shell";
import { useBrowser } from "../../store/browser";
import { isIncognitoProfile } from "../../store/model";
import { PopoverRow, PopoverSeparator, Toggle } from "../layout/controls";
import { SettingRow } from "./SiteControlsParts";
import {
  defaultTarget,
  isNeverTranslated,
  languageName,
  otherLanguages,
  setNeverTranslate,
  toggleTranslation,
  translatePage,
  translateStateOf,
  useTranslateState,
} from "./translate";

export function TranslateSetting({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const state = useTranslateState(tabId);
  if (!translation || (!state.source && state.status === "idle")) return null;
  const source = languageName(state.source ?? "");
  const target = languageName(state.target ?? defaultTarget());
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
  const current = translateStateOf(tabId).target;
  const items: MenuItem[] = languages.map((l) => ({ id: l.id, title: l.name, checked: l.id === current }));
  const choice = await showMenu(items);
  if (choice) void translatePage(tabId, choice);
}

export function TranslateRows({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const state = useTranslateState(tabId);
  const tab = useBrowser((s) => s.tabs[tabId]);
  useBrowser((s) => s.settings.neverTranslateSites);
  const never = tab ? isNeverTranslated(tab.profileId, tab.url) : false;
  if (!translation || !tab || (!state.source && state.status === "idle" && !never)) return null;
  return (
    <>
      {!never && (
        <PopoverRow
          icon="globe"
          title="Choose Another Language…"
          onPress={() => {
            onClose();
            void chooseLanguage(tabId);
          }}
        />
      )}
      {!isIncognitoProfile(tab.profileId) && (
        <PopoverRow icon="nosign" title="Never Translate This Site" accessory={<Toggle value={never} onChange={(v) => setNeverTranslate(tabId, v)} />} />
      )}
      <PopoverSeparator />
    </>
  );
}
