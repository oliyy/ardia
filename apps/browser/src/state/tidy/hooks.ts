import { useEffect } from "react";
import { loadTidyKey, useTidyKey as useTidyKeyStore } from "./tidyKey";

export function useTidyKey(): boolean {
  useEffect(loadTidyKey, []);
  return useTidyKeyStore((k) => k.saved === true);
}
