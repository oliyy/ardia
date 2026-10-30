import { isCalendarTab } from "../../state/live/calendar";
import { showsMiniPlayer } from "../../state/media/media";

export const tabHasCard = (tabId: string) => showsMiniPlayer(tabId) || isCalendarTab(tabId);
