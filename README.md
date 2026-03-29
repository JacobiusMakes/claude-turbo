```
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝
████████╗██╗   ██╗██████╗ ██████╗  ██████╗
╚══██╔══╝██║   ██║██╔══██╗██╔══██╗██╔═══██╗
   ██║   ██║   ██║██████╔╝██████╔╝██║   ██║
   ██║   ██║   ██║██╔══██╗██╔══██╗██║   ██║
   ██║   ╚██████╔╝██║  ██║██████╔╝╚██████╔╝
   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝

Stop babysitting. Start building.
```

# claude-turbo

**Terminal wrapper that auto-accepts Claude Code permission prompts.**

You know the drill. Claude wants to run a command. You press Enter. Claude wants to edit a file. You press 1. Claude wants to use a tool. You press Y. Over and over. Death by a thousand prompts.

`claude-turbo` wraps Claude Code in a PTY, watches for permission prompts, and auto-sends the right response. You see everything Claude sees — it just doesn't stop to ask anymore.

---

## Usage

```bash
# Instead of:
claude

# Run:
claude-turbo
```

That's it. Everything else is transparent.

```bash
# With args
claude-turbo -- -p "fix the auth bug"

# Dry run — see what would be auto-accepted
claude-turbo --dry

# Custom delay before accepting (default: 300ms)
claude-turbo --delay 500

# Log every auto-accept to stderr
claude-turbo --log
```

## What It Auto-Accepts

| Pattern | Response | Example |
|---------|----------|---------|
| "Proceed? (y/n)" | `y` | Build confirmation |
| "Allow / Deny" | `1` (Allow) | Tool permissions |
| "Press Enter to continue" | `Enter` | Pause prompts |
| "Allow once / Allow always" | `1` or `3` | Permission scope |
| "Yes / No" | `y` | Generic confirmations |
| "Do you want to allow" | `y` | Tool use approval |

## What It NEVER Auto-Accepts

Safety patterns that always require manual input:

- `delete all` / `destroy database` / `drop production`
- `force push to main/master`
- `rm -rf /`
- `this cannot be undone` / `are you sure` / `irreversible`

If a dangerous pattern is detected, claude-turbo pauses and lets you decide.

## How It Works

1. Spawns `claude` in a **pseudo-terminal** (PTY via `node-pty`)
2. All output flows through to your terminal — fully transparent
3. A rolling buffer watches the last 2000 chars for permission patterns
4. When a pattern matches, waits `--delay` ms, then sends the response
5. If **you type anything** during the delay, the auto-accept is cancelled
6. Dangerous patterns are blocked from auto-accept entirely

## Install

```bash
git clone https://github.com/JacobiusMakes/claude-turbo.git
cd claude-turbo
npm install
npm link  # makes `claude-turbo` available globally
```

## Config via Environment

```bash
CLAUDE_TURBO_DELAY=500   # ms before auto-accepting (default: 300)
CLAUDE_TURBO_LOG=1       # log auto-accepts to stderr
CLAUDE_PATH=/custom/claude  # custom claude binary path
```

## Safety

- **Dangerous patterns are blocked** — delete/destroy/force-push always require manual input
- **300ms delay** — gives you time to see what's happening and type to cancel
- **User input cancels** — if you type during the delay window, auto-accept is aborted
- **Fully transparent** — you see 100% of Claude's output, nothing is hidden
- **Your existing permissions still apply** — this doesn't bypass Claude's safety classifier, it just answers the prompts faster

## License

MIT
