import type { Activity, Status, StatusResult } from '@/lib/status-engine'

export type NormalizedPullRequest = {
  id: string
  repository: string
  owner: string
  number: number
  title: string
  url: string
  state: 'open' | 'closed'
  draft: boolean
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  author: string
  headSha: string
  status: Status
  changesRequested: boolean
  activities: Activity[]
  statusResult: StatusResult
}

export type GitHubConfig = {
  token: string
  username: string
  excludedOwners: Set<string>
  excludedRepos: Set<string>
}
