import { computeStatus, type Activity } from '@/lib/status-engine'
import type { GitHubConfig, NormalizedPullRequest } from './types'

type GitHubUser = { login: string; type?: string; author_association?: string }
type Pull = {
  id: number
  number: number
  title: string
  html_url: string
  state: 'open' | 'closed'
  draft: boolean
  created_at: string
  updated_at: string
  merged_at: string | null
  user: GitHubUser
  head: { sha: string }
}
type Repo = { full_name: string; name: string; owner: GitHubUser }
type Review = { id: number; user: GitHubUser; body: string | null; state: string; submitted_at: string | null; html_url: string }
type Comment = { id: number; user: GitHubUser; body: string; created_at: string; html_url: string }
type ReviewComment = Comment & { commit_id: string; pull_request_url: string }
type Commit = { sha: string; html_url: string; commit: { message: string; author: { name: string; email: string; date: string } | null }; author: GitHubUser | null }

const API = 'https://api.github.com'
const cache = new Map<string, { expires: number; data: NormalizedPullRequest[] }>()
const inFlight = new Map<string, Promise<NormalizedPullRequest[]>>()

async function github<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, next: { revalidate: 60 } })
  if (!response.ok) throw new Error(`GitHub request failed (${response.status})`)
  return response.json() as Promise<T>
}

const preview = (body: string | null | undefined) => (body ?? '').replace(/\s+/g, ' ').trim().slice(0, 180) || 'No comment text'
const excluded = (repo: Repo, config: GitHubConfig) => config.excludedOwners.has(repo.owner.login.toLowerCase()) || config.excludedRepos.has(repo.full_name.toLowerCase())

// Generic paginator for endpoints that return a raw array (e.g. /repos/:owner/:repo/pulls/:number/reviews)
async function getAll<T>(path: string, token: string) {
  const result: T[] = []
  for (let page = 1; page <= 10; page += 1) {
    const batch = await github<T[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token)
    result.push(...batch)
    if (batch.length < 100) break
  }
  return result
}

// Paginator for the Search API which returns { total_count, incomplete_results, items: T[] }
export async function getSearchResults<T>(path: string, token: string) {
  const result: T[] = []
  for (let page = 1; page <= 10; page += 1) {
    const resp = await github<{ total_count: number; incomplete_results: boolean; items: T[] }>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`, token)
    result.push(...(resp.items || []))
    if (!resp.items || resp.items.length < 100) break
  }
  return result
}

export async function fetchPullRequests(config: GitHubConfig, force = false) {
  const key = `${config.username}:${[...config.excludedOwners].join(',')}:${[...config.excludedRepos].join(',')}`
  const cached = cache.get(key)
  if (!force && cached && cached.expires > Date.now()) return cached.data
  const pending = inFlight.get(key)
  if (pending) return pending
  const request = (async () => {
    // Use Search API paginator for discovery
    const searchPath = `/search/issues?q=author:${encodeURIComponent(config.username)}+type:pr`
    const searchResults = await getSearchResults<{
      number: number
      repository_url: string
      title: string
      html_url: string
      user: { login: string }
      state: string
      created_at: string
      updated_at: string
    }>(searchPath, config.token)

    const normalized: NormalizedPullRequest[] = []
    for (const item of searchResults) {
      // Derive owner and repo from repository_url safely
      try {
        const repoUrl = new URL(item.repository_url)
        const parts = repoUrl.pathname.split('/').filter(Boolean) // ['repos','owner','repo']
        if (parts.length < 3 || parts[0] !== 'repos') continue
        const owner = parts[1]
        const repoName = parts[2]
        const fullName = `${owner}/${repoName}`.toLowerCase()

        // Apply excluded owners/repos BEFORE any further API calls
        if (config.excludedOwners.has(owner.toLowerCase())) continue
        if (config.excludedRepos.has(fullName)) continue

        // Skip my own repositories
        if (owner.toLowerCase() === config.username.toLowerCase()) continue

        // Fetch the full PR to get accurate fields
        const pr = await github<Pull>(`/repos/${owner}/${repoName}/pulls/${item.number}`, config.token)

        // Fetch repo metadata
        const repo = await github<Repo>(`/repos/${owner}/${repoName}`, config.token)
        if (repo.owner.login.toLowerCase() === config.username.toLowerCase() || excluded(repo, config)) continue

        // Fetch additional data using array paginator
        const [reviews, reviewComments, comments, commits] = await Promise.all([
          getAll<Review>(`/repos/${owner}/${repoName}/pulls/${pr.number}/reviews`, config.token),
          getAll<ReviewComment>(`/repos/${owner}/${repoName}/pulls/${pr.number}/comments`, config.token),
          getAll<Comment>(`/repos/${owner}/${repoName}/issues/${pr.number}/comments`, config.token),
          getAll<Commit>(`/repos/${owner}/${repoName}/pulls/${pr.number}/commits`, config.token),
        ])

        const activities: Activity[] = [
          ...reviews
            .filter((review) => review.submitted_at && ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(review.state))
            .map((review) => ({ id: `review-${review.id}`, kind: 'review' as const, actor: review.user.login, actorAssociation: review.user.author_association, createdAt: review.submitted_at!, preview: preview(review.body), url: review.html_url, reviewState: review.state })),
          ...reviewComments.map((comment) => ({ id: `review-comment-${comment.id}`, kind: 'review_comment' as const, actor: comment.user.login, actorAssociation: comment.user.author_association, createdAt: comment.created_at, preview: preview(comment.body), url: comment.html_url })),
          ...comments.map((comment) => ({ id: `comment-${comment.id}`, kind: 'issue_comment' as const, actor: comment.user.login, actorAssociation: comment.user.author_association, createdAt: comment.created_at, preview: preview(comment.body), url: comment.html_url })),
          ...commits.map((commit) => ({ id: `commit-${commit.sha}`, kind: 'commit' as const, actor: commit.author?.login ?? commit.commit.author?.name ?? 'Unknown', createdAt: commit.commit.author?.date ?? '', preview: commit.commit.message, sha: commit.sha, url: commit.html_url })),
        ]

        for (const activity of activities) activity.isMaintainer = Boolean(activity.actorAssociation && ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(activity.actorAssociation))

        const statusResult = computeStatus({ state: pr.state, mergedAt: pr.merged_at, activities })

        normalized.push({
          id: `${repo.full_name}#${pr.number}`,
          repository: repo.name,
          owner: repo.owner.login,
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          state: pr.state,
          draft: pr.draft,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          mergedAt: pr.merged_at,
          author: pr.user.login,
          headSha: pr.head.sha,
          status: statusResult.status,
          changesRequested: statusResult.changesRequested,
          activities,
          statusResult,
        })
      } catch (err) {
        // Continue on individual item errors; do not fail the whole discovery
        // Log minimal info in environments that capture console output
        console.warn('Failed to process search item', { item, reason: err instanceof Error ? err.message : String(err) })
        continue
      }
    }

    normalized.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    cache.set(key, { expires: Date.now() + 60_000, data: normalized })
    return normalized
  })()
  inFlight.set(key, request)
  try { return await request } finally { inFlight.delete(key) }
}
