# cave-tb-agent

Terminal-Bench adapter for the Me Write Code coding agent CLI. Wraps
`mewrite -p "<prompt>" --mode json --model gpt-5.4` and parses
Me Write Code's JSONL `message_end.usage` events for token accounting (mirrors
`packages/coding-agent/test/benchmarks/live-ab.test.ts:141-159`).

Used by `research/evals/run-terminal-bench.ts`. Not published to PyPI; loaded
via `tb run --agent-import-path research/evals/terminal-bench/cave-tb-agent`.
