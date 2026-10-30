import { CONFLUENCE_CQL, DRIVE_QUERY, mapBitbucket, mapConfluence, mapDrive, mapNotion, NOTION_SEARCH_BODY, type BitbucketPR, type BitbucketStatuses, type ConfluenceSearch, type DriveFiles, type NotionSearch, type NotionUsers } from "./documents";
import { DETAILS_PAGE, detailIds, detailNodes, finishedStates, GITHUB_DETAILS_QUERY, GITHUB_QUERY, GITHUB_VARIABLES, githubId, mapGithub, stillOpen, VIEWER_QUERY, withDetails, type DetailsResponse, type GithubResponse, type RawPR } from "./github";
import { basic, deleteSecret, endpoints, form, getSecret, request, setSecret } from "./net";
import { live, setAccount, updateConfig } from "./store";
import { LiveError, type CompletionState, type LiveAccount, type LiveFolder, type LiveItem, type LiveSourceId } from "./types";
import { symbolIcon } from "../../lib/customIcon";

export type LiveSource = {
  id: LiveSourceId;
  name: string;
  kind: LiveFolder["kind"];
  site: string;
  fetch(folder: LiveFolder): Promise<LiveItem[]>;
  resolveGone?(items: LiveItem[], folder: LiveFolder): Promise<Record<string, CompletionState>>;
  minInterval?(now: number): number;
  heldUntil?(): number;
};

async function secret(source: LiveSourceId): Promise<string> {
  const value = await getSecret(source);
  if (!value) throw new LiveError(live().accounts[source] ? "signedOut" : "notConfigured", "Not signed in");
  return value;
}

const GITHUB_LOW_BUDGET = 0.1;
const GITHUB_SLOW_MS = 3 * 60_000;
const GITHUB_RETRY_MS = 60_000;
const githubBudget = { limit: 0, remaining: 0, resetAt: 0, heldUntil: 0 };

function noteGithubBudget(headers: Headers) {
  const read = (name: string) => {
    const value = headers.get(name);
    return value === null ? NaN : Number(value);
  };
  const [limit, remaining, reset, retry] = [read("x-ratelimit-limit"), read("x-ratelimit-remaining"), read("x-ratelimit-reset"), read("retry-after")];
  if (limit > 0 && remaining >= 0 && reset > 0) Object.assign(githubBudget, { limit, remaining, resetAt: reset * 1000 });
  if (remaining === 0 && reset > 0) githubBudget.heldUntil = Math.max(githubBudget.heldUntil, reset * 1000);
  if (retry > 0) githubBudget.heldUntil = Math.max(githubBudget.heldUntil, Date.now() + retry * 1000);
}

function holdGithubAfterLimit() {
  const exhausted = githubBudget.limit > 0 && githubBudget.remaining < githubBudget.limit * GITHUB_LOW_BUDGET && githubBudget.resetAt > Date.now();
  githubBudget.heldUntil = Math.max(githubBudget.heldUntil, exhausted ? githubBudget.resetAt : Date.now() + GITHUB_RETRY_MS);
}

async function githubGraphql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  try {
    const json = await request<T & { errors?: { type?: string; message: string }[] }>(
      endpoints.githubGraphql,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) },
      noteGithubBudget,
    );
    const error = json.errors?.[0];
    if (error && !(json as { data?: unknown }).data) throw new LiveError(error.type === "RATE_LIMITED" ? "rateLimited" : "other", error.message);
    return json;
  } catch (error) {
    if (error instanceof LiveError && error.kind === "rateLimited") holdGithubAfterLimit();
    throw error;
  }
}

const githubFilters = (): LiveFolder["filters"] => {
  const folders = Object.values(live().folders).filter((f) => f.sources.includes("github"));
  return {
    authored: folders.some((f) => f.filters.authored),
    reviewRequests: folders.some((f) => f.filters.reviewRequests),
    teamReviewRequests: folders.some((f) => f.filters.teamReviewRequests),
  };
};

const githubTracked = (folderId: string): LiveItem[] => {
  const s = live();
  const completing = s.completing[folderId] ?? [];
  return [...(s.items[folderId] ?? []), ...(s.hidden[folderId] ?? [])].filter((it) => it.source === "github" && !completing.includes(it.id));
};

type GithubFetch = { json: GithubResponse; details: Map<string, RawPR> };

async function fetchGithub(token: string, tracked: string[]): Promise<GithubFetch> {
  const json = await githubGraphql<GithubResponse>(token, GITHUB_QUERY, GITHUB_VARIABLES);
  const ids = detailIds(json, githubFilters(), tracked);
  const pages = Array.from({ length: Math.ceil(ids.length / DETAILS_PAGE) }, (_, i) => ids.slice(i * DETAILS_PAGE, (i + 1) * DETAILS_PAGE));
  const page = async (ids: string[]) => detailNodes(ids, await githubGraphql<DetailsResponse>(token, GITHUB_DETAILS_QUERY, { ids }));
  const retry = (ids: string[]) => (error: unknown) =>
    error instanceof LiveError && (error.kind === "other" || error.kind === "network") ? page(ids) : Promise.reject(error);
  const details = (await Promise.all(pages.map((ids) => page(ids).catch(retry(ids))))).flat();
  return { json: withDetails(json, details), details: new Map(details.map((d) => [d.id, d])) };
}

let githubShared: { token: string; tracked: Set<string>; task: Promise<GithubFetch> } | null = null;

function sharedGithub(token: string, need: string[]): Promise<GithubFetch> {
  const shared = githubShared;
  if (shared?.token === token && need.every((id) => shared.tracked.has(id))) return shared.task;
  const folders = Object.values(live().folders).filter((f) => f.sources.includes("github"));
  const tracked = new Set([...need, ...folders.flatMap((f) => githubTracked(f.id).map(githubId))]);
  const task = fetchGithub(token, [...tracked]).finally(() => {
    if (githubShared?.task === task) githubShared = null;
  });
  githubShared = { token, tracked, task };
  return task;
}

const githubFinished = new Map<string, Record<string, CompletionState>>();

const github: LiveSource = {
  id: "github",
  name: "GitHub",
  kind: "pullRequests",
  site: "https://github.com",
  async fetch(folder) {
    const token = await secret("github");
    const tracked = githubTracked(folder.id);
    const { json, details } = await sharedGithub(token, tracked.map(githubId));
    githubFinished.set(folder.id, finishedStates(tracked, details));
    return mapGithub(json, folder.filters, stillOpen(tracked, details));
  },
  async resolveGone(items, folder) {
    const finished = githubFinished.get(folder.id) ?? {};
    return Object.fromEntries(items.flatMap((it) => (finished[it.id] ? [[it.id, finished[it.id]!]] : [])));
  },
  minInterval: (now) =>
    githubBudget.limit > 0 && now < githubBudget.resetAt && githubBudget.remaining < githubBudget.limit * GITHUB_LOW_BUDGET ? GITHUB_SLOW_MS : 0,
  heldUntil: () => githubBudget.heldUntil,
};

const BITBUCKET_STATE_BATCH = 10;
const BITBUCKET_MIN_MS = 3 * 60_000;

const bitbucketAuth = async () => basic(live().config.bitbucketUser, await secret("bitbucket"));

const bitbucket: LiveSource = {
  id: "bitbucket",
  name: "Bitbucket",
  kind: "pullRequests",
  site: "https://bitbucket.org",
  async fetch(folder) {
    if (!folder.filters.authored) return [];
    const auth = await bitbucketAuth();
    const me = live().accounts.bitbucket;
    if (!me) throw new LiveError("signedOut", "Not signed in");
    const page = await request<{ values: BitbucketPR[] }>(`${endpoints.bitbucket}/pullrequests/${encodeURIComponent(me.login)}?state=OPEN&pagelen=50`, {
      headers: { Authorization: auth },
    });
    return Promise.all(
      page.values.map(async (pr) => {
        const repo = pr.destination.repository.full_name;
        const statuses = await request<BitbucketStatuses>(`${endpoints.bitbucket}/repositories/${repo}/pullrequests/${pr.id}/statuses?pagelen=50`, {
          headers: { Authorization: auth },
        }).catch(() => null);
        return mapBitbucket(pr, statuses);
      }),
    );
  },
  async resolveGone(items) {
    const auth = await bitbucketAuth();
    const out: Record<string, CompletionState> = {};
    const prs = items.flatMap((it) => (it.pr ? [{ id: it.id, repo: it.pr.repo, number: it.pr.number }] : []));
    for (let i = 0; i < prs.length; i += BITBUCKET_STATE_BATCH) {
      await Promise.all(
        prs.slice(i, i + BITBUCKET_STATE_BATCH).map(async ({ id, repo, number }) => {
          const pr = await request<{ state: string }>(`${endpoints.bitbucket}/repositories/${repo}/pullrequests/${number}`, { headers: { Authorization: auth } }).catch(() => null);
          if (pr?.state === "MERGED") out[id] = "merged";
          else if (pr?.state === "DECLINED" || pr?.state === "SUPERSEDED") out[id] = "closed";
        }),
      );
    }
    return out;
  },
  minInterval: () => BITBUCKET_MIN_MS,
};

const notionHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" });

const notion: LiveSource = {
  id: "notion",
  name: "Notion",
  kind: "documents",
  site: "https://www.notion.so",
  async fetch() {
    const token = await secret("notion");
    const [pages, users] = await Promise.all([
      request<NotionSearch>(`${endpoints.notion}/search`, { method: "POST", headers: notionHeaders(token), body: JSON.stringify(NOTION_SEARCH_BODY) }),
      request<NotionUsers>(`${endpoints.notion}/users?page_size=100`, { headers: notionHeaders(token) }).catch(() => null),
    ]);
    return mapNotion(pages, users, live().accounts.notion?.name ?? null);
  },
};

const confluence: LiveSource = {
  id: "confluence",
  name: "Confluence",
  kind: "documents",
  site: "https://www.atlassian.com",
  async fetch() {
    const { confluenceSite, confluenceEmail } = live().config;
    if (!confluenceSite) throw new LiveError("notConfigured", "No Confluence site");
    const auth = basic(confluenceEmail, await secret("confluence"));
    const url = `${endpoints.confluence(confluenceSite)}/wiki/rest/api/content/search?limit=30&expand=space,history.lastUpdated&cql=${encodeURIComponent(CONFLUENCE_CQL)}`;
    return mapConfluence(await request<ConfluenceSearch>(url, { headers: { Authorization: auth } }), confluenceSite);
  },
};

type GoogleTokens = { access_token: string; refresh_token: string; expires_at: number; client_secret: string };

let googleEpoch = 0;
let googleQueue: Promise<unknown> = Promise.resolve();

function googleSerial<T>(task: () => Promise<T>): Promise<T> {
  const run = googleQueue.then(task);
  googleQueue = run.catch(() => undefined);
  return run;
}

const googleChanged = () => new LiveError("signedOut", "Google Drive account changed");

async function googleAccessToken(): Promise<string> {
  const epoch = googleEpoch;
  const raw = await googleSerial(async () => (epoch === googleEpoch ? getSecret("gdrive") : null));
  if (epoch !== googleEpoch) throw googleChanged();
  if (!raw) throw new LiveError(live().accounts.gdrive ? "signedOut" : "notConfigured", "Not signed in");
  const stored = JSON.parse(raw) as GoogleTokens;
  if (stored.expires_at > Date.now() + 60_000) return stored.access_token;
  const json = await request<{ access_token: string; expires_in: number }>(endpoints.googleToken, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ client_id: live().config.googleClientId, client_secret: stored.client_secret, refresh_token: stored.refresh_token, grant_type: "refresh_token" }),
  });
  const saved = await googleSerial(async () => {
    if (epoch !== googleEpoch) return false;
    await setSecret("gdrive", JSON.stringify({ ...stored, access_token: json.access_token, expires_at: Date.now() + json.expires_in * 1000 }));
    return true;
  });
  if (!saved || epoch !== googleEpoch) throw googleChanged();
  return json.access_token;
}

const gdrive: LiveSource = {
  id: "gdrive",
  name: "Google Drive",
  kind: "documents",
  site: "https://drive.google.com",
  async fetch() {
    const token = await googleAccessToken();
    const query = Object.entries(DRIVE_QUERY)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return mapDrive(await request<DriveFiles>(`${endpoints.drive}/files?${query}`, { headers: { Authorization: `Bearer ${token}` } }));
  },
};

export const SOURCES: Record<LiveSourceId, LiveSource> = { github, bitbucket, notion, confluence, gdrive };

const account = (login: string, name: string | null, avatar: string | null): LiveAccount => ({ login, name, avatar, connectedAt: Date.now() });

export async function connectGithub(token: string) {
  const json = await githubGraphql<{ data?: { viewer: { login: string; name: string | null; avatarUrl: string } } }>(token.trim(), VIEWER_QUERY);
  const viewer = json.data?.viewer;
  if (!viewer) throw new LiveError("signedOut", "GitHub didn't accept the token");
  await setSecret("github", token.trim());
  setAccount("github", account(viewer.login, viewer.name, viewer.avatarUrl));
}

export type DeviceFlow = { userCode: string; verificationUri: string; expiresAt: number; done: Promise<void>; cancel(): void };

export async function startGithubDeviceFlow(clientId: string): Promise<DeviceFlow> {
  const code = await request<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }>(
    `${endpoints.githubWeb}/login/device/code`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ client_id: clientId, scope: "repo read:org" }) },
  );
  let cancelled = false;
  let interval = Math.max(code.interval, 1) * 1000;
  const expiresAt = Date.now() + code.expires_in * 1000;
  const done = (async () => {
    while (!cancelled && Date.now() < expiresAt) {
      await new Promise((r) => setTimeout(r, interval));
      if (cancelled) break;
      const json = await request<{ access_token?: string; error?: string; interval?: number }>(`${endpoints.githubWeb}/login/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ client_id: clientId, device_code: code.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
      });
      if (json.access_token) return connectGithub(json.access_token);
      if (json.error === "slow_down") interval = (json.interval ?? interval / 1000 + 5) * 1000;
      else if (json.error && json.error !== "authorization_pending") throw new LiveError("signedOut", json.error === "access_denied" ? "Access was denied" : json.error);
    }
    throw new LiveError("signedOut", cancelled ? "Cancelled" : "The code expired");
  })();
  return { userCode: code.user_code, verificationUri: code.verification_uri, expiresAt, done, cancel: () => (cancelled = true) };
}

export async function connectBitbucket(user: string, token: string) {
  const me = await request<{ account_id: string; display_name: string; links?: { avatar?: { href: string } } }>(`${endpoints.bitbucket}/user`, {
    headers: { Authorization: basic(user.trim(), token.trim()) },
  });
  await setSecret("bitbucket", token.trim());
  updateConfig({ bitbucketUser: user.trim() });
  setAccount("bitbucket", account(me.account_id, me.display_name, me.links?.avatar?.href ?? null));
}

export async function connectNotion(token: string) {
  const me = await request<{ name?: string; bot?: { workspace_name?: string } }>(`${endpoints.notion}/users/me`, { headers: notionHeaders(token.trim()) });
  await setSecret("notion", token.trim());
  setAccount("notion", account(me.bot?.workspace_name ?? me.name ?? "Notion", me.bot?.workspace_name ?? null, null));
}

export async function connectConfluence(site: string, email: string, token: string) {
  const base = site.trim().replace(/\/+$/, "").replace(/^(?!https?:\/\/)/, "https://");
  const me = await request<{ accountId: string; displayName: string }>(`${endpoints.confluence(base)}/wiki/rest/api/user/current`, {
    headers: { Authorization: basic(email.trim(), token.trim()) },
  });
  await setSecret("confluence", token.trim());
  updateConfig({ confluenceSite: base, confluenceEmail: email.trim() });
  setAccount("confluence", account(me.accountId, me.displayName, null));
}

export async function connectGoogle(clientId: string, clientSecret: string, code: string, verifier: string, redirectUri: string) {
  const intent = ++googleEpoch;
  const json = await request<{ access_token: string; refresh_token?: string; expires_in: number }>(endpoints.googleToken, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri }),
  });
  if (!json.refresh_token) throw new LiveError("signedOut", "Google didn't return a refresh token");
  const tokens: GoogleTokens = { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: Date.now() + json.expires_in * 1000, client_secret: clientSecret };
  const about = await request<{ user?: { displayName: string; emailAddress: string; photoLink?: string } }>(`${endpoints.drive}/about?fields=user`, {
    headers: { Authorization: `Bearer ${json.access_token}` },
  }).catch(() => null);
  const committed = await googleSerial(async () => {
    if (intent !== googleEpoch) return false;
    const epoch = ++googleEpoch;
    await setSecret("gdrive", JSON.stringify(tokens));
    if (epoch !== googleEpoch) return false;
    updateConfig({ googleClientId: clientId });
    setAccount("gdrive", account(about?.user?.emailAddress ?? "Google Drive", about?.user?.displayName ?? null, about?.user?.photoLink ?? null));
    return true;
  });
  if (!committed) throw googleChanged();
}

function disconnectGoogle(): Promise<void> {
  googleEpoch++;
  return googleSerial(async () => {
    await deleteSecret("gdrive");
    setAccount("gdrive", null);
  });
}

export async function disconnect(source: LiveSourceId) {
  if (source === "gdrive") return disconnectGoogle();
  await deleteSecret(source);
  setAccount(source, null);
}

export function liveFolderIcon(folder: LiveFolder): { site: string; icon: string | null } {
  return { site: SOURCES[folder.sources[0] ?? "github"].site, icon: folder.icon ?? (folder.sources.length > 1 && folder.kind === "documents" ? symbolIcon("doc.text") : null) };
}
