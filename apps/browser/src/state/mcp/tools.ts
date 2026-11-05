import { useBrowser } from "../browser/store";
import { folderName, addFavorite, createFolder, moveTabs, openTab, pinTab, type Args, type Change } from "./writes";
import { listSpaces, listTabs, McpToolError, resolveSpace, tabIn, unpinnedFolder, unpinnedTabs } from "./spaces";

export type ToolResult = { text: string; isError?: true };

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: false };
  run: (a: Args) => unknown;
};

const SPACE = { type: "string", description: "A space id or name from list_spaces; the front window's space when left out" };
const IDS = { type: "array", items: { type: "string" }, minItems: 1, description: "Tab ids from list_tabs" };
const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const store = () => useBrowser.getState();

function change(apply: (s: ReturnType<typeof store>, a: Args) => Change) {
  return (a: Args) => {
    const s = store();
    const [next, result] = apply(s, a);
    if (next !== s) useBrowser.setState(next);
    return result;
  };
}

const schema = (properties: Record<string, unknown>, required: string[] = []): Tool["inputSchema"] => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

export const TOOLS: Tool[] = [
  {
    name: "list_spaces",
    title: "List spaces",
    description: "Lists the spaces (profiles) with their tab counts and which one the front window shows.",
    inputSchema: schema({}),
    annotations: READ,
    run: () => ({ spaces: listSpaces(store()) }),
  },
  {
    name: "list_tabs",
    title: "List tabs",
    description:
      "Lists one space's favorites, pinned tabs and pinned folders, and unpinned tabs and folders, in sidebar order. Favorites and pinned items are marked locked: they can be read and activated but never changed.",
    inputSchema: schema({ space: SPACE }),
    annotations: READ,
    run: (a) => listTabs(store(), resolveSpace(store(), a.space)),
  },
  {
    name: "open_tab",
    title: "Open tab",
    description: "Opens a new unpinned tab, optionally inside an unpinned folder.",
    inputSchema: schema(
      {
        url: { type: "string", description: "An http or https URL" },
        space: SPACE,
        folder: { type: "string", description: "An unpinned folder id to open it in" },
        background: { type: "boolean", description: "Leave the shown tab in front (default true)" },
      },
      ["url"],
    ),
    annotations: WRITE,
    run: change(openTab),
  },
  {
    name: "close_tabs",
    title: "Close tabs",
    description: "Closes unpinned tabs. They can be reopened from Recently Closed. Refuses favorites and pinned tabs, and then closes nothing.",
    inputSchema: schema({ ids: IDS }, ["ids"]),
    annotations: { ...WRITE, destructiveHint: true },
    run: (a) => {
      const ids = unpinnedTabs(store(), a.ids).map((t) => t.id);
      store().closeTabs(ids);
      return { closed: ids };
    },
  },
  {
    name: "move_tabs",
    title: "Move tabs",
    description:
      "Moves unpinned tabs into an unpinned folder, out of folders, to another position, or to another space's unpinned tabs. Refuses favorites, pinned tabs and pinned folders, and then moves nothing.",
    inputSchema: schema(
      {
        ids: IDS,
        folder: { type: ["string", "null"], description: "The unpinned folder to move them into; null or left out puts them outside any folder" },
        space: SPACE,
        index: { type: "integer", minimum: 0, description: "Position among the folder's tabs, or among the space's unpinned tabs; the end when left out" },
      },
      ["ids"],
    ),
    annotations: WRITE,
    run: change(moveTabs),
  },
  {
    name: "create_folder",
    title: "Create folder",
    description: "Makes a new unpinned folder holding the given unpinned tabs (a folder can't be empty).",
    inputSchema: schema({ name: { type: "string" }, ids: IDS, space: SPACE }, ["name", "ids"]),
    annotations: WRITE,
    run: change(createFolder),
  },
  {
    name: "rename_folder",
    title: "Rename folder",
    description: "Renames an unpinned folder. Pinned folders can't be renamed.",
    inputSchema: schema({ id: { type: "string" }, name: { type: "string" } }, ["id", "name"]),
    annotations: { ...WRITE, idempotentHint: true },
    run: (a) => {
      const folder = unpinnedFolder(store(), a.id);
      const name = folderName(a.name);
      store().updateGroup(folder.id, { name });
      return { renamed: folder.id, name };
    },
  },
  {
    name: "delete_folder",
    title: "Delete folder",
    description: "Removes an unpinned folder and keeps its tabs, outside any folder. Pinned folders can't be deleted.",
    inputSchema: schema({ id: { type: "string" } }, ["id"]),
    annotations: WRITE,
    run: (a) => {
      const folder = unpinnedFolder(store(), a.id);
      store().ungroup(folder.id);
      return { deleted: folder.id, kept: folder.tabIds };
    },
  },
  {
    name: "activate_tab",
    title: "Show tab",
    description: "Shows a tab in its window, pinned tabs and favorites included. It doesn't bring Ardia to the front.",
    inputSchema: schema({ id: { type: "string" } }, ["id"]),
    annotations: { ...WRITE, idempotentHint: true },
    run: (a) => {
      const tab = tabIn(store(), a.id);
      store().activate(tab.id);
      return { shown: tab.id };
    },
  },
  {
    name: "pin_tab",
    title: "Pin tab",
    description: "Makes a new pinned tab at the end of the space's pinned tabs, from an unpinned tab or a URL. Existing pins never change.",
    inputSchema: schema({ id: { type: "string", description: "An unpinned tab to pin" }, url: { type: "string", description: "A URL to pin as a new tab" }, space: SPACE }),
    annotations: WRITE,
    run: change(pinTab),
  },
  {
    name: "add_favorite",
    title: "Add favorite",
    description: "Adds a new favorite at the end of the space's favorites, from an unpinned tab or a URL. Existing favorites never change.",
    inputSchema: schema({ id: { type: "string", description: "An unpinned tab to make a favorite" }, url: { type: "string", description: "A URL to add as a favorite" }, space: SPACE }),
    annotations: WRITE,
    run: change(addFavorite),
  },
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

export const toolList = () => TOOLS.map(({ run: _, ...tool }) => tool);

export const hasTool = (name: string) => byName.has(name);

export function callTool(name: string, args: Args): ToolResult {
  try {
    return { text: JSON.stringify(byName.get(name)!.run(args)) };
  } catch (e) {
    if (e instanceof McpToolError) return { text: e.message, isError: true };
    return { text: `Ardia hit an error: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}
