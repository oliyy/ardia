import { Button, Toggle } from "../../ui";
import { updateSettings } from "../../../state/settings/actions";
import { useSettings } from "../../../state/browser/hooks";
import { useMcpStatus } from "../../../state/mcp/hooks";
import { copyMcpSetupCommand, mcpPort, mcpSetupCommand, mcpUrl } from "../../../state/mcp/actions";
import type { McpServerStatus } from "../../../state/mcp/server";
import { Group, Row, SectionHeader } from "../Form";

const SECTION_COPY = "Agents can open, close, move and show your unpinned tabs and folders. Your pinned tabs and favorites stay as they are.";

function statusLine(status: McpServerStatus): string | undefined {
  if (status === "listening") return `On at ${mcpUrl()}`;
  if (status === "starting") return "Starting…";
  if (status === "inUse") return `Port ${mcpPort()} is in use`;
  if (status === "failed") return "The server couldn't start";
  return undefined;
}

export function McpServerSection() {
  const on = useSettings((s) => s.mcpServer);
  const status = useMcpStatus();
  return (
    <>
      <SectionHeader title="MCP Server" description={SECTION_COPY} />
      <Group>
        <Row anchor="general.mcpServer" description={on ? statusLine(status) : undefined}>
          <Toggle value={on} onChange={(v) => updateSettings({ mcpServer: v })} />
        </Row>
        <Row anchor="general.mcpSetup" description={mcpSetupCommand()}>
          <Button title="Copy Setup Command" onPress={copyMcpSetupCommand} />
        </Row>
      </Group>
    </>
  );
}
