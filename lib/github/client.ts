import { computeStatus, type Activity } from '@/lib/status-engine'
import type { GitHubConfig, NormalizedPullRequest } from './types'

type GitHubUser = { login: string; type?: string; author_association?: string }
type Pull = { id: number; number: number; title: string; html_url: string; state: 'open' | 'closed'; draft: boolean; created_at: string; updated_at: string; merged_at: string | null; user: GitHubUser; head: { sha: string }; repository_url: string }
type Repo = { full_name: string; name: string; owner: GitHubUser }
type Review = { id: number; user: GitHubUser; body: string | null; state: string; submitted_at: string | null; html_url: string }
type Comment = { id: number; user: GitHubUser; body: string; created_at: string; html_url: string }
type ReviewComment = Comment & { commit_id: string; pull_request_url: string }
type Commit = { sha: string; html_url: string; commit: { message: string; author: { name: string; email: string; date: string } | null }; author: GitHubUser | null }

const API = 'https://api.github.com'
const cache = new Map<string, { expires: number; data: NormalizedPullRequest[] }>()
let inFlight: Promise<NormalizedPullRequest[]> | null = null

async function github<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, next: { revalidate: 60 } })
  if (!response.ok) throw new Error(`GitHub request failed (${response.status})`)
  return response.json() as Promise<T>
}

const preview = (body: string | null | undefined) => (body ?? '').replace(/\s+/g, ' ').trim().slice(0, 180) || 'No comment text'
const excluded = (repo: Repo, config: GitHubConfig) => config.excludedOwners.has(repo.owner.login.toLowerCase()) || config.excludedRepos.has(repo.full_name.toLowerCase())

async function getAll<T>(path: string, token: string) {
  const result: T[] = []
  for (let page = 1; page <= 10; page += 1) {
    const batch = await github<T[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token)
    result.push(...batch)
    if (batch.length < 100) break
  }
  return result
}

export async function fetchPullRequests(config: GitHubConfig, force = false) {
  const key = `${config.username}:${[...config.excludedOwners].join(',')}:${[...config.excludedRepos].join(',')}`
  const cached = cache.get(key)
  if (!force && cached && cached.expires > Date.now()) return cached.data
  if (inFlight) return inFlight
  inFlight = (async () => {
    const pulls = await getAll<Pull>(`/search/issues?q=author:${encodeURIComponent(config.username)}+type:pr`, config.token)
    const normalized: NormalizedPullRequest[] = []
    for (const pull of pulls) {
      const repo = await github<Repo>(pull.repository_url, config.token)
      if (repo.owner.login.toLowerCase() === config.username.toLowerCase() || excluded(repo, config)) continue
      const [reviews, reviewComments, comments, commits] = await Promise.all([
        getAll<Review>(`/repos/${repo.full_name}/pulls/${pull.number}/reviews`, config.token),
        getAll<ReviewComment>(`/repos/${repo.full_name}/pulls/${pull.number}/comments`, config.token),
        getAll<Comment>(`/repos/${repo.full_name}/issues/${pull.number}/comments`, config.token),
        getAll<Commit>(`/repos/${repo.full_name}/pulls/${pull.number}/commits`, config.token),
      ])
      const activities: Activity[] = [
        ...reviews.filter((review) => review.submitted_at && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(review.state)).map((review) => ({ id: `review-${review.id}`, kind: 'review' as const, actor: review.user.login, actorAssociation: review.user.author_association, createdAt: review.submitted_at as string, preview: preview(review.body), url: review.html_url, reviewState: review.state, isBot: review.user.type === 'Bot' })),
        ...reviewComments.map((comment) => ({ id: `review-comment-${comment.id}`, kind: 'review_comment' as const, actor: comment.user.login, actorAssociation: comment.user.author_association, createdAt: comment.created_at, preview: preview(comment.body), url: comment.html_url, isBot: comment.user.type === 'Bot' })),
        ...comments.map((comment) => ({ id: `comment-${comment.id}`, kind: 'issue_comment' as const, actor: comment.user.login, actorAssociation: comment.user.author_association, createdAt: comment.created_at, preview: preview(comment.body), url: comment.html_url, isBot: comment.user.type === 'Bot' })),
        ...commits.map((commit) => ({ id: `commit-${commit.sha}`, kind: 'commit' as const, actor: commit.author?.login ?? commit.commit.author?.name ?? 'Unknown', createdAt: commit.commit.author?.date ?? pull.updated_at, preview: preview(commit.commit.message), message: commit.commit.message.split('\n')[0], sha: commit.sha, url: commit.html_url, isMine: commit.author?.login.toLowerCase() === config.username.toLowerCase() })),
      ]
      for (const activity of activities) activity.isMaintainer = Boolean(activity.actorAssociation && ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(activity.actorAssociation))
      const statusResult = computeStatus({ state: pull.state, mergedAt: pull.merged_at, activities })
      normalized.push({ id: `${repo.full_name}#${pull.number}`, repository: repo.name, owner: repo.owner.login, number: pull.number, title: pull.title, url: pull.html_url, state: pull.state, draft: pull.draft, createdAt: pull.created_at, updatedAt: pull.updated_at, mergedAt: pull.merged_at, author: pull.user.login, headSha: pull.head.sha, status: statusResult.status, changesRequested: statusResult.changesRequested, activities, statusResult })
    }
    normalized.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    cache.set(key, { expires: Date.now() + 60_000, data: normalized })
    return normalized
  })()
  try { return await inFlight } finally { inFlight = null }
}
