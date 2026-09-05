import { NextResponse } from 'next/server'
import { fetchPullRequests } from '@/lib/github/client'

export async function GET(request: Request) {
  const token = process.env.GITHUB_TOKEN
  const username = process.env.GITHUB_USERNAME
  if (!token || !username) return NextResponse.json({ error: 'GitHub is not configured. Add GITHUB_TOKEN and GITHUB_USERNAME to your environment.' }, { status: 503 })
  const url = new URL(request.url)
  const split = (value: string | undefined) => new Set((value ?? '').split(',').map((part) => part.trim().toLowerCase()).filter(Boolean))
  try {
    const data = await fetchPullRequests({ token, username, excludedOwners: split(process.env.EXCLUDED_OWNERS), excludedRepos: split(process.env.EXCLUDED_REPOS) }, url.searchParams.get('refresh') === '1')
    return NextResponse.json({ data, syncedAt: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GitHub is unavailable.'
    return NextResponse.json({ error: message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]') }, { status: 502 })
  }
}
