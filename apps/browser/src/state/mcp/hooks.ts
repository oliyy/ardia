import { useMcpServer } from "./server";

export const useMcpStatus = () => useMcpServer((s) => s.status);
