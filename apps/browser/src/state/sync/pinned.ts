import type { Adapter } from "../../platform/sync";
import { inTodaysNames } from "./adapters";
import { pinnedTreeAdapter } from "./pinnedTree";
import { tileFoldersAdapter } from "./tileFoldersAdapter";

export function pinnedAreaAdapters(profileId: string): Adapter[] {
  return [inTodaysNames(pinnedTreeAdapter(profileId)), tileFoldersAdapter(profileId)];
}
