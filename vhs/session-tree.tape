# vhs session-tree.tape — 30 seconds.
# Shows a deterministic session graph: /fork creates sibling branches and /tree jumps between them.

Output session-tree.gif

Set Shell "bash"
Set Width 1200
Set Height 760
Set FontSize 15
Set TypingSpeed 45ms
Set Theme "TokyoNight"

# Scene 1 — describe the feature
Type "# mewrite keeps every turn in a branchable session tree"
Enter
Sleep 900ms
Type "# /fork creates a sibling branch; /tree jumps between branches"
Enter
Sleep 1200ms

# Scene 2 — show a deterministic session tree transcript
Type "cat session-tree-demo.txt"
Enter
Sleep 6500ms

# Scene 3 — outro
Type "# branch any turn; mewrite never overwrites history"
Enter
Sleep 1800ms
