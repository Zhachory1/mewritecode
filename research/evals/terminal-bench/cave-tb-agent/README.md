# cave-tb-agent

Terminal-Bench adapter for the caveman-code coding agent CLI. Wraps
`caveman -p "<prompt>" --output json --model gpt-5.4 --caveman-mode full` and parses
caveman-code's JSONL `message_end.usage` events for token accounting (mirrors
`packages/coding-agent/test/benchmarks/live-ab.test.ts:141-159`).

Used by `research/evals/run-terminal-bench.ts`. Not published to PyPI; loaded
via `tb run --agent-import-path research/evals/terminal-bench/cave-tb-agent`.
