import type { GoalSource, Highlight } from '../types';

export interface RepoRef {
  owner: string;
  name: string;
}

export interface GitHubConfig {
  username: string; // may be empty when a token is present (resolved via GET /user)
  repos: RepoRef[];
  token: string;
  apiBaseUrl: string;
}

export interface GhIssue {
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: string[];
  updatedAt: string;
  closedAt: string | null;
}
export interface GhPR {
  repo: string;
  number: number;
  title: string;
  url: string;
  mergedAt: string;
}
export interface GhCommit {
  repo: string;
  sha: string;
  title: string;
  url: string;
  at: string;
}
export interface GhActivity {
  username: string;
  assigned: GhIssue[];
  closed: GhIssue[];
  prs: GhPR[];
  commits: GhCommit[];
  errors: string[];
}

export type ConfigResult =
  | { status: 'ok'; config: GitHubConfig }
  | { status: 'missing' }
  | { status: 'invalid'; message: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const NAME = /^[\w.-]+$/;
const isPlaceholder = (s: string) => s.startsWith('YOUR_');

export function parseRepo(s: string): RepoRef | null {
  const [owner, name, ...rest] = s.trim().split('/');
  if (!owner || !name || rest.length || !NAME.test(owner) || !NAME.test(name)) return null;
  return { owner, name };
}

/** Validate the `github` section of daily-quest.config.json. Never logs the token. */
export function parseConfig(raw: unknown): ConfigResult {
  if (typeof raw !== 'object' || raw === null) return { status: 'missing' };
  const g = (raw as Record<string, unknown>).github;
  if (g === undefined || g === null) return { status: 'missing' };
  if (typeof g !== 'object') return { status: 'invalid', message: '"github" must be an object.' };
  const o = g as Record<string, unknown>;

  const list: string[] = Array.isArray(o.repos) ? o.repos.map(str).filter(Boolean) : [];
  if (list.length === 0 && str(o.owner) && str(o.repo)) list.push(`${str(o.owner)}/${str(o.repo)}`); // older single-repo shape
  const usable = list.filter((r) => !isPlaceholder(r));
  if (usable.length === 0) return { status: 'missing' };
  if (usable.length > 5) return { status: 'invalid', message: 'Use at most 5 repos in "repos".' };
  const repos: RepoRef[] = [];
  for (const r of usable) {
    const p = parseRepo(r);
    if (!p) return { status: 'invalid', message: `"${r}" is not a valid "owner/name" repo.` };
    repos.push(p);
  }
  const apiBaseUrl = (str(o.apiBaseUrl) || 'https://api.github.com').replace(/\/+$/, '');
  if (!/^https:\/\//.test(apiBaseUrl)) return { status: 'invalid', message: '"apiBaseUrl" must start with https://.' };
  const username = str(o.username);
  const token = str(o.token);
  if (username && (isPlaceholder(username) || !NAME.test(username))) {
    if (isPlaceholder(username)) return { status: 'missing' };
    return { status: 'invalid', message: '"username" may only contain letters, numbers, ".", "-" and "_".' };
  }
  return { status: 'ok', config: { username, repos, token: isPlaceholder(token) ? '' : token, apiBaseUrl } };
}

export class GitHubError extends Error {}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function friendly(status: number, repo: string): string {
  if (status === 401) return 'GitHub rejected the token (401). Check it in daily-quest.config.json.';
  if (status === 404) return `${repo} was not found. For a private repo the token needs access to it.`;
  if (status === 403 || status === 429) return 'GitHub refused the request (rate limit or permissions). Add a token or try again later.';
  return `GitHub returned an error (${status}) for ${repo}.`;
}

async function getJson(c: GitHubConfig, path: string, repo: string, doFetch: FetchLike): Promise<unknown[]> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (c.token) headers.Authorization = `Bearer ${c.token}`;
  let res: Response;
  try {
    res = await doFetch(`${c.apiBaseUrl}${path}`, { headers, cache: 'no-store' });
  } catch {
    throw new GitHubError('Could not reach GitHub. Check your internet connection.');
  }
  if (!res.ok) throw new GitHubError(friendly(res.status, repo));
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new GitHubError('Unexpected response from GitHub.');
  return data;
}

export async function resolveUsername(c: GitHubConfig, doFetch: FetchLike = fetch): Promise<string> {
  if (c.username) return c.username;
  if (!c.token) throw new GitHubError('Add "username" to the GitHub config (or provide a token so it can be looked up).');
  const res = await doFetch(`${c.apiBaseUrl}/user`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${c.token}` },
    cache: 'no-store',
  }).catch(() => {
    throw new GitHubError('Could not reach GitHub. Check your internet connection.');
  });
  if (!res.ok) throw new GitHubError(friendly(res.status, 'your account'));
  const u = (await res.json()) as { login?: string };
  if (!u.login) throw new GitHubError('Could not determine your GitHub username.');
  return u.login;
}

const rec = (v: unknown): Record<string, any> => (typeof v === 'object' && v !== null ? (v as Record<string, any>) : {});

const mapIssue = (repo: string, i: Record<string, any>): GhIssue => ({
  repo,
  number: Number(i.number),
  title: String(i.title ?? ''),
  url: String(i.html_url ?? ''),
  labels: ((i.labels as unknown[]) ?? []).map((l) => (typeof l === 'string' ? l : String(rec(l).name ?? ''))).filter(Boolean),
  updatedAt: String(i.updated_at ?? ''),
  closedAt: i.closed_at ? String(i.closed_at) : null,
});

/** Read-only: only GET requests. One failed repo never hides the others. */
export async function fetchActivity(c: GitHubConfig, sinceMs: number, doFetch: FetchLike = fetch): Promise<GhActivity> {
  const username = await resolveUsername(c, doFetch);
  const since = new Date(sinceMs).toISOString();
  const out: GhActivity = { username, assigned: [], closed: [], prs: [], commits: [], errors: [] };
  const u = encodeURIComponent(username);

  await Promise.all(
    c.repos.map(async ({ owner, name }) => {
      const repo = `${owner}/${name}`;
      const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
      const results = await Promise.allSettled([
        getJson(c, `${base}/issues?assignee=${u}&state=open&per_page=50`, repo, doFetch),
        getJson(c, `${base}/issues?assignee=${u}&state=closed&since=${encodeURIComponent(since)}&per_page=50`, repo, doFetch),
        getJson(c, `${base}/pulls?state=closed&sort=updated&direction=desc&per_page=30`, repo, doFetch),
        getJson(c, `${base}/commits?author=${u}&since=${encodeURIComponent(since)}&per_page=50`, repo, doFetch),
      ]);
      const [open, closed, pulls, commits] = results;
      const fail = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (fail) {
        const msg = fail.reason instanceof GitHubError ? fail.reason.message : `Could not load ${repo}.`;
        if (!out.errors.includes(msg)) out.errors.push(msg);
      }
      if (open.status === 'fulfilled') {
        out.assigned.push(...open.value.map(rec).filter((i) => !('pull_request' in i)).map((i) => mapIssue(repo, i)));
      }
      if (closed.status === 'fulfilled') {
        out.closed.push(
          ...closed.value
            .map(rec)
            .filter((i) => !('pull_request' in i) && i.closed_at && new Date(i.closed_at).getTime() >= sinceMs)
            .map((i) => mapIssue(repo, i)),
        );
      }
      if (pulls.status === 'fulfilled') {
        out.prs.push(
          ...pulls.value
            .map(rec)
            .filter((p) => p.merged_at && new Date(p.merged_at).getTime() >= sinceMs && String(rec(p.user).login).toLowerCase() === username.toLowerCase())
            .map((p) => ({ repo, number: Number(p.number), title: String(p.title ?? ''), url: String(p.html_url ?? ''), mergedAt: String(p.merged_at) })),
        );
      }
      if (commits.status === 'fulfilled') {
        out.commits.push(
          ...commits.value.map(rec).map((cm) => ({
            repo,
            sha: String(cm.sha ?? ''),
            title: String(rec(cm.commit).message ?? '').split('\n')[0],
            url: String(cm.html_url ?? ''),
            at: String(rec(rec(cm.commit).author).date ?? ''),
          })),
        );
      }
    }),
  );
  return out;
}

/** Only allow http(s) links to be rendered as hrefs. */
export function safeUrl(u: string): string | null {
  return /^https?:\/\//i.test(u) ? u : null;
}

export const issueSource = (i: GhIssue): GoalSource => ({ type: 'github', repo: i.repo, number: i.number, url: i.url, state: i.closedAt ? 'closed' : 'open' });

type NewHighlight = Omit<Highlight, 'id'>;

export const issueHighlight = (i: GhIssue): NewHighlight => ({
  key: `issue-closed:${i.repo}:${i.number}`,
  kind: 'issue-closed',
  title: `#${i.number} ${i.title}`,
  url: i.url,
  repo: i.repo,
  at: i.closedAt ? new Date(i.closedAt).getTime() : Date.now(),
});
export const prHighlight = (p: GhPR): NewHighlight => ({
  key: `pr-merged:${p.repo}:${p.number}`,
  kind: 'pr-merged',
  title: `#${p.number} ${p.title}`,
  url: p.url,
  repo: p.repo,
  at: new Date(p.mergedAt).getTime(),
});
export const commitHighlight = (c: GhCommit): NewHighlight => ({
  key: `commit:${c.repo}:${c.sha}`,
  kind: 'commit',
  title: c.title || c.sha.slice(0, 7),
  url: c.url,
  repo: c.repo,
  at: c.at ? new Date(c.at).getTime() : Date.now(),
});
