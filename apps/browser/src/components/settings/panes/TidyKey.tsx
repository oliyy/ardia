import { useState } from "react";
import { View } from "react-native";
import { useTidyKey } from "../../../state/tidy/hooks";
import { removeTidyKey, saveTidyKey } from "../../../state/tidy/tidyKey";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { Box, Button, Sheet, Text, TextField } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";

export function TidyKeySection() {
  const saved = useTidyKey();
  return (
    <>
      <SectionHeader title="Tidy" />
      <Group>
        <Row anchor="tabs.openRouterKey">
          {saved ? (
            <Button title="Remove" onPress={() => void removeTidyKey()} />
          ) : (
            <Button title="Add Key…" onPress={() => showSettingsSheet(<TidyKeySheet />)} />
          )}
        </Row>
      </Group>
    </>
  );
}

function TidyKeySheet() {
  const [key, setKey] = useState("");
  const [failed, setFailed] = useState(false);
  const save = () => {
    if (!key.trim()) return;
    void saveTidyKey(key).then((ok) => (ok ? closeSettingsSheet() : setFailed(true)));
  };
  return (
    <Sheet width={420} onClose={closeSettingsSheet}>
      <Text size="heading" weight="semibold">OpenRouter API Key</Text>
      <Text size="small" tone="textSecondary" style={{ marginTop: 6 }}>Create a key at openrouter.ai › Keys and paste it here. Each Tidy is billed to it.</Text>
      <View style={{ marginTop: 12 }}>
        <TextField value={key} onChangeText={(text) => (setKey(text), setFailed(false))} placeholder="sk-or-…" secure autoFocus onSubmit={save} onEscape={closeSettingsSheet} />
      </View>
      {failed && <Text size="small" tone="destructive" style={{ marginTop: 10 }}>Couldn't save the key to your keychain.</Text>}
      <Box row gap="m" style={{ marginTop: 18 }}>
        <View style={{ flex: 1 }} />
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title="Save" kind="primary" disabled={!key.trim()} onPress={save} />
      </Box>
    </Sheet>
  );
}
