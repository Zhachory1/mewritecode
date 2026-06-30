# vhs install.tape — 30 seconds, README hero GIF.
# Shows: npm install, version check, first interactive prompt.

Output install.gif

Set Shell "bash"
Set Width 1200
Set Height 700
Set FontSize 16
Set TypingSpeed 50ms
Set Theme "TokyoNight"

# Scene 1 — show empty terminal
Type "# install Me Write Code from npm"
Sleep 700ms
Enter
Sleep 500ms

# Scene 2 — install
Type "npm install -g @zhachory1/mewrite-code"
Sleep 500ms
Enter
Sleep 5s

# Scene 3 — verify
Type "mewrite --version"
Sleep 500ms
Enter
Sleep 1500ms

# Scene 4 — first interactive prompt
Type "mewrite --offline --no-session --no-tools"
Sleep 500ms
Enter
Sleep 2s

# Cave's TUI is now showing. Type a prompt.
Type "explain the architecture of this repo in 3 bullets"
Sleep 700ms
Enter

# Let the model stream a response.
Sleep 8s

# Exit cleanly.
Ctrl+C
Sleep 500ms
Type "# done"
Enter
Sleep 1500ms
