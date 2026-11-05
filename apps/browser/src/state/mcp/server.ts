import { create } from "zustand";
import { mcpAvailable, mcpPort, onMcpRequest, onMcpStatus, respondToMcp, startMcpListener, stopMcpListener, type McpListenerStatus } from "../../platform/mcp";
import { systemInfo } from "../../platform/app";
import { useBrowser } from "../browser/store";
import { answerMcp, type McpReply } from "./protocol";
import { callTool, hasTool, toolList } from "./tools";

export type McpServerStatus = "starting" | McpListenerStatus;

export const useMcpServer = create<{ status: McpServerStatus }>()(() => ({ status: "off" }));

const setStatus = (status: McpServerStatus) => useMcpServer.setState({ status });

export { mcpPort };

export const mcpUrl = () => `http://127.0.0.1:${mcpPort()}/mcp`;

export const mcpSetupCommand = () => `claude mcp add --transport http ardia ${mcpUrl()}`;

function reply(body: string): McpReply {
  try {
    return answerMcp(body, { version: systemInfo().appVersion, tools: toolList, hasTool, call: callTool });
  } catch (e) {
    console.warn("[mcp] request failed", e);
    return { status: 500, body: JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } }) };
  }
}

let started = false;

export function startMcpServer() {
  if (started || !mcpAvailable()) return;
  started = true;
  let applied: boolean | null = null;
  let generation = 0;
  onMcpRequest(({ id, body }) => {
    const { status, body: answer } = reply(body);
    respondToMcp(id, status, answer);
  });
  onMcpStatus(({ status }) => {
    if (applied && status !== "off") setStatus(status);
  });
  const sync = () => {
    const on = useBrowser.getState().settings.mcpServer;
    if (on === applied) return;
    applied = on;
    const mine = ++generation;
    if (!on) {
      stopMcpListener();
      return setStatus("off");
    }
    setStatus("starting");
    void startMcpListener().then(
      (status) => mine === generation && setStatus(status),
      () => mine === generation && setStatus("failed"),
    );
  };
  sync();
  useBrowser.subscribe(sync);
}
