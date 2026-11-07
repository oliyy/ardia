import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { showOnceOverEmptyCard } from "../../state/omnibox/newTabBar";
import { tourAnchorRef } from "../onboarding/tour/anchors";

export function EmptyCard({ windowId, tabId }: { windowId: string; tabId: string }) {
  useEffect(() => showOnceOverEmptyCard(windowId, tabId), [windowId, tabId]);
  return <View ref={tourAnchorRef(windowId, "page")} style={StyleSheet.absoluteFill} pointerEvents="none" />;
}
