export type Status =
  | 'MERGED'
  | 'CLOSED_UNMERGED'
  | 'APPROVED'
  | 'NEW_FEEDBACK'
  | 'ADDRESSED_WAITING'
  | 'NO_FEEDBACK'

export type ActivityKind = 'issue_comment' | 'review_comment' | 'review' | 'commit'

export type Activity = {
  id: string
  kind: ActivityKind
  actor: string
  actorAssociation?: string
  createdAt: string
  preview: string
  url?: string
  sha?: string
  message?: string
  reviewState?: string
  isBot?: boolean
  isMaintainer?: boolean
  isMine?: boolean
}

export type StatusInput = {
  state: 'open' | 'closed'
  mergedAt: string | null
  activities: Activity[]
}

export type StatusResult = {
  status: Status
  latestMaintainerFeedbackAt: string | null
  latestMyCommitAt: string | null
  latestMaintainerActivity: Activity | null
  latestMyCommit: Activity | null
  latestMeaningfulApprovalAt: string | null
  changesRequested: boolean
}

const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

export function isBotActivity(activity: Activity) {
  return Boolean(
    activity.isBot ||
      /\[bot\]$/i.test(activity.actor) ||
      /(^|[-_])(bot|actions|dependabot|coderabbit|greptile|cubic)([-_]|$)/i.test(activity.actor),
  )
}

export function isMaintainerActivity(activity: Activity) {
  return Boolean(
    !isBotActivity(activity) &&
      (activity.isMaintainer ||
        (activity.actorAssociation && MAINTAINER_ASSOCIATIONS.has(activity.actorAssociation))),
  )
}

function timestamp(activity: Activity) {
  return new Date(activity.createdAt).getTime()
}

function latest<T extends Activity>(activities: T[]) {
  return activities.slice().sort((a, b) => timestamp(b) - timestamp(a))[0] ?? null
}

export function computeStatus(input: StatusInput): StatusResult {
  const relevant = input.activities.filter(isMaintainerActivity)
  const maintainerFeedback = relevant.filter(
    (activity) =>
      !activity.isMine &&
      activity.kind !== 'commit' &&
      (activity.kind !== 'review' || activity.reviewState === 'COMMENTED' || activity.reviewState === 'CHANGES_REQUESTED'),
  )
  const latestMaintainerActivity = latest(maintainerFeedback)
  const mine = input.activities.filter((activity) => activity.kind === 'commit' && activity.isMine && !isBotActivity(activity))
  const latestMyCommit = latest(mine)
  const approvals = relevant.filter((activity) => activity.kind === 'review' && activity.reviewState === 'APPROVED')
  const latestApproval = latest(approvals)
  const changesRequested = relevant.some(
    (activity) => activity.kind === 'review' && activity.reviewState === 'CHANGES_REQUESTED',
  )
  const feedbackAt = latestMaintainerActivity?.createdAt ?? null
  const commitAt = latestMyCommit?.createdAt ?? null
  const feedbackTime = feedbackAt ? new Date(feedbackAt).getTime() : null
  const commitTime = commitAt ? new Date(commitAt).getTime() : null

  let status: Status
  if (input.mergedAt) status = 'MERGED'
  else if (input.state === 'closed') status = 'CLOSED_UNMERGED'
  else if (latestApproval && (!latestMaintainerActivity || timestamp(latestApproval) >= timestamp(latestMaintainerActivity))) status = 'APPROVED'
  else if (feedbackTime !== null && (commitTime === null || feedbackTime > commitTime)) status = 'NEW_FEEDBACK'
  else if (feedbackTime !== null && commitTime !== null && commitTime > feedbackTime) status = 'ADDRESSED_WAITING'
  else status = 'NO_FEEDBACK'

  return {
    status,
    latestMaintainerFeedbackAt: feedbackAt,
    latestMyCommitAt: commitAt,
    latestMaintainerActivity,
    latestMyCommit,
    latestMeaningfulApprovalAt: latestApproval?.createdAt ?? null,
    changesRequested,
  }
}

export const STATUS_LABELS: Record<Status, string> = {
  MERGED: 'Merged',
  CLOSED_UNMERGED: 'Closed unmerged',
  APPROVED: 'Approved',
  NEW_FEEDBACK: 'New Feedback',
  ADDRESSED_WAITING: 'Addressed / Waiting',
  NO_FEEDBACK: 'No Feedback',
}

export const STATUS_ORDER: Status[] = ['NEW_FEEDBACK', 'APPROVED', 'ADDRESSED_WAITING', 'NO_FEEDBACK', 'MERGED', 'CLOSED_UNMERGED']

export function isAttention(result: Pick<StatusResult, 'status' | 'changesRequested'>) {
  return result.status === 'NEW_FEEDBACK' || result.changesRequested
} 
