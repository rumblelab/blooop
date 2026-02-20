# blooop: give Claude Code a voice.

**Stop staring at a static cursor. Get a ping when Claude needs you.**

![Blooop Demo](https://github.com/user-attachments/assets/0060a7b8-20ed-44f4-9f8e-ac0bdd4eb98c)

`blooop` is a semi-high-performance terminal wrapper designed for the AI-first developer workflow. It monitors Claude Code and alerts you via sound the second it goes idle or encounters an interactive prompt.

## Why blooop?

Context switching is the silent killer of productivity. If you want to get the most outta those 5x subscription you're going to want `blooop`. `blooop` bridges the gap between "the AI is thinking" and "I'm back to work," allowing you to stay in flow without the anxiety of missing a prompt.

## Install

```sh
npm install -g blooop
```

## Quick Start

Test your notifications and sound instantly:

```sh
blooop --demo
```

Then, wrap Claude Code:

```sh
blooop claude
```

for you less technical folks, you literally just type "blooop claude" in the terminal.

**Pro Tip:** Alias your common commands so they always blooop:

```sh
# Add to ~/.zshrc or ~/.bashrc
alias claude="blooop claude"
```

if this doesn't make sense, ask claude to check out this readme. it will explain 10x better than i can. 

## How it Works

`blooop` implements a low-latency PTY (Pseudo-Terminal) pass-through. Unlike simple piping, this ensures:

- **Full ANSI Support:** Colors, bold text, and terminal "spinners" work perfectly.
- **Interactive Shells:** Claude Code behaves exactly as if it were running natively.
- **Heuristic Detection:** Intelligent pattern matching for interactive prompts (`y/n`, `confirm?`) and configurable idle-state triggers.

### Triggers

A notification fires when:
- **Claude's input prompt appears** — detected via positive pattern matching.
- **A confirmation is needed** — patterns like `(y/n)`, `Do you want to...`, or `Press Enter`.
- **Silence after submission** — triggers after a period of inactivity (default 4s) once you've sent a command.

## Hotkeys

| Key | Action |
|---|---|
| `Ctrl+B` | **Inline Sound Picker** — Change your notification sound without leaving the session. |

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `BLOOOP_IDLE_MS` | `4000` | Milliseconds of silence before triggering. |
| `BLOOOP_DISABLE_IDLE` | — | Set to `1` to disable idle detection (prompts still trigger). |
| `BLOOOP_DEBUG` | — | Set to `1` to print internal state logs. |
| `BLOOOP_NO_UPDATE_CHECK` | — | Set to `1` to disable the background update check. |

### Config File

`blooop` stores settings in `~/.blooop.json`. It re-reads this file on every notification, so changes take effect immediately.

```json
{
  "sound": "/path/to/your/custom-sound.mp3"
}
```

## Platform Support
(untested)

| Platform | Audio Engine |
|---|---|
| **macOS** | `afplay` | **tested**
| **Linux** | `paplay` or `aplay` |
| **Windows** | PowerShell `Media.SoundPlayer` |

## License

ISC
