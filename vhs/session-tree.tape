# vhs session-tree.tape — 30 seconds.
# Shows: /tree opens the session graph, /fork branches at a turn, navigate.

Output session-tree.gif

Set Shell "bash"
Set Width 1200
Set Height 760
Set FontSize 15
Set TypingSpeed 50ms
Set Theme "TokyoNight"

# Scene 1 — resume an existing session
Type "mewrite -c --offline --no-tools"
Enter
Sleep 2s

# Scene 2 — try one path
Type "what's the cleanest way to add streaming to packages/ai?"
Enter
Sleep 5s

# Scene 3 — fork to try a different path
Type "/fork"
Enter
Sleep 1s

Type "what's the cleanest way to add batching to packages/ai?"
Enter
Sleep 5s

# Scene 4 — navigate the tree
Type "/tree"
Enter
Sleep 2s

# (the tree view shows two branches now; user selects the streaming branch)
Down
Sleep 500ms
Up
Sleep 500ms
Enter
Sleep 1500ms

# Outro
Ctrl+C
Sleep 500ms
Type "# branch any turn. mewrite never overwrites history."
Enter
Sleep 1500ms
