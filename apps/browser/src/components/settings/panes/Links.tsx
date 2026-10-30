import { View } from "react-native";
import { useTheme } from "../../ui/theme";
import { useProfiles, useSettings } from "../../../state/browser/hooks";
import { LITTLE_DESTINATION, RECENT_DESTINATION, type LinkDestination, type LinkRule } from "../../../state/settings/linkRouting";
import { addLinkRule, changeLinkRule, removeLinkRule, setDefaultLinkDestination } from "../../../state/settings/linkRoutingActions";
import { Button, PopUp, Symbol, TextField, type Option } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";

const MATCH_OPTIONS: Option<LinkRule["match"]>[] = [
  { value: "contains", title: "Contains" },
  { value: "equals", title: "Is equal to" },
];

const destinationValue = (d: LinkDestination) => (d.kind === "profile" ? `profile:${d.profileId}` : d.kind);

const destinationFrom = (value: string): LinkDestination =>
  value === "little" ? LITTLE_DESTINATION : value === "recent" ? RECENT_DESTINATION : { kind: "profile", profileId: value.slice("profile:".length) };

export function useLinkDestinationOptions(): Option<string>[] {
  const profiles = useProfiles();
  return [
    ...profiles.map((p) => ({ value: `profile:${p.id}`, title: p.name })),
    { value: "recent", title: "Most Recent Profile", separatorBefore: true },
    { value: "little", title: "Little Ardia" },
  ];
}

export function LinkDefaultPopUp({ minWidth = 190 }: { minWidth?: number }) {
  const value = useSettings((s) => destinationValue(s.linkRouting.defaultDestination));
  const options = useLinkDestinationOptions();
  return <PopUp value={value} options={options} onChange={(v) => setDefaultLinkDestination(destinationFrom(v))} minWidth={minWidth} />;
}

export function LinksPane() {
  const rules = useSettings((s) => s.linkRouting.rules);
  const options = useLinkDestinationOptions();

  return (
    <View>
      <SectionHeader
        anchor="links.routes"
        description="A link that matches a route opens there instead. The first matching route wins."
        action={<Button title="New Route" icon="plus" onPress={addLinkRule} />}
      />
      <Group>
        {rules.length === 0 ? (
          <Row title="No routes" description="Add one to open matching links in a profile or in Little Ardia." />
        ) : (
          rules.map((rule) => <RouteRow key={rule.id} rule={rule} options={options} />)
        )}
      </Group>

      <SectionHeader title="Links from other apps" description="Where a link from another app opens when no route matches it." />
      <Group>
        <Row anchor="links.otherApps">
          <LinkDefaultPopUp />
        </Row>
      </Group>
    </View>
  );
}

function RouteRow({ rule, options }: { rule: LinkRule; options: Option<string>[] }) {
  const theme = useTheme();
  const change = (patch: Partial<Omit<LinkRule, "id">>) => changeLinkRule(rule.id, patch);
  return (
    <View style={{ minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <PopUp value={rule.match} options={MATCH_OPTIONS} onChange={(match) => change({ match })} minWidth={106} />
      <TextField value={rule.text} onChangeText={(text) => change({ text })} placeholder="example.com" style={{ flex: 1 }} />
      <Symbol name="arrow.right" size={11} weight="semibold" color={theme.textTertiary} style={{ width: 14, height: 14 }} />
      <PopUp value={destinationValue(rule.destination)} options={options} onChange={(v) => change({ destination: destinationFrom(v) })} minWidth={150} />
      <Button variant="icon" icon="trash" size={12} box={24} radius={6} onPress={() => removeLinkRule(rule.id)} tooltip="Remove Route" />
    </View>
  );
}
