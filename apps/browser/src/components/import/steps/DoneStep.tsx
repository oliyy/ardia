import { useEffect, useMemo, useRef } from "react";
import { Animated, View } from "react-native";
import { allArcHolders, restoreArcFolders } from "../../../state/bookmarks/bookmarkGroups";
import { useBookmarks } from "../../../state/bookmarks/hooks";
import { plural } from "../../../state/browser/model";
import { useProfileOrder, useProfileRecords } from "../../../state/profiles/hooks";
import { openInWebStore, type ImportCounts } from "../../../state/import/apply";
import { useExtensionInstalls, type ExtensionInstall } from "../../../state/import/extensions";
import { backTo, closeImport, type ImportFlow } from "../../../state/import/flow";
import { Button, space, Symbol, Text, useTheme } from "../../ui";
import { kindTitle } from "../model";
import { Spacer, Title } from "../Parts";
import { ExtensionRow } from "../Rows";
import { importColors, importLayout, importMotion, importType } from "../tokens";

function summaryOf(counts: ImportCounts) {
  return [
    counts.bookmarks && plural(counts.bookmarks, "bookmark"),
    counts.history && plural(counts.history, "history item"),
    counts.passwords && plural(counts.passwords, "password"),
    counts.cookies && plural(counts.cookies, "cookie"),
    counts.addresses && `${counts.addresses} ${counts.addresses === 1 ? "address" : "addresses"}`,
    counts.cards && plural(counts.cards, "card"),
    counts.tabs && plural(counts.tabs, "tab"),
  ].filter(Boolean) as string[];
}

function extensionsHeading(installs: ExtensionInstall[], browser: string): string {
  const installing = installs.filter((e) => e.state === "installing").length;
  return installing ? `Installing ${plural(installing, "extension")} from ${browser}...` : `Extensions from ${browser}`;
}

function ExtensionList({ flow }: { flow: ImportFlow }) {
  const installs = useExtensionInstalls((s) => s.list);
  if (!installs.length) return null;
  return (
    <View style={{ alignSelf: "stretch", marginTop: space.lx, gap: space.s }}>
      <Text size="small" weight="semibold" tone="textSecondary">
        {extensionsHeading(installs, flow.source?.name ?? "your browser")}
      </Text>
      {installs.map((e) => (
        <ExtensionRow key={`${e.profileId}:${e.id}`} install={e} onOpen={() => openInWebStore(e.profileId, [e.webStoreUrl])} />
      ))}
      <Text size="small" tone="textTertiary" style={{ lineHeight: importType.smallLine }}>
        Their settings don't come over: sign in to them again where needed.
      </Text>
    </View>
  );
}

function LeftBehind({ notes, failed }: { notes: string[]; failed: boolean }) {
  if (!notes.length) return null;
  return (
    <Text size="small" tone="textTertiary" style={{ lineHeight: importType.smallLine, marginTop: space.ml, textAlign: failed ? "left" : "center" }}>
      {notes.join(" ")}
    </Text>
  );
}

function RestoreArcFolders() {
  const bookmarks = useBookmarks((b) => b);
  const profiles = useProfileRecords();
  const profileOrder = useProfileOrder();
  const arcHolders = useMemo(() => allArcHolders({ bookmarks, profiles, profileOrder }), [bookmarks, profiles, profileOrder]);
  if (!arcHolders.length) return null;
  return (
    <Button
      title="Restore Arc Folders as Groups"
      onPress={() => {
        for (const id of arcHolders) restoreArcFolders(id, null);
      }}
    />
  );
}

export function DoneBody({ flow }: { flow: ImportFlow }) {
  const { step } = flow;
  const hasInstalls = useExtensionInstalls((s) => s.list.length > 0);
  if (step.name !== "done") return null;
  const { counts, failures, notes } = step;
  const summary = summaryOf(counts);
  if (failures.length)
    return (
      <>
        <Title title={summary.length ? "Partially imported" : "Import failed"} subtitle="Only some of your data imported. Please try again!" />
        <Text weight="semibold" style={{ marginBottom: space.s }}>
          Some import steps failed:
        </Text>
        {failures.map((f) => (
          <Text key={f.kind} tone="textSecondary" style={{ marginBottom: 3 }}>
            {f.profiles.length ? `${kindTitle(f.kind)} import failed for profiles ${f.profiles.join(", ")}` : `${kindTitle(f.kind)} import failed`}
          </Text>
        ))}
        {summary.length > 0 && <Text size="small" tone="textSecondary" style={{ marginTop: space.l }}>{`Imported ${summary.join(", ")}.`}</Text>}
        <LeftBehind notes={notes} failed />
        <ExtensionList flow={flow} />
        <Text size="small" tone="textTertiary" style={{ marginTop: space.l }}>
          You can retry the import later from the app menu.
        </Text>
      </>
    );
  return (
    <View style={{ alignItems: "center", marginTop: importLayout.doneTop, gap: space.l }}>
      <SuccessMark />
      <Text weight="semibold" style={{ fontSize: importType.done }}>
        You're all set
      </Text>
      {summary.length || !hasInstalls ? (
        <Text tone="textSecondary" style={{ textAlign: "center" }}>
          {summary.length ? `Imported ${summary.join(", ")}.` : "There was nothing new to import."}
        </Text>
      ) : null}
      <LeftBehind notes={notes} failed={false} />
      <ExtensionList flow={flow} />
      <RestoreArcFolders />
    </View>
  );
}

export function DoneFooter({ flow }: { flow: ImportFlow }) {
  const failed = flow.step.name === "done" && flow.step.failures.length > 0;
  return (
    <>
      <Spacer />
      {failed && <Button title="Try Again" onPress={() => backTo("choose")} />}
      <Button title={failed ? "Continue" : "Finish importing"} kind="primary" onPress={closeImport} />
    </>
  );
}

function SuccessMark() {
  const theme = useTheme();
  const { success } = importMotion;
  const scale = useRef(new Animated.Value(success.from)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: success.friction, tension: success.tension, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Symbol name="checkmark.circle.fill" size={46} color={theme.success} style={{ width: 60, height: 60 }} />
    </Animated.View>
  );
}
