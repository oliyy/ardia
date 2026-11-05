import { copyText } from "../app/system";
import { mcpSetupCommand } from "./server";

export { mcpPort, mcpSetupCommand, mcpUrl } from "./server";

export const copyMcpSetupCommand = () => copyText(mcpSetupCommand());
