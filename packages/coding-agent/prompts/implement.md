---
description: Scope-checked implementation workflow with approval before non-trivial edits
---
Treat $@ as the original request; preserve its completion condition and non-goals in every handoff.

For a trivial single-location change, implement directly and stop once the request works. Otherwise:

1. Reuse an already approved plan. Otherwise use `scout` for relevant context and `planner` for the smallest file-by-file plan; pass the original request to both.
2. Ask the read-only `scope-reviewer` to check the plan against the original request for scope and complexity. Remove unjustified work; present the resulting plan and wait for user approval before editing unless it was already approved. In plan mode, where delegation is unavailable, apply the same rubric yourself and run `scope-reviewer` after approval but before edits.
3. Give `worker` the original request and approved plan. After implementation, give `scope-reviewer` the original request, approved plan, and actual diff for a second check.
4. Apply only in-scope cuts, verify the completion condition, and report unrelated observations. Ask the user before expanding approved scope.

Do not chain planner directly into worker or let a reviewer authorize new work.
