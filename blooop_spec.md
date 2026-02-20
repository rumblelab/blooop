# Build blooop — a CLI wrapper that bloops when AI agents need attention

## What we're building

A Node.js CLI tool called `blooop` that wraps any AI terminal agent (starting with `claude`) and plays a sound + sends a desktop notification when the agent goes idle / needs user input.

## Setup

1. Create a folder called `blooop`
2. Inside it run `npm init -y`
3. Install dependencies: `npm install node-pty node-notifier`
4. Create the file structure below and implement the code

## File structure

```
blooop/
├── bin/
│   └── blooop.js      # entry point
├── src/
│   └── watcher.js     # detection logic
│   └── notify.js      # sound + notification
├── sounds/
│   └── bloop.wav      # download or generate a short bloop sound
└── package.json
```

## package.json additions

Add this to package.json so `blooop` works as a command locally:
```json
"bin": {
  "blooop": "./bin/blooop.js"
}
```

Then run `npm link` so you can type `blooop claude` in your terminal.

## Implementation

### bin/blooop.js
- Parse args: everything after `blooop` is the command to run (e.g. `claude`)
- Spawn the command using node-pty in a PTY so the wrapped program behaves normally
- Pipe stdin/stdout so the user can still interact normally
- Pass the output stream to watcher.js to monitor
- On trigger from watcher, call notify.js

### src/watcher.js
- Watch the output stream chunk by chunk
- Trigger a bloop on either of these conditions:
  - **Idle detection**: 3 seconds of no output after there WAS output (agent went quiet)
  - **Prompt detection**: output contains any of these strings: `>`, `?`, `(y/n)`, `yes/no`, `Press Enter`, `Do you want`, `proceed`, `confirm`
- Only trigger once per idle period — reset after user sends input
- Export a function: `watch(stream, onTrigger)`

### src/notify.js
- Play `sounds/bloop.wav` using the appropriate system command:
  - macOS: `afplay sounds/bloop.wav`
  - Linux: `paplay sounds/bloop.wav`
  - Windows: use PowerShell
- Send a desktop notification using node-notifier: title "blooop 🔔", message "Your agent needs you"
- Export a function: `notify()`

### sounds/bloop.wav
Generate a simple bloop sound programmatically using Node.js if you can, or download a free short notification sound (< 1 second, pleasant). Name it bloop.wav and put it in the sounds/ folder.

## Testing

Once built, test it like this:

```bash
# Link it locally
npm link

# Run it
blooop claude

# Or test without claude — just run a command that pauses and waits
blooop bash   # then do nothing and wait 3 seconds — should bloop
```

## Success criteria

- [ ] `blooop claude` launches claude normally, user can interact as usual
- [ ] After 3 seconds of silence from the agent, a sound plays and a notification appears
- [ ] Works on macOS (primary target)
- [ ] No crashes, no weird terminal behavior

## Notes

- Keep the code simple and readable — this is open source, trust comes from simplicity
- No network calls, no logging, no analytics — just watch, detect, bloop
- The PTY is important: without it, Claude Code breaks because it detects it's not in a real terminal