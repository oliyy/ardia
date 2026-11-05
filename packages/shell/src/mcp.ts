import type { EventSubscription } from "expo-modules-core";

export type McpListenerStatus = "listening" | "inUse" | "failed" | "off";

export type McpNative = {
  port: number;
  start(): Promise<McpListenerStatus>;
  stop(): void;
  respond(id: string, status: number, body: string): void;
  addListener(name: "onRequest", listener: (e: { id: string; body: string }) => void): EventSubscription;
  addListener(name: "onStatus", listener: (e: { status: McpListenerStatus }) => void): EventSubscription;
};
