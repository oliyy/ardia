import type { TabGroup } from "../browser/types";
import type { LiveFolder, LiveFolderKind, LiveSourceId } from "../live/types";
import { FAVORITES, isGroupNode, isLiveNode, isTabNode, type PinPlace } from "../pins/pinTree";

export const PIN_TREE = "pt:";
export const PIN_NODE = `${PIN_TREE}n:`;

export type PinTabProps = { kind: "tab"; url: string; title: string; customTitle: string | null; customIcon: string | null };
export type PinFolderProps = { kind: "folder"; name: string; icon: string | null; color: TabGroup["color"] };
export type PinLiveProps = Pick<LiveFolder, "name" | "icon" | "sources" | "filters" | "hiddenRepos" | "groupStacks" | "showCompleted" | "createdAt"> & { kind: "live"; liveKind: LiveFolderKind };
export type PinNodeProps = PinTabProps | PinFolderProps | PinLiveProps;
export type PinNodeRecord = PinPlace & PinNodeProps;
export type PinTabRecord = PinPlace & PinTabProps;
export type PinFolderRecord = PinPlace & PinFolderProps;
export type PinLiveRecord = PinPlace & PinLiveProps;

const LIVE_SOURCES: Record<LiveSourceId, true> = { github: true, bitbucket: true, notion: true, confluence: true, gdrive: true };
const LIVE_KINDS: Record<LiveFolderKind, true> = { pullRequests: true, documents: true };
const isText = (v: unknown): v is string => typeof v === "string";
const isTextOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isPinParent = (v: unknown): v is string | null => v === null || v === FAVORITES || (isText(v) && isGroupNode(v));
export const isPinNode = (node: string) => isTabNode(node) || isGroupNode(node) || isLiveNode(node);
const isLiveSource = (v: unknown): v is LiveSourceId => isText(v) && Object.keys(LIVE_SOURCES).includes(v);
const isLiveKind = (v: unknown): v is LiveFolderKind => isText(v) && Object.keys(LIVE_KINDS).includes(v);

export function pinNodeRecord(node: string, value: unknown): PinNodeRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isPinParent(v.parent) || !isText(v.pos)) return null;
  const place: PinPlace = { parent: v.parent, pos: v.pos };
  if (isTabNode(node) && v.kind === "tab" && isText(v.url) && isText(v.title) && isTextOrNull(v.customTitle) && isTextOrNull(v.customIcon)) {
    return { ...place, kind: "tab", url: v.url, title: v.title, customTitle: v.customTitle, customIcon: v.customIcon };
  }
  if (isGroupNode(node) && v.kind === "folder" && isText(v.name) && isTextOrNull(v.icon) && isTextOrNull(v.color)) {
    return { ...place, kind: "folder", name: v.name, icon: v.icon, color: v.color as TabGroup["color"] };
  }
  const filters = v.filters as Record<string, unknown> | null | undefined;
  if (
    isLiveNode(node) &&
    v.kind === "live" &&
    isLiveKind(v.liveKind) &&
    isText(v.name) &&
    isTextOrNull(v.icon) &&
    Array.isArray(v.sources) &&
    typeof v.createdAt === "number" &&
    !!filters &&
    typeof v.groupStacks === "boolean" &&
    typeof v.showCompleted === "boolean" &&
    typeof filters.authored === "boolean" &&
    typeof filters.reviewRequests === "boolean"
  ) {
    const teamReviewRequests = typeof filters.teamReviewRequests === "boolean" ? filters.teamReviewRequests : filters.reviewRequests;
    const filtersOut = { authored: filters.authored, reviewRequests: filters.reviewRequests, teamReviewRequests };
    const hiddenRepos = Array.isArray(v.hiddenRepos) ? v.hiddenRepos.filter(isText) : [];
    return { ...place, kind: "live", liveKind: v.liveKind, name: v.name, icon: v.icon, sources: v.sources.filter(isLiveSource), filters: filtersOut, hiddenRepos, groupStacks: v.groupStacks, showCompleted: v.showCompleted, createdAt: v.createdAt };
  }
  return null;
}


export const TILE_FOLDER = "tilefold:";
export const FOLDER_NAME = `${TILE_FOLDER}n:`;
export type TileFolderValue = { f: string };
export type FolderNameValue = { n: string };

export const syncedFolderId = (value: unknown) => {
  const v = value as TileFolderValue | undefined;
  return v && typeof v.f === "string" ? v.f : undefined;
};
export const syncedName = (value: unknown) => {
  const v = value as FolderNameValue | undefined;
  return v && typeof v.n === "string" ? v.n : undefined;
};
