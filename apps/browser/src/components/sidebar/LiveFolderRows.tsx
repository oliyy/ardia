import { Pressable, Text, View } from "react-native";
import type { FolderRow } from "../../state/live/rows";
import { showAllIn, toggleStack, useLive } from "../../state/live/store";
import { dismissHover } from "../../state/sidebar/hover";
import { openLiveStackMenu } from "../../state/sidebar/liveMenus";
import { ActivitySpinner, ContextMenuArea, Symbol, useHover } from "../ui";
import { layout, useTheme } from "../ui/theme";
import { useLiveColors } from "../live/tokens";
import { Fold, useFold } from "./Fold";
import { AnimatedSurface } from "./LiveMotion";
import { LiveItemRow } from "./LiveItemRow";
import { TABULAR_NUMS, useSidebarTokens } from "./tokens";

export const STACK_INDENT = 10;

export type GlideStyle = (key: string) => object | null;

export function SectionTitle({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <View presentationGate style={{ height: 22, justifyContent: "flex-end", paddingLeft: 9, paddingBottom: 2 }}>
      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "600", color: theme.textSecondary }}>
        {title}
      </Text>
    </View>
  );
}

export function NoteRow({ text, icon, spinner, onPress }: { text: string; icon?: string; spinner?: boolean; onPress?: () => void }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const { hovered, hoverProps } = useHover();
  const body = (
    <View style={{ height: 28, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 6, gap: 6, borderRadius: 8, backgroundColor: onPress && hovered ? theme.rowHover : undefined }}>
      {spinner ? (
        <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
          <ActivitySpinner visible style={{ width: 12, height: 12 }} />
        </View>
      ) : icon ? <Symbol name={icon} size={10} color={colors.pending} style={{ width: 16, height: 16 }} /> : null}
      <Text numberOfLines={2} style={{ flex: 1, fontSize: 12, color: theme.textSecondary }}>
        {text}
      </Text>
    </View>
  );
  return (
    <View {...hoverProps}>
      {onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body}
    </View>
  );
}

export function MoreRow({ folderId, section, count }: { folderId: string; section: string; count: number }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View presentationGate {...hoverProps}>
      <Pressable onPress={() => showAllIn(folderId, section)}>
        <View style={{ height: 26, borderRadius: 8, flexDirection: "row", alignItems: "center", paddingLeft: 9, backgroundColor: hovered ? theme.rowHover : undefined }}>
          <Symbol name="ellipsis" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
          <Text style={{ marginLeft: 5, fontSize: 12, color: theme.textSecondary }}>Show {count} More</Text>
        </View>
      </Pressable>
    </View>
  );
}

export function StackRow({ folderId, windowId, stack, glide }: { folderId: string; windowId: string; stack: Extract<FolderRow, { kind: "stack" }>; glide: GlideStyle }) {
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const collapsed = useLive((s) => s.expandedStacks[stack.id] === false);
  const fold = useFold(collapsed);
  const { hovered, hoverProps } = useHover();
  const repo = stack.repo.split("/")[1] ?? stack.repo;
  return (
    <View presentationGate>
      <View {...hoverProps}>
        <ContextMenuArea
          onContextMenu={() => {
            dismissHover();
            void openLiveStackMenu(folderId, stack.id);
          }}
        >
          <Pressable
            onPress={() => toggleStack(stack.id)}
            accessibilityLabel={collapsed ? "Expand pull request stack" : "Collapse pull request stack"}
          >
            <View style={{ height: 26, borderRadius: 8, flexDirection: "row", alignItems: "center", paddingLeft: 9, paddingRight: 8, backgroundColor: hovered ? theme.rowHover : undefined }}>
              <Symbol name="square.stack.3d.up" size={11} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
              <Text numberOfLines={1} style={{ flex: 1, marginLeft: 5, fontSize: 12, fontWeight: "500", color: theme.textSecondary }}>
                {repo} stack
              </Text>
              <View style={{ minWidth: 18, height: 16, borderRadius: 8, paddingHorizontal: 5, backgroundColor: tokens.countPill, alignItems: "center", justifyContent: "center", marginRight: 4 }}>
                <Text style={{ fontSize: 10, fontWeight: "600", color: theme.textTab, fontVariant: TABULAR_NUMS }}>{stack.items.length}</Text>
              </View>
              <Symbol name={collapsed ? "chevron.right" : "chevron.down"} size={9} weight="semibold" color={theme.textSecondary} style={{ width: 12, height: 12 }} />
            </View>
          </Pressable>
        </ContextMenuArea>
      </View>
      <Fold
        fold={fold}
        collapsed={collapsed}
        entries={stack.items.map((item) => ({
          key: item.id,
          node: (
            <AnimatedSurface style={glide(item.id)}>
              <LiveItemRow folderId={folderId} item={item} windowId={windowId} inStack />
            </AnimatedSurface>
          ),
        }))}
        gap={layout.rowGap}
        rowHeight={layout.rowHeight}
        padTop={layout.rowGap}
      />
    </View>
  );
}
