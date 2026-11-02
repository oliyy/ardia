import { create } from "zustand";
import { keychainDelete, keychainGet, keychainSet } from "../../platform/keychain";
import { isMocked } from "../live/net";

const ACCOUNT = isMocked ? "mock:openrouter" : "openrouter";

export const useTidyKey = create<{ saved: boolean | null }>()(() => ({ saved: null }));

let loading = false;

export const tidyKey = (): Promise<string | null> =>
  keychainGet(ACCOUNT).then(
    (key) => {
      const saved = key?.trim() || null;
      useTidyKey.setState({ saved: !!saved });
      return saved;
    },
    () => null,
  );

export function loadTidyKey() {
  if (loading || useTidyKey.getState().saved !== null) return;
  loading = true;
  void tidyKey();
}

export async function saveTidyKey(key: string): Promise<boolean> {
  const trimmed = key.trim();
  if (!trimmed) return false;
  const ok = await keychainSet(ACCOUNT, trimmed);
  if (ok) useTidyKey.setState({ saved: true });
  return ok;
}

export async function removeTidyKey(): Promise<void> {
  await keychainDelete(ACCOUNT);
  useTidyKey.setState({ saved: false });
}
