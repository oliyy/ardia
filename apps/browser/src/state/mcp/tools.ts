import { useBrowser } from "../browser/store";
import { tabTitle } from "../browser/model";
import { folderName, addFavorite, createFolder, moveFolder, moveTabs, openTab, pinTab, tabName, type Args, type Change } from "./writes";
import { editableTab, folderIn, keepsPins, listSpaces, listTabs, McpToolError, resolveSpace, tabIn, unpinnedFolder, unpinnedTabs } from "./spaces";

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
const FOLDER_ID = { type: "string", description: "A folder id from list_tabs" };
const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const store = () => useBrowser.getState();

function change(apply: (s: ReturnType<typeof store>, a: Args) => Change) {
  return (a: Args) => {
    const s = store();
    const [next, result, movedFolders] = apply(s, a);
    keepsPins(s, next, movedFolders);
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
      "Lists one space's favorites, pinned tabs and pinned folders, and unpinned tabs and folders, in sidebar order. Pinned tabs and folders are marked pinned: they can be renamed and moved, even to another space, but never closed, deleted or unpinned. Favorites and live-folder tabs are marked locked: they can be read and shown but never changed.",
    inputSchema: schema({ space: SPACE }),
    annotations: READ,
    run: (a) => listTabs(store(), resolveSpace(store(), a.space)),
  },
  {
    name: "open_tab",
    title: "Open tab",
    description: "Opens a new tab, unpinned or inside a folder. Opening it in a pinned folder makes it a new pin.",
    inputSchema: schema(
      {
        url: { type: "string", description: "An http or https URL" },
        space: SPACE,
        folder: { type: "string", description: "A folder id to open it in, pinned or unpinned" },
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
    description: "Closes unpinned tabs. They can be reopened from Recently Closed. Refuses pinned tabs, favorites and live-folder tabs, and then closes nothing.",
    inputSchema: schema({ ids: IDS }, ["ids"]),
    annotations: { ...WRITE, destructiveHint: true },
    run: (a) => {
      const ids = unpinnedTabs(store(), a.ids).map((t) => t.id);
      store().closeTabs(ids);
      return { closed: ids };
    },
  },
  {
    name: "rename_tab",
    title: "Rename tab",
    description: "Gives a pinned or unpinned tab a custom name, as the sidebar's Rename does; an empty name goes back to the page title. Favorites and live-folder tabs can't be renamed.",
    inputSchema: schema({ id: { type: "string" }, name: { type: "string", description: "The new name, or empty to use the page title" } }, ["id", "name"]),
    annotations: { ...WRITE, idempotentHint: true },
    run: (a) => {
      const tab = editableTab(store(), a.id);
      const name = tabName(a.name);
      store().updateTab(tab.id, { customTitle: name && name !== tab.title ? name : null });
      return { renamed: tab.id, title: tabTitle(store().tabs[tab.id] ?? tab) };
    },
  },
  {
    name: "move_tabs",
    title: "Move tabs",
    description:
      "Moves tabs into a folder, out of folders, to another position, or to another space. Unpinned tabs can go anywhere; moving them into a pinned folder or the pinned list pins them. Pinned tabs can only go to a pinned folder or the pinned list (pinned: true), in this space or another, never back to unpinned. Refuses favorites and live-folder tabs, and on any refusal moves nothing.",
    inputSchema: schema(
      {
        ids: IDS,
        folder: { type: ["string", "null"], description: "The folder to move them into, pinned or unpinned; null or left out puts them outside any folder" },
        pinned: { type: "boolean", description: "With no folder: true puts them in the space's pinned list, false (the default) among its unpinned tabs" },
        space: SPACE,
        index: { type: "integer", minimum: 0, description: "Position among the folder's tabs, the pinned list's tabs, or the space's unpinned tabs; the end when left out" },
      },
      ["ids"],
    ),
    annotations: WRITE,
    run: change(moveTabs),
  },
  {
    name: "create_folder",
    title: "Create folder",
    description:
      "Makes a new folder holding the given tabs (a folder can't be empty), at the top level or inside a parent folder. Inside a pinned parent, or with pinned: true, the folder is pinned and unpinned tabs given to it become pins. Pinned tabs can only go into a pinned folder.",
    inputSchema: schema(
      {
        name: { type: "string" },
        ids: IDS,
        space: SPACE,
        parent: { ...FOLDER_ID, description: "A folder to make it inside; the top level when left out" },
        pinned: { type: "boolean", description: "With no parent: true makes a pinned folder, false (the default) an unpinned one" },
      },
      ["name", "ids"],
    ),
    annotations: WRITE,
    run: change(createFolder),
  },
  {
    name: "move_folder",
    title: "Move folder",
    description:
      "Moves a folder, with its subfolders and tabs, to another space, into another folder, out to the top level, or to another position. A pinned folder stays pinned: it can go into a pinned folder or the pinned section, in this space or another, never into an unpinned folder or the unpinned section. An unpinned folder moved into a pinned folder or with pinned: true becomes pinned. Moving to another space gives the folder a new id, returned as folder.",
    inputSchema: schema(
      {
        id: FOLDER_ID,
        space: SPACE,
        parent: { type: ["string", "null"], description: "A folder to move it into, or null for the top level of its section; left out keeps its parent within the space, and the top level in another space" },
        pinned: { type: "boolean", description: "At the top level: true for the pinned section, false for the unpinned one; left out keeps its section" },
        index: { type: "integer", minimum: 0, description: "Position among the destination's folders and tabs; the end when left out" },
      },
      ["id"],
    ),
    annotations: WRITE,
    run: change(moveFolder),
  },
  {
    name: "rename_folder",
    title: "Rename folder",
    description: "Renames a pinned or unpinned folder.",
    inputSchema: schema({ id: FOLDER_ID, name: { type: "string" } }, ["id", "name"]),
    annotations: { ...WRITE, idempotentHint: true },
    run: (a) => {
      const folder = folderIn(store(), a.id);
      const name = folderName(a.name);
      store().updateGroup(folder.id, { name });
      return { renamed: folder.id, name };
    },
  },
  {
    name: "delete_folder",
    title: "Delete folder",
    description: "Removes an unpinned folder and keeps its tabs, outside any folder. Pinned folders can't be deleted.",
    inputSchema: schema({ id: FOLDER_ID }, ["id"]),
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
    description: "Makes a new pinned tab at the end of the space's pinned list, from an unpinned tab or a URL. To move an existing pin, use move_tabs.",
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
