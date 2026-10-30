import { useContext, useEffect, useRef, type ReactNode } from "react";
import { Animated, Image, Pressable, Text, View, type ImageSourcePropType } from "react-native";
import { closeTab } from "../../state/browser/actions";
import { openLiveItem } from "../../state/live/engine";
import { githubAge, prBadge, summarizeChecks } from "../../state/live/github";
import { awaitsReview, reviewAnswered } from "../../state/live/rows";
import { SOURCES } from "../../state/live/sources";
import { live, useLive } from "../../state/live/store";
import type { CompletedItem, CompletionState, LiveItem, PullRequestInfo } from "../../state/live/types";
import { usePageProfileId } from "../../state/browser/hooks";
import { useIsActiveIn, useLiveItemTab } from "../../state/sidebar/hooks";
import { dismissHover } from "../../state/sidebar/hover";
import { openLiveItemMenu } from "../../state/sidebar/liveMenus";
import { registerRow } from "../../state/sidebar/sidebarUi";
import { withShortcut } from "../../state/commands/commandShortcuts";
import { useAddressBarInSidebar } from "../../state/windows/layout";
import { modifiersOf } from "../../lib/keys";
import { HoverSlot } from "../ui/HoverSlot";
import { ActivitySpinner, Button, ContextMenuArea, FadeLabel, ink, PulseDot, radius, Surface, Symbol, type FadeLabelGlyph } from "../ui";
import { hex, layout, useTheme } from "../ui/theme";
import { useLiveColors, type LiveColors } from "../live/tokens";
import { useFoldHidden } from "./Fold";
import { useRowHover } from "./hoverController";
import { Glide, Morph } from "./LiveMotion";
import { ListMotionContext } from "./ListMotion";
import { STACK_INDENT } from "./LiveFolderRows";
import { TabIcon } from "./TabIcon";
import { useSidebarRowLook } from "./rowLook";
import { ARC_SELECTED_INACTIVE, arcSelectedLabel, TABULAR_NUMS, useArcLabel, useArcTitle, useSidebarTokens } from "./tokens";

const liveRowKey = (folderId: string, itemId: string) => `live|${folderId}|${itemId}`;

export function LiveItemRow({ folderId, item, windowId, inStack = false, done }: { folderId: string; item: LiveItem; windowId: string; inStack?: boolean; done?: CompletionState }) {
  const indent = inStack ? STACK_INDENT : 0;
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const arcLabel = useArcLabel();
  const arcTitle = useArcTitle();
  const hidden = useFoldHidden();
  const flat = useAddressBarInSidebar();
  const colors = useLiveColors();
  const subtitle = item.pr?.author || item.subtitle;
  const key = liveRowKey(folderId, item.id);
  const profileId = usePageProfileId();
  const tabId = useLiveItemTab(windowId, profileId, folderId, item.id);
  const active = useIsActiveIn(windowId, profileId, tabId);
  const { closeTabHint } = useSidebarRowLook();
  const unread = useLive((s) => !done && !!s.unread[folderId]?.includes(item.id));
  const completing = useLive((s) => (!done && s.completing[folderId]?.includes(item.id) ? (s.completed[folderId]?.find((c) => c.item.id === item.id)?.state ?? "merged") : null));
  const completion = completing ?? done ?? null;
  const reviewDue = !completion && awaitsReview(item);
  const { hovered, hoverProps } = useRowHover(windowId, completing ? null : { kind: "live", id: key });
  const scope = useContext(ListMotionContext);
  const settled = (live().revisions[folderId] ?? 0) > 1;
  const animates = () => settled && scope.enabled && !hidden;
  const badge = item.pr ? prBadge(item.pr) : null;
  const iconState = completing ? `c:${completing}` : item.pr ? prState(item.pr, done ?? null) : "doc";
  const trailingState = completion ? (flat ? "none" : `c:${completion}`) : badge && badge !== "passed" ? badge : "none";
  const fill = active ? tokens.selectedFill : hovered ? theme.tabHover : ink.clear;
  const label = (completing ? null : arcTitle) ?? (active ? (arcSelectedLabel(arcLabel) ?? theme.tabSelectedText) : completing ? theme.textSecondary : (arcLabel ?? theme.textTab));

  return (
    <View presentationGate>
      <View
        ref={(v) => {
          registerRow(windowId, key, hidden ? null : v);
          if (tabId) registerRow(windowId, tabId, hidden ? null : v);
        }}
        {...hoverProps}
      >
        <ContextMenuArea
          onContextMenu={() => {
            dismissHover();
            void openLiveItemMenu(windowId, folderId, item, tabId);
          }}
        >
          <Pressable
            onPress={(e) => {
              dismissHover();
              openLiveItem(windowId, folderId, item, { background: modifiersOf(e).metaKey });
            }}
          >
            {({ pressed }) => (
              <Surface
                fill={hex(!active && pressed ? theme.tabPressed : fill)}
                inactiveFillOpacity={arcLabel && active ? ARC_SELECTED_INACTIVE : undefined}
                cornerRadius={layout.rowRadius}
                style={{ height: layout.rowHeight, flexDirection: "row", alignItems: "center", paddingLeft: layout.rowPadding + indent, paddingRight: flat ? 7 : 6 }}
              >
                {(unread || reviewDue) && !flat ? <PulseDot color={theme.accent} pulsing={reviewDue} style={{ position: "absolute", left: 2 + indent, width: 5, height: 5 }} /> : null}
                <Morph state={iconState} animates={animates}>
                  <ItemIcon item={item} completing={completing} done={done ?? null} colors={colors} animate={false} />
                </Morph>
                {flat && subtitle ? (
                  <View style={{ flex: 1, marginLeft: layout.rowLabelGap }}>
                    <FadeLabel text={item.title} fontSize={layout.rowFontSize} color={label} transitions={settled} style={{ height: 18 }} />
                    <LiveSubtitle item={item} subtitle={subtitle} done={completion} colors={colors} transitions={settled} />
                  </View>
                ) : (
                  <FadeLabel
                    text={item.title}
                    fontSize={layout.rowFontSize}
                    weight={unread && !flat ? "medium" : undefined}
                    color={label}
                    transitions={settled}
                    style={{ flex: 1, height: 18, marginLeft: layout.rowLabelGap }}
                  />
                )}
                <HoverSlot
                  hovered={hovered && !!tabId && !completing}
                  width={22}
                  hover={<Button variant="icon" icon="xmark" size={10} weight="semibold" box={22} radius={radius.m} onPress={() => tabId && void closeTab(tabId)} tooltip={withShortcut("Close Tab", closeTabHint)} />}
                >
                  {(unread || reviewDue) && flat ? (
                    <Glide x={trailingState === "none" ? 0 : -BADGE_BOX} animates={animates}>
                      <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
                        <PulseDot color={theme.textPrimary} pulsing={reviewDue} style={{ width: 6, height: 6, opacity: 0.9 }} />
                      </View>
                    </Glide>
                  ) : null}
                  <Morph state={trailingState} animates={animates}>
                    <Trailing item={item} completion={completion} colors={colors} flat={flat} />
                  </Morph>
                </HoverSlot>
              </Surface>
            )}
          </Pressable>
        </ContextMenuArea>
      </View>
    </View>
  );
}

type PrState = "open" | "draft" | "merged" | "closed";

const PR_STATES: Record<PrState, { icon: ImageSourcePropType; color: keyof LiveColors }> = {
  open: { icon: require("../../../assets/octicons/git-pull-request.png"), color: "stateOpen" },
  draft: { icon: require("../../../assets/octicons/git-pull-request-draft.png"), color: "stateDraft" },
  merged: { icon: require("../../../assets/octicons/git-merge.png"), color: "stateMerged" },
  closed: { icon: require("../../../assets/octicons/git-pull-request-closed.png"), color: "stateClosed" },
};

const prState = (pr: PullRequestInfo, done: CompletionState | null): PrState => (done === "merged" || done === "closed" ? done : pr.draft ? "draft" : "open");

const STATE_WORDS: Record<CompletionState, string> = { merged: "Merged", closed: "Closed", reviewed: "Reviewed" };

const glyphUri = (source: number) => Image.resolveAssetSource(source).uri;

const META_GLYPHS = {
  stack: glyphUri(require("../../../assets/octicons/stack.svg")),
  success: glyphUri(require("../../../assets/octicons/check.svg")),
  pending: glyphUri(require("../../../assets/octicons/dot-fill.svg")),
  failure: glyphUri(require("../../../assets/octicons/x.svg")),
};

const CHECK_GLYPHS: Record<"success" | "pending" | "failure", { color: keyof LiveColors; label: string }> = {
  success: { color: "success", label: "Checks passed" },
  pending: { color: "pending", label: "Checks pending" },
  failure: { color: "failure", label: "Checks failing" },
};

const GLYPH = "\uFFFC";

function prMeta(pr: PullRequestInfo, done: CompletionState | null, answered: boolean, colors: LiveColors): { text: string; glyphs: FadeLabelGlyph[] } {
  const parts = [`#${pr.number}`, pr.author];
  const glyphs: FadeLabelGlyph[] = [];
  const age = githubAge(pr.createdAt);
  if (age) parts.push(age);
  if (pr.stack && !done) {
    parts.push(`${GLYPH} ${pr.stack.position}/${pr.stack.size}`);
    glyphs.push({ image: META_GLYPHS.stack, label: "Stack" });
  }
  const word = done ? STATE_WORDS[done] : answered ? STATE_WORDS.reviewed : pr.draft ? "Draft" : null;
  if (word) parts.push(word);
  const checks = summarizeChecks(pr.checks);
  if (checks && checks.tone !== "neutral" && !(done && checks.tone === "pending")) {
    parts.push(`${GLYPH} ${checks.counts.success}/${pr.checks.length}`);
    glyphs.push({ image: META_GLYPHS[checks.tone], color: colors[CHECK_GLYPHS[checks.tone].color], label: CHECK_GLYPHS[checks.tone].label });
  }
  return { text: parts.join(" · "), glyphs };
}

export function LiveSubtitle({ item, subtitle, done, colors, transitions = false }: { item: LiveItem; subtitle: string; done: CompletionState | null; colors: LiveColors; transitions?: boolean }) {
  const theme = useTheme();
  const meta = item.pr ? prMeta(item.pr, done, reviewAnswered(item), colors) : null;
  return <FadeLabel text={meta?.text ?? subtitle} glyphs={meta?.glyphs} fontSize={12} color={theme.textSecondary} transitions={transitions} style={{ height: 14 }} />;
}

export const COMPLETION_GLYPH: Record<CompletedItem["state"], { symbol: string; color: keyof LiveColors }> = {
  merged: { symbol: "checkmark.circle.fill", color: "merged" },
  reviewed: { symbol: "checkmark.circle.fill", color: "success" },
  closed: { symbol: "xmark.circle.fill", color: "draft" },
};

export function ItemIcon({
  item,
  completing,
  done = null,
  colors,
  animate = true,
}: {
  item: LiveItem;
  completing: CompletionState | null;
  done?: CompletionState | null;
  colors: LiveColors;
  animate?: boolean;
}) {
  const pop = useRef(new Animated.Value(completing && animate ? 0 : 1)).current;
  useEffect(() => {
    if (!completing || !animate) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, speed: 14, bounciness: 14, useNativeDriver: true }).start();
  }, [completing]);
  if (completing) {
    const glyph = COMPLETION_GLYPH[completing];
    return (
      <Animated.View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center", transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
        <Symbol name={glyph.symbol} size={14} weight="semibold" color={colors[glyph.color]} style={{ width: 16, height: 16 }} />
      </Animated.View>
    );
  }
  if (item.pr) {
    const state = PR_STATES[prState(item.pr, done)];
    return <Image key={colors[state.color]} source={state.icon} accessible={false} style={{ width: 16, height: 16, tintColor: colors[state.color] }} />;
  }
  if (item.icon && /^https?:/.test(item.icon)) return <TabIcon url={item.url} favicon={item.icon} direct />;
  return <TabIcon url={item.source === "confluence" && !item.icon ? SOURCES.confluence.site : item.url} icon={item.icon} />;
}

const PENDING_PERIOD = 3;
export const BADGE_BOX = 22;

const BADGES: Record<Exclude<NonNullable<ReturnType<typeof prBadge>>, "passed">, { symbol: string | null; color: keyof LiveColors; tip: string | ((pr: PullRequestInfo) => string) }> = {
  conflict: { symbol: "exclamationmark.triangle.fill", color: "conflict", tip: "Merge conflicts" },
  failing: { symbol: "xmark.circle.fill", color: "failure", tip: "Checks are failing" },
  changesRequested: { symbol: "arrow.uturn.backward.circle.fill", color: "failure", tip: "Changes Requested" },
  unresolved: { symbol: "text.bubble.fill", color: "unresolved", tip: (pr) => (pr.unresolvedThreads === 1 ? "1 unresolved conversation" : `${pr.unresolvedThreads} unresolved conversations`) },
  pending: { symbol: null, color: "pending", tip: "Some checks haven't completed yet" },
  approved: { symbol: "checkmark.seal.fill", color: "success", tip: "Approved" },
};

export function Trailing({ item, completion, colors, flat }: { item: LiveItem; completion: CompletedItem["state"] | null; colors: LiveColors; flat: boolean }): ReactNode {
  if (completion) {
    if (flat) return null;
    return <Text style={{ fontSize: 11, fontWeight: "500", color: colors[COMPLETION_GLYPH[completion].color], marginRight: 4 }}>{completion === "merged" ? "Merged" : completion === "reviewed" ? "Reviewed" : "Closed"}</Text>;
  }
  if (!item.pr) return null;
  const badge = prBadge(item.pr);
  if (!badge || badge === "passed") return null;
  const spec = BADGES[badge];
  return (
    <View tooltip={typeof spec.tip === "string" ? spec.tip : spec.tip(item.pr)} style={{ width: BADGE_BOX, height: BADGE_BOX, alignItems: "center", justifyContent: "center" }}>
      {spec.symbol ? (
        <Symbol name={spec.symbol} size={11} weight="semibold" color={colors[spec.color]} style={{ width: 16, height: 16 }} />
      ) : (
        <ActivitySpinner visible color={colors[spec.color]} period={PENDING_PERIOD} style={{ width: 12, height: 12 }} />
      )}
    </View>
  );
}
