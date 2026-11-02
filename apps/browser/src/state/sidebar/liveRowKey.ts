const LIVE_ROW = "live|";

export const liveRowKey = (folderId: string, itemId: string) => `${LIVE_ROW}${folderId}|${itemId}`;

export const isLiveRowKey = (id: string) => id.startsWith(LIVE_ROW);
