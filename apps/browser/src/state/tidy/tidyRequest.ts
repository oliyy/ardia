import { endpoints } from "../live/net";
import type { TidyInput, TidyReplyFolder } from "./tidyTabs";

export const TIDY_MODEL = "anthropic/claude-opus-5.5";
const TIMEOUT_MS = 60_000;
const NEW_FOLDER = "new";

export type TidyFailure = "auth" | "http" | "network" | "timeout" | "badReply";

export class TidyError extends Error {
  constructor(
    readonly kind: TidyFailure,
    message: string,
  ) {
    super(message);
  }
}

export const TIDY_PROMPT = [
  "You tidy the tab list of one space in a web browser's sidebar.",
  "You get the space's open tabs in sidebar order (id, title, full URL, and the folder each one is in, if any), the space's folders (id, name, and the titles of their tabs), and the names of its pinned folders, which are only there to show how the owner names things.",
  "Sort the tabs into folders:",
  "- Put a tab into an existing folder, by its id, when it belongs there.",
  `- Make a new folder (folder "${NEW_FOLDER}" with a name) only for two or more tabs that belong together. A single tab joins an existing folder or stays loose.`,
  "- Keep related work together: the same project, task, topic or trip, even across sites.",
  "- Name new folders like the owner's existing folders: short (one to three words), in the same style and capitalization.",
  "- Leave out tabs that are already in the right folder and tabs that fit nowhere. Never use an id you weren't given.",
].join("\n");

export function tidySchema(input: TidyInput) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["folders"],
    properties: {
      folders: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["folder", "name", "tabs"],
          properties: {
            folder: { type: "string", enum: [NEW_FOLDER, ...input.folders.map((f) => f.id)], description: `An existing folder's id, or "${NEW_FOLDER}" for a new folder` },
            name: { type: "string", description: "The new folder's name; empty for an existing folder" },
            tabs: { type: "array", items: { type: "string", enum: input.tabs.map((t) => t.id) } },
          },
        },
      },
    },
  };
}

export function tidyBody(input: TidyInput) {
  const space = {
    tabs: input.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, ...(t.folder ? { folder: t.folder } : {}) })),
    folders: input.folders.map((f) => ({ id: f.id, name: f.name, tabs: f.tabs })),
    pinnedFolders: input.pinnedFolders,
  };
  return {
    model: TIDY_MODEL,
    reasoning: { effort: "medium" },
    messages: [
      { role: "system", content: TIDY_PROMPT },
      { role: "user", content: JSON.stringify(space) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "tidy", strict: true, schema: tidySchema(input) } },
  };
}

function parseReply(body: unknown): TidyReplyFolder[] {
  const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new TidyError("badReply", "No answer");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new TidyError("badReply", "Not JSON");
  }
  const folders = (parsed as { folders?: unknown })?.folders;
  if (!Array.isArray(folders)) throw new TidyError("badReply", "No folders");
  return folders.flatMap((f: unknown) => {
    const { folder, name, tabs } = (f ?? {}) as Record<string, unknown>;
    if (typeof folder !== "string" || !Array.isArray(tabs)) return [];
    return [{ folder: folder === NEW_FOLDER ? null : folder, name: typeof name === "string" ? name : null, tabs: tabs.filter((t): t is string => typeof t === "string") }];
  });
}

export async function requestTidy(key: string, input: TidyInput): Promise<TidyReplyFolder[]> {
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`${endpoints.openRouter}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json", "X-Title": "Ardia" },
        body: JSON.stringify(tidyBody(input)),
        signal: abort.signal,
      });
    } catch {
      throw new TidyError(timedOut ? "timeout" : "network", timedOut ? "Timed out" : "Couldn't connect");
    }
    if (res.status === 401 || res.status === 403) throw new TidyError("auth", String(res.status));
    if (!res.ok) throw new TidyError("http", String(res.status));
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new TidyError(timedOut ? "timeout" : "badReply", timedOut ? "Timed out" : "Not JSON");
    }
    return parseReply(body);
  } finally {
    clearTimeout(timer);
  }
}
