import { describe, expect, it } from 'vitest'
import { computeStatus, type Activity } from './status-engine'

const activity = (overrides: Partial<Activity>): Activity => ({ id: crypto.randomUUID(), kind: 'issue_comment', actor: 'maintainer', actorAssociation: 'MEMBER', createdAt: '2026-01-01T10:00:00Z', preview: 'feedback', ...overrides })
const status = (activities: Activity[], extra: Partial<{ state: 'open' | 'closed'; mergedAt: string | null }> = {}) => computeStatus({ state: 'open', mergedAt: null, activities, ...extra }).status

describe('computeStatus', () => {
  it('marks maintainer feedback after my commit as new feedback', () => expect(status([activity({ kind: 'commit', isMine: true, createdAt: '2026-01-01T10:30:00Z' }), activity({ createdAt: '2026-01-01T11:00:00Z' })])).toBe('NEW_FEEDBACK'))
  it('marks my later commit as addressed and waiting', () => expect(status([activity({ createdAt: '2026-01-01T10:00:00Z' }), activity({ kind: 'commit', isMine: true, createdAt: '2026-01-01T10:30:00Z' })])).toBe('ADDRESSED_WAITING'))
  it('uses the latest maintainer comment', () => expect(status([activity({ createdAt: '2026-01-01T10:00:00Z' }), activity({ createdAt: '2026-01-01T11:00:00Z' }), activity({ kind: 'commit', isMine: true, createdAt: '2026-01-01T10:30:00Z' })])).toBe('NEW_FEEDBACK'))
  it('does not treat my reply as resolving feedback', () => expect(status([activity({ createdAt: '2026-01-01T10:00:00Z' }), activity({ actor: 'me', isMine: true, createdAt: '2026-01-01T10:15:00Z' })])).toBe('NEW_FEEDBACK'))
  it('surfaces changes requested and waits after a later commit', () => { const result = computeStatus({ state: 'open', mergedAt: null, activities: [activity({ kind: 'review', reviewState: 'CHANGES_REQUESTED' }), activity({ kind: 'commit', isMine: true, createdAt: '2026-01-01T11:00:00Z' })] }); expect(result.status).toBe('ADDRESSED_WAITING'); expect(result.changesRequested).toBe(true) })
  it('prefers approval after my fix', () => expect(status([activity({ kind: 'review', reviewState: 'CHANGES_REQUESTED' }), activity({ kind: 'commit', isMine: true, createdAt: '2026-01-01T10:30:00Z' }), activity({ kind: 'review', reviewState: 'APPROVED', createdAt: '2026-01-01T11:00:00Z' })])).toBe('APPROVED'))
  it('marks feedback after approval as new feedback', () => expect(status([activity({ kind: 'review', reviewState: 'APPROVED' }), activity({ createdAt: '2026-01-01T11:00:00Z' })])).toBe('NEW_FEEDBACK'))
  it('always prefers merged and closed unmerged', () => { expect(status([], { mergedAt: '2026-01-01T12:00:00Z' })).toBe('MERGED'); expect(status([], { state: 'closed' })).toBe('CLOSED_UNMERGED') })
  it('marks an open PR without feedback as no feedback', () => expect(status([])).toBe('NO_FEEDBACK'))
  it('ignores bots, my comments, and random contributors', () => expect(status([activity({ actor: 'coderabbit[bot]', isBot: true }), activity({ actor: 'me', isMine: true }), activity({ actor: 'random', actorAssociation: 'CONTRIBUTOR' })])).toBe('NO_FEEDBACK'))
})
