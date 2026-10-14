---
description: Scope-checked implementation followed by correctness and complexity review
---
Treat $@ as the original request. Preserve its completion condition, non-goals, and any approved plan throughout.

For non-trivial work, reuse an approved plan or use `scout` and `planner` to propose the smallest file-by-file plan. Have the read-only `scope-reviewer` identify unjustified scope or complexity, then present the plan and wait for user approval before editing unless it is already approved. In plan mode, where delegation is unavailable, apply the rubric yourself and run `scope-reviewer` after approval but before edits. For trivial single-location changes, skip planning and scope review.

Give `worker` the original request and approved scope. Once a patch exists, send the actual diff and approved scope to `reviewer` for correctness; for non-trivial changes also send it to `scope-reviewer` for scope and complexity. Apply only feedback needed to satisfy the request or necessary safety; report unrelated findings. Ask the user before changing approved scope. Stop when the completion condition is met.

Do not chain a review verdict directly into another worker invocation.
