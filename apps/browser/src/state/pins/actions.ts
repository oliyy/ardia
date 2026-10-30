import { storeAction } from "../browser/store";

export const placeTabs = storeAction("placeTabs");
export const dropTabs = storeAction("dropTabs");
export const pinTabs = storeAction("pinTabs");
export const cleanUpTabs = storeAction("cleanUpTabs");
export const returnToPinnedUrl = storeAction("returnToPinnedUrl");
export const separateFromPin = storeAction("separateFromPin");
export const restoreCleaned = storeAction("restoreCleaned");
export const setSelection = storeAction("setSelection");
export const setPinnedUrl = storeAction("setPinnedUrl");
export const closeAbandonedNewTabs = storeAction("closeAbandonedNewTabs");
export const newFolder = storeAction("newFolder");
export const placePinned = storeAction("placePinned");
export const dropPinned = storeAction("dropPinned");
