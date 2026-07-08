# RFC 0001: Real-Time Cost Aggregation

- Start Date: 2026-07-07
- Status: accepted
- Author: Zhachory Volker
- Tracking Issue: https://github.com/Zhachory1/mewritecode/issues/54

## Summary

`/cost` should include usage from active, unclosed sessions. Me Write Code will persist one cost record per completed assistant message, then aggregate those records with the existing legacy daily/weekly totals.

## PRD

### Problem

Today/week totals only update when an interactive session exits. Long-running sessions are invisible to those totals until close, and multiday sessions are attributed to the close day instead of the message day.

### Users

- Users who keep Me Write Code sessions open across days.
- Users tracking daily or weekly cost budgets while several sessions run at once.

### Goals

- `/cost` Today and This week include active sessions.
- Costs are attributed to the assistant-message completion day/week.
- Multiple running processes can write cost data without corrupting the store.
- Replays, resumes, and shutdown must not double-count records.
- Existing `cost-totals.json` data stays readable.

### Non-goals

- Hosted cost reporting.
- Full billing reconciliation with provider dashboards.
- UI changes beyond existing `/cost` output.
- Migrating historical session files into the new ledger.

## Design

### Storage

Keep the existing `~/.cave/cost-totals.json` as legacy aggregate storage for already-closed sessions and savings data.

Add `~/.cave/cost-ledger.jsonl` for new incremental records. Writers use append-only newline-framed JSONL: one complete record plus trailing newline per write. Readers parse line-by-line, dedupe by `id`, and skip malformed or torn lines so one bad row cannot break `/cost`.

Each line is one assistant message:

```json
{"id":"session-id:entry-id","sessionId":"session-id","timestamp":"2026-07-07T12:00:00.000Z","input":1000,"output":250,"cacheCreate":0,"cacheRead":100,"dollars":0.0123}
```

`id` is the idempotency key. Aggregation dedupes by `id`, so duplicate lines from retry/resume/race paths do not double-count. New ledger rows are written only for live assistant `message_end` events after the session entry is durably appended; session-history reads do not backfill or replay ledger writes.

### Write path

On `message_end` for assistant messages:

1. Persist the normal session entry.
2. Use the returned session entry id to build `sessionId:entryId`.
3. Append one cost ledger row for that assistant message.
4. Best-effort on write failure; never fail the agent turn because cost tracking failed.

### Read path

`getTodayTotal()` and `getThisWeekTotal()` return:

- legacy aggregate from `cost-totals.json`
- plus deduped ledger records matching the requested day/week

Ledger timestamps are stored as UTC instants. Bucketing uses existing `/cost` semantics: local calendar day for Today and ISO week for This week.

`/cost` keeps its existing formatting and calls those helpers.

### Shutdown path

Interactive shutdown still prints the session summary and persists savings. It no longer adds session cost to `cost-totals.json`, because message-level cost already landed in the ledger.

### Compatibility

Existing users keep their historical `cost-totals.json` totals. New records land in the ledger. If no ledger exists, behavior remains equivalent to the old aggregate-only path.

After upgrade, `/cost` includes closed-session legacy totals plus new post-upgrade assistant messages. Historical session files are not scanned, so pre-upgrade turns in still-open sessions may be undercounted unless they already landed in legacy totals.

## Drawbacks

- The JSONL ledger can grow over time. Current volume is small enough that a full scan is acceptable.
- Active sessions that started before this feature may not have prior turns in the ledger.
- Ledger writes are advisory. If the append fails due to disk or permission problems, the agent turn still succeeds and `/cost` may under-report until storage is fixed.
- Legacy totals and new ledger totals are separate sources, so future cleanup should eventually compact old ledger rows into aggregate snapshots.

## Alternatives

- Update `cost-totals.json` after every message. Rejected because read-modify-write aggregate updates can lose increments with concurrent sessions.
- Derive totals by scanning session files. Rejected because it is slower, includes branch/history ambiguity, and still needs dedupe rules.
- Keep session-close aggregation only. Rejected because it fails the multiday active-session use case.

## Writing Plan

1. Add ledger read/write helpers to cost persistence.
2. Include ledger totals in today/week read helpers.
3. Persist assistant-message ledger rows from `AgentSession` after session entry append.
4. Stop interactive shutdown from writing duplicate session-cost aggregates.
5. Add focused cost-persistence tests for ledger inclusion, idempotency, malformed-line tolerance, multiday attribution, and legacy compatibility.
6. Update `docs/reference/tools.md`, `docs/getting-started/auth.md`, and `packages/coding-agent/CHANGELOG.md` with active-session totals and migration caveat.
7. Run focused tests and `npm run check`.
