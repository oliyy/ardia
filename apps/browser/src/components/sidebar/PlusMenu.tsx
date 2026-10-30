import { Fragment, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { markHoverProps } from "../../lib/hoverMarks";
import { useWindow } from "../../state/browser/hooks";
import { useSidebarWidth } from "../../state/sidebar/hooks";
import {
  dismissPlusMenu,
  dismissPlusMenuIn,
  dismissPlusOpening,
  plusMenuLive,
  plusMenuOpening,
  pressPlusButton,
  runPlusAction,
  type PlusAction,
  type PlusMenuShown,
  type PlusOpening,
} from "../../state/sidebar/plusMenu";
import { useSidebarUi } from "../../state/sidebar/sidebarUi";
import { Button, ContextMenuArea, PopoverBubble, POPOVER_MOTION, Symbol, weight } from "../ui";
import { SIDEBAR_FOOTER_BUTTON, SIDEBAR_FOOTER_HEIGHT } from "./geometry";
import { PLUS_MENU_INK as INK } from "./tokens";

const MENU = { width: 210, radius: 13, pad: 8, row: 40, divider: 17, inset: 8, rowRadius: 8, iconLeft: 18, icon: 20, labelLeft: 51, shortcutRight: 21, edge: 8, anchorRight: 16, arrowShift: -3 } as const;
const ARROW = { width: 12, height: 6 } as const;
const KEYS = [{ key: "ArrowUp" }, { key: "ArrowDown" }, { key: "Enter" }, { key: "Escape" }];

type Item = { id: PlusAction; title: string; icon: string; shortcut?: string; group: number };
type Size = { width: number; height: number };

const ITEMS: Item[] = [
  { id: "space", title: "New Space", icon: "plus.square.on.square", group: 0 },
  { id: "folder", title: "New Folder", icon: "folder", group: 0 },
  { id: "split", title: "New Split", icon: "rectangle.split.2x1", shortcut: "⌃⇧=", group: 1 },
  { id: "tab", title: "New Tab", icon: "plus.square", shortcut: "⌘T", group: 1 },
];

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

export function PlusButton({ windowId, color }: { windowId: string; color: string }) {
  const open = useSidebarUi((u) => u.plusMenu?.windowId === windowId);
  const button = useRef<View>(null);
  const owned = useRef<PlusOpening | null>(null);
  useEffect(
    () => () => {
      if (owned.current) dismissPlusOpening(owned.current, false);
    },
    [],
  );
  const press = () => {
    const opening = pressPlusButton(windowId, (placed) => {
      if (!button.current) return placed(null);
      button.current.measureInWindow((x, y, width, height) => placed(width && height ? { x, y, width, height } : null));
    });
    if (opening) owned.current = opening;
  };
  return (
    <View ref={button} collapsable={false}>
      <Button variant="icon" icon={open ? "xmark" : "plus"} size={open ? 13 : 18} weight="medium" color={color} box={SIDEBAR_FOOTER_BUTTON.size} radius={10} tooltip={open ? undefined : "New"} onPress={press} />
    </View>
  );
}

export function PlusMenu({ windowId, size }: { windowId: string; size: Size }) {
  const menu = useSidebarUi((u) => (u.plusMenu?.windowId === windowId ? u.plusMenu : null));
  const [shown, setShown] = useState<PlusMenuShown | null>(menu);
  if (menu && menu !== shown) setShown(menu);
  useEffect(() => () => dismissPlusMenuIn(windowId), [windowId]);
  if (!shown) return null;
  return <Panel key={shown.id} menu={shown} size={size} closing={menu !== shown} onClosed={() => setShown((m) => (m === shown ? null : m))} />;
}

function Panel({ menu, size, closing, onClosed }: { menu: PlusMenuShown; size: Size; closing: boolean; onClosed: () => void }) {
  const incognito = useWindow(menu.windowId, (w) => w?.kind === "private");
  const sidebarWidth = useSidebarWidth(menu.windowId);
  const [opened] = useState(() => ({ size, sidebarWidth }));
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const root = useRef<View>(null);
  const keys = useRef<View>(null);
  const mounted = useRef(true);
  const appear = useRef(new Animated.Value(0)).current;
  const closed = useRef(onClosed);
  closed.current = onClosed;
  const items = incognito ? ITEMS.filter((item) => item.id !== "folder") : ITEMS;
  const placed = origin !== null;

  useEffect(
    () => () => {
      mounted.current = false;
      dismissPlusMenu(menu.id, false);
    },
    [menu.id],
  );

  useEffect(() => {
    if (!closing && (size.width !== opened.size.width || size.height !== opened.size.height || sidebarWidth !== opened.sidebarWidth)) dismissPlusMenu(menu.id, false);
  }, [closing, size.width, size.height, sidebarWidth]);

  useEffect(() => {
    const opening = plusMenuOpening(menu.id);
    if (closing || !placed || !opening) return;
    const focus = () => {
      if (mounted.current && plusMenuLive(opening)) keys.current?.focus();
      else dismissPlusOpening(opening, false);
    };
    if (opening.token !== null) return focus();
    opening.focus = focus;
    return () => {
      if (opening.focus === focus) opening.focus = null;
    };
  }, [closing, placed, menu.id]);

  useEffect(() => {
    if (!placed) {
      if (closing) closed.current();
      return;
    }
    const motion = closing ? POPOVER_MOTION.close : POPOVER_MOTION.open;
    Animated.timing(appear, { toValue: closing ? 0 : 1, duration: motion.duration, easing: motion.easing, useNativeDriver: true }).start(
      ({ finished }) => finished && closing && closed.current(),
    );
  }, [closing, placed]);

  const onKey = (key: string) => {
    if (closing) return;
    if (key === "Escape") return dismissPlusMenu(menu.id, true);
    if (key === "Enter") {
      const item = selected === null ? undefined : items[selected];
      if (item) runPlusAction(menu, item.id);
      return;
    }
    const step = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
    if (step) setSelected((index) => (index === null ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length));
  };

  const divided = items.some((item) => item.group === 0) && items.some((item) => item.group === 1);
  const body = MENU.pad * 2 + MENU.row * items.length + (divided ? MENU.divider : 0);
  const height = body + ARROW.height;
  const hole = origin && { x: menu.anchor.x - origin.x, y: menu.anchor.y - origin.y, width: menu.anchor.width, height: menu.anchor.height };
  const centre = hole ? hole.x + hole.width / 2 : 0;
  const left = clamp(centre + MENU.anchorRight - MENU.width, MENU.edge, size.width - MENU.edge - MENU.width);
  const arrowX = clamp(centre + MENU.arrowShift - left, MENU.radius + ARROW.width / 2, MENU.width - MENU.radius - ARROW.width / 2);
  const footerTop = hole ? hole.y + hole.height + SIDEBAR_FOOTER_BUTTON.bottom - SIDEBAR_FOOTER_HEIGHT : 0;
  const top = Math.max(MENU.edge, footerTop - 1 - height);
  const outside = () => dismissPlusMenu(menu.id, true);
  const catchers = hole
    ? [
        { left: 0, top: 0, width: size.width, height: hole.y },
        { left: 0, top: hole.y + hole.height, width: size.width, height: size.height - hole.y - hole.height },
        { left: 0, top: hole.y, width: hole.x, height: hole.height },
        { left: hole.x + hole.width, top: hole.y, width: size.width - hole.x - hole.width, height: hole.height },
      ].filter((rect) => rect.width > 0 && rect.height > 0)
    : [];

  return (
    <View
      ref={root}
      collapsable={false}
      pointerEvents={closing ? "none" : "box-none"}
      style={StyleSheet.absoluteFill}
      onLayout={() =>
        root.current?.measureInWindow((x, y) => {
          if (mounted.current && plusMenuOpening(menu.id)) setOrigin({ x, y });
        })
      }
    >
      {!closing &&
        catchers.map((rect, index) => (
          <ContextMenuArea key={index} captureDescendants onContextMenu={outside} style={{ position: "absolute", ...rect }}>
            <Pressable focusable={false} style={StyleSheet.absoluteFill} onPress={outside} />
          </ContextMenuArea>
        ))}
      {hole ? (
        <Animated.View
          style={{
            position: "absolute",
            left,
            top,
            width: MENU.width,
            height,
            opacity: appear,
            transformOrigin: `${arrowX}px bottom`,
            transform: [
              { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
              { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) },
            ],
          }}
        >
          <PopoverBubble
            material="menu"
            dark
            cornerRadius={MENU.radius}
            arrowEdge="bottom"
            arrowX={arrowX}
            arrowWidth={ARROW.width}
            arrowHeight={ARROW.height}
            tint={INK.body}
            shadowOpacity={0.35}
            shadowRadius={16}
            shadowOffsetY={6}
            style={StyleSheet.absoluteFill}
          />
          <View
            ref={keys}
            focusable
            enableFocusRing={false}
            keyDownEvents={KEYS}
            onKeyDown={(e) => onKey(e.nativeEvent.key)}
            accessibilityRole="menu"
            style={{ height: body, paddingVertical: MENU.pad }}
          >
            {items.map((item, index) => (
              <Fragment key={item.id}>
                {index > 0 && item.group !== items[index - 1]!.group ? (
                  <View style={{ height: 1, marginVertical: (MENU.divider - 1) / 2, marginHorizontal: 12, backgroundColor: INK.surface }} />
                ) : null}
                <Row item={item} index={index} selected={selected === index} onSelect={setSelected} onPress={() => runPlusAction(menu, item.id)} />
              </Fragment>
            ))}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

function Row({ item, index, selected, onSelect, onPress }: { item: Item; index: number; selected: boolean; onSelect: Dispatch<SetStateAction<number | null>>; onPress: () => void }) {
  const [hoverProps] = useState(() => markHoverProps({ onMouseEnter: () => onSelect(index), onMouseLeave: () => onSelect((shown) => (shown === index ? null : shown)) }));
  return (
    <View {...hoverProps}>
      <Pressable focusable={false} accessibilityRole="menuitem" accessibilityLabel={item.title} onPress={onPress}>
        <View style={{ height: MENU.row, marginHorizontal: MENU.inset, borderRadius: MENU.rowRadius, flexDirection: "row", alignItems: "center", backgroundColor: selected ? INK.surface : undefined }}>
          <Symbol name={item.icon} size={16} weight="medium" color={INK.label} style={{ width: MENU.icon, height: MENU.icon, marginLeft: MENU.iconLeft - MENU.inset }} />
          <Text numberOfLines={1} style={{ flex: 1, marginLeft: MENU.labelLeft - MENU.iconLeft - MENU.icon, fontSize: 14, fontWeight: weight.semibold, color: INK.label }}>
            {item.title}
          </Text>
          {item.shortcut ? <Text style={{ marginRight: MENU.shortcutRight - MENU.inset, fontSize: 14, letterSpacing: 2, color: INK.shortcut }}>{item.shortcut}</Text> : null}
        </View>
      </Pressable>
    </View>
  );
}
