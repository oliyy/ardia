import { isCalendarTab } from "../live/CalendarPreview";
import { showsMiniPlayer } from "../media/HoverPlayer";

export const tabHasCard = (tabId: string) => showsMiniPlayer(tabId) || isCalendarTab(tabId);
