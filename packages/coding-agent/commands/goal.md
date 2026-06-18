---
name: goal
description: Start an autonomous goal loop in the background. Usage. /goal <goal text>
argument-hint: "<goal text>"
disable-model-invocation: true
user-invocable: true
allowed-tools:
  - bash
---

Launching an autonomous goal loop for: **$ARGUMENTS**

The driver runs in a separate background process: spawning fresh `mewrite -p` per iteration, persisting state at `<cwd>/.cave/goal/<id>/`. Termination on completion sentinel `<goal-complete/>`, iteration cap (default 50), wall-clock cap (24h), $ cap ($10), or 5 consecutive iterations w/o repo change.

Driver launched in background:

!`mkdir -p .cave/goal/_logs && nohup mewrite goal start "$ARGUMENTS" --quiet > .cave/goal/_logs/$(date +%Y%m%d%H%M%S).log 2>&1 & disown ; echo "driver pid=$! log=.cave/goal/_logs/"`

Tell the user:
- the goal id (find it with `mewrite goal list`)
- check progress with `mewrite goal status` or tail the log file printed above
- cancel with `mewrite goal cancel`
- the GOAL.md file under `.cave/goal/<id>/` can be edited mid-run; the next iteration re-reads it
