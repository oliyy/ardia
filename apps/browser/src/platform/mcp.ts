import { requireOptionalNativeModule } from "expo-modules-core";
import type { McpListenerStatus, McpNative } from "@ardia/shell";

export type { McpListenerStatus };

const Mcp = requireOptionalNativeModule<McpNative>("ArdiaMcp");

export const mcpAvailable = () => !!Mcp;
export const mcpPort = () => Mcp?.port ?? 53815;
export const startMcpListener = (): Promise<McpListenerStatus> => Mcp?.start() ?? Promise.resolve("failed");
export const stopMcpListener = () => Mcp?.stop();
export const respondToMcp = (id: string, status: number, body: string) => Mcp?.respond(id, status, body);
export const onMcpRequest = (listener: (e: { id: string; body: string }) => void) => Mcp?.addListener("onRequest", listener);
export const onMcpStatus = (listener: (e: { status: McpListenerStatus }) => void) => Mcp?.addListener("onStatus", listener);
