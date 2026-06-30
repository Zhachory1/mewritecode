# vhs extension-hotload.tape — 25 seconds.
# Shows: drop a SKILL.md into .mewrite/skills/, watch mewrite hot-reload.

Output extension-hotload.gif

Set Shell "bash"
Set Width 1200
Set Height 760
Set FontSize 15
Set TypingSpeed 50ms
Set Theme "TokyoNight"

# Scene 1 — running session
Type "mewrite --offline --no-session --no-tools"
Enter
Sleep 1500ms

# Scene 2 — list skills (none yet)
Type "/skills"
Enter
Sleep 2s

Escape
Sleep 500ms

# Scene 3 — drop a skill from an external editor (simulate via shell)
Type "!mkdir -p .mewrite/skills/secure-review"
Enter
Sleep 500ms

Type "!cat > .mewrite/skills/secure-review/SKILL.md <<'EOF'"
Enter
Type "---"
Enter
Type "name: 'Secure code review'"
Enter
Type "description: 'OWASP Top-10 audit of a diff or file.'"
Enter
Type "allowed-tools: [Read, Grep]"
Enter
Type "---"
Enter
Type "Audit the input for OWASP Top-10 issues. Be specific about file:line."
Enter
Type "EOF"
Enter
Sleep 1500ms

# Scene 4 — skill is live
Type "/skills"
Enter
Sleep 2500ms

# Scene 5 — invoke it
Escape
Sleep 500ms
Type "audit src/auth/login.ts for security issues"
Enter
Sleep 6s

# Outro
Ctrl+C
Sleep 500ms
Type "# skills hot-reload from the filesystem. no restart."
Enter
Sleep 1500ms
