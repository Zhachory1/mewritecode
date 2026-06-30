# vhs extension-hotload.tape — 25 seconds.
# Shows: write a SKILL.md into .mewrite/skills/, then mewrite's watcher reloads it.

Output extension-hotload.gif

Set Shell "bash"
Set Width 1200
Set Height 760
Set FontSize 15
Set TypingSpeed 45ms
Set Theme "TokyoNight"

# Scene 1 — start with no project skills
Type "# mewrite watches project skills under .mewrite/skills/"
Enter
Sleep 900ms
Type "find .mewrite/skills -maxdepth 3 -type f 2>/dev/null || true"
Enter
Sleep 1200ms

# Scene 2 — create a skill from another terminal/editor
Type "mkdir -p .mewrite/skills/secure-review"
Enter
Sleep 500ms
Type "cat > .mewrite/skills/secure-review/SKILL.md <<'EOF'"
Enter
Type "---"
Enter
Type "name: secure-review"
Enter
Type "description: OWASP Top-10 audit of a diff or file."
Enter
Type "allowed-tools: [Read, Grep]"
Enter
Type "---"
Enter
Type "Audit the input for OWASP Top-10 issues. Be specific about file:line."
Enter
Type "EOF"
Enter
Sleep 1200ms

# Scene 3 — watcher sees the new resource
Type "find .mewrite/skills -maxdepth 3 -type f"
Enter
Sleep 900ms
Type "cat extension-hotload-output.txt"
Enter
Sleep 2500ms

# Scene 4 — invoke by intent
Type "# Next prompt can invoke it by intent: audit src/auth/login.ts"
Enter
Sleep 1800ms
