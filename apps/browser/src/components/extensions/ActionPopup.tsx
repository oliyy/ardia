import { useEffect, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { closeExtensionPopup, useWindowExtensions } from "../../state/extensions/actions";
import { MEASURE_POPUP_SCRIPT } from "../../state/extensions/popupSize";
import { openFromPage, pageProfileId } from "../../state/tabs/openFromPage";
import { ExtensionPopupWindow, WebView, type WebViewHandle } from "../ui";
import { useTheme } from "../ui/theme";
import { EXTENSION_PAGE_BACKGROUND } from "./tokens";

const MIN = { width: 25, height: 25 };
const MAX = { width: 800, height: 600 };

export function ActionPopup({ windowId, pageProfile, extensionId, url, anchor }: { windowId: string; pageProfile: string; extensionId: string; url: string; anchor: { x: number; y: number; width: number; height: number } }) {
  const theme = useTheme();
  const web = useRef<WebViewHandle>(null);
  const screen = useWindowDimensions();
  const [windowWidth, setWindowWidth] = useState(0);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const title = useWindowExtensions(windowId).find((x) => x.id === extensionId)?.name;
  const alive = useRef(true);
  const sized = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (size) void web.current?.focus();
  }, [!size]);

  const resize = (w: number, h: number) => {
    const next = {
      width: Math.min(MAX.width, Math.max(MIN.width, Math.ceil(w))),
      height: Math.min(MAX.height, Math.max(MIN.height, Math.ceil(h))),
    };
    setSize((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
  };

  const watchSize = () => {
    if (sized.current) return;
    void web.current?.evaluate<{ w: number; h: number }>(MEASURE_POPUP_SCRIPT).then((m) => {
      if (!alive.current || !m || sized.current) return;
      resize(m.w, m.h);
      watchSize();
    });
  };

  const width = size?.width ?? MIN.width;
  const height = size?.height ?? MIN.height;
  const room = windowWidth || screen.width;
  const left = Math.max(8, Math.min(anchor.x + anchor.width - width, room - width - 8));
  const top = anchor.y + anchor.height + 6;

  return (
    <>
      <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setWindowWidth(e.nativeEvent.layout.width)} />
      <ExtensionPopupWindow shown={!!size} dark={theme.dark} title={title} onClose={closeExtensionPopup} style={{ position: "absolute", left, top, width, height }}>
        <WebView
          ref={web}
          style={StyleSheet.absoluteFill}
          url={url}
          profile={pageProfile}
          standalone
          extensionHost="popup"
          pageBackgroundColor={EXTENSION_PAGE_BACKGROUND}
          onPreferredSize={({ width, height }) => {
            sized.current = true;
            resize(width, height);
          }}
          onNavigationChange={({ isLoading }) => {
            if (isLoading) return;
            watchSize();
            if (size) void web.current?.focus();
          }}
          onWindowClose={closeExtensionPopup}
          onOpenWindow={(request) => openFromPage(request, { windowId, profileId: pageProfileId(windowId, pageProfile) })}
        />
      </ExtensionPopupWindow>
    </>
  );
}
