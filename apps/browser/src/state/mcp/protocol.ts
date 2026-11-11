import type { ToolResult } from "./tools";

export type McpReply = { status: number; body: string };

export type McpHandlers = {
  version: string;
  tools: () => unknown[];
  hasTool: (name: string) => boolean;
  call: (name: string, args: Record<string, unknown>) => ToolResult;
};

type Id = string | number | null;
type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const DEFAULT_VERSION = "2025-06-18";

const INSTRUCTIONS =
  "Ardia's spaces are its profiles. Use list_spaces and list_tabs to read them. You can open, close, rename, move and show unpinned tabs, and make, rename, nest, move and delete unpinned folders. Pinned and unpinned folders can have their icons set with set_folder_icon; list_folder_icons names the values. Pinned tabs and pinned folders can be renamed, reordered, nested and moved to other spaces, but never closed, deleted or unpinned; a call that would do any of that changes nothing. pin_tab, add_favorite and moving tabs or folders into the pinned section add new pins. Favorites, favorite folders, live folders and live-folder tabs are locked: you can show the tabs and add_favorite adds new favorites at the end, but nothing changes, moves or removes an existing one. Air Traffic Control decides which space a link opens in: list_link_rules reads its ordered rules (first match wins) and the default for links from other apps; add_link_rule, update_link_rule, move_link_rule, delete_link_rule and set_default_link_destination change them, as Settings › Links does.";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const result = (id: Id, value: unknown) => ({ jsonrpc: "2.0", id, result: value });
const error = (id: Id, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

function answer(m: unknown, h: McpHandlers): object | null {
  if (!isObject(m)) return error(null, -32600, "Invalid request");
  const message = m as Message;
  const id: Id = typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
  if (message.jsonrpc !== "2.0") return error(id, -32600, "Invalid request");
  if (message.method === undefined) return null;
  if (typeof message.method !== "string") return error(id, -32600, "Invalid request");
  if (!("id" in message)) return null;
  if (id === null) return error(null, -32600, "Invalid request id");
  const params = isObject(message.params) ? message.params : {};
  switch (message.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      const protocolVersion = typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked) ? asked : DEFAULT_VERSION;
      return result(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ardia", title: "Ardia", version: h.version },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: h.tools() });
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string" || !h.hasTool(name)) return error(id, -32602, `Unknown tool: ${String(name)}`);
      if (params.arguments !== undefined && !isObject(params.arguments)) return error(id, -32602, "arguments must be an object");
      const done = h.call(name, (params.arguments as Record<string, unknown> | undefined) ?? {});
      return result(id, { content: [{ type: "text", text: done.text }], ...(done.isError ? { isError: true } : {}) });
    }
    default:
      return error(id, -32601, `Method not found: ${message.method}`);
  }
}

export function answerMcp(body: string, h: McpHandlers): McpReply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { status: 400, body: JSON.stringify(error(null, -32700, "Parse error")) };
  }
  if (Array.isArray(parsed)) {
    if (!parsed.length) return { status: 400, body: JSON.stringify(error(null, -32600, "Empty batch")) };
    const replies = parsed.map((m) => answer(m, h)).filter((r) => r !== null);
    return replies.length ? { status: 200, body: JSON.stringify(replies) } : { status: 202, body: "" };
  }
  const reply = answer(parsed, h);
  return reply ? { status: 200, body: JSON.stringify(reply) } : { status: 202, body: "" };
}
