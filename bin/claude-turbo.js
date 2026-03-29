#!/usr/bin/env node

/**
 * claude-turbo — Terminal wrapper that auto-accepts Claude Code permission prompts.
 *
 * Stop babysitting. Start building.
 *
 * Spawns `claude` in a pseudo-terminal, watches output for permission prompts,
 * and auto-sends the right keypress (Enter, Y, 1, 2). Everything else passes
 * through transparently — you see exactly what Claude sees.
 *
 * Usage:
 *   claude-turbo                    # launch claude with auto-accept
 *   claude-turbo --dry              # show what would be auto-accepted (no action)
 *   claude-turbo --delay 500        # wait 500ms before auto-accepting (default: 300)
 *   claude-turbo --log              # log auto-accepted prompts to stderr
 *   claude-turbo -- -p "fix bug"    # pass args through to claude
 *
 * Config: CLAUDE_TURBO_DELAY=300 CLAUDE_TURBO_LOG=1
 */

import pty from 'node-pty';

// ============================================================
//  Config
// ============================================================

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const dryRun = flags.has('--dry');
const logEnabled = flags.has('--log') || process.env.CLAUDE_TURBO_LOG === '1';
const delayMs = parseInt(
  args.find((a, i) => args[i - 1] === '--delay') ||
  process.env.CLAUDE_TURBO_DELAY ||
  '300'
);

// Everything after -- goes to claude
const dashDash = args.indexOf('--');
const claudeArgs = dashDash >= 0 ? args.slice(dashDash + 1) : [];

// ============================================================
//  Permission Prompt Patterns
// ============================================================

const PATTERNS = [
  {
    // "Do you want to proceed? (y/n)" or "Proceed? (Y/n)"
    name: 'proceed-yn',
    match: /(?:proceed|continue)\?\s*\(?[yYnN]/,
    send: 'y',
  },
  {
    // "Allow this action? (y/n)"
    name: 'allow-yn',
    match: /(?:allow|approve|accept)\s*(?:this)?\s*(?:action|operation|tool)?\??\s*\(?[yYnN]/i,
    send: 'y',
  },
  {
    // Numbered option: "1. Allow  2. Deny" — send 1
    name: 'allow-deny-numbered',
    match: /1[.)]\s*(?:Allow|Yes|Approve|Accept).*2[.)]\s*(?:Deny|No|Reject|Cancel)/s,
    send: '1',
  },
  {
    // "Press Enter to continue" or just waiting for Enter
    name: 'press-enter',
    match: /(?:press\s+)?enter\s+to\s+(?:continue|proceed|confirm)/i,
    send: '\r',
  },
  {
    // Permission request with "Allow" as first option
    name: 'permission-allow',
    match: /(?:Allow|Approve)\s+(?:once|always|for this session)/i,
    send: '1',
  },
  {
    // "Do you want to allow" patterns
    name: 'want-to-allow',
    match: /do you want to (?:allow|permit|approve)/i,
    send: 'y',
  },
  {
    // Claude Code's specific tool approval format
    name: 'tool-approval',
    match: /(?:Allow|Block)\s+\w+\s+tool/i,
    send: '1',
  },
  {
    // "Yes / No" prompt
    name: 'yes-no',
    match: /\((?:Yes|Y)\s*\/\s*(?:No|N)\)/,
    send: 'y',
  },
  {
    // Don't ask again pattern — always pick "allow always" if available
    name: 'allow-always',
    match: /(?:3[.)]\s*)?(?:Always allow|Don'?t ask again|Allow always)/i,
    send: '3',
  },
];

// Patterns to NEVER auto-accept (safety net)
const BLOCK_PATTERNS = [
  /(?:delete|remove|destroy|drop)\s+(?:all|everything|database|production)/i,
  /(?:force\s+push|--force)\s+(?:to\s+)?(?:main|master|production)/i,
  /rm\s+-rf\s+[/~]/,
  /(?:are you sure|this cannot be undone|irreversible)/i,
];

// ============================================================
//  Colors
// ============================================================

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};

// ============================================================
//  PTY Spawn
// ============================================================

if (flags.has('--help') || flags.has('-h')) {
  console.log(`${c.bold}claude-turbo${c.reset} — auto-accept Claude Code permission prompts\n`);
  console.log('Usage:');
  console.log('  claude-turbo                    Launch with auto-accept');
  console.log('  claude-turbo --dry              Show what would be accepted');
  console.log('  claude-turbo --delay 500        Wait 500ms before accepting');
  console.log('  claude-turbo --log              Log auto-accepted prompts');
  console.log('  claude-turbo -- -p "fix bug"    Pass args to claude');
  console.log(`\n${c.dim}Delay: ${delayMs}ms | Dry run: ${dryRun}${c.reset}`);
  process.exit(0);
}

// Find claude
const claudePath = process.env.CLAUDE_PATH || 'claude';

// Banner
process.stderr.write(
  `${c.cyan}${c.bold}claude-turbo${c.reset} ${c.dim}| delay: ${delayMs}ms | ` +
  `dry: ${dryRun} | log: ${logEnabled} | safety: on${c.reset}\n`
);

// Spawn claude in a PTY
const shell = pty.spawn(claudePath, claudeArgs, {
  name: 'xterm-256color',
  cols: process.stdout.columns || 120,
  rows: process.stdout.rows || 40,
  cwd: process.cwd(),
  env: process.env,
});

// Buffer for pattern matching (last N chars of output)
const BUFFER_SIZE = 2000;
let outputBuffer = '';
let lastAutoAcceptTime = 0;
let autoAcceptCount = 0;
let pendingTimeout = null;

// ============================================================
//  Output Handler — watch for permission prompts
// ============================================================

shell.onData((data) => {
  // Pass through to terminal
  process.stdout.write(data);

  // Buffer for pattern matching
  outputBuffer += data;
  if (outputBuffer.length > BUFFER_SIZE) {
    outputBuffer = outputBuffer.slice(-BUFFER_SIZE);
  }

  // Don't re-trigger if we just auto-accepted
  const now = Date.now();
  if (now - lastAutoAcceptTime < delayMs + 200) return;

  // Check for blocked patterns first (safety)
  for (const blockPattern of BLOCK_PATTERNS) {
    if (blockPattern.test(outputBuffer)) {
      if (logEnabled) {
        process.stderr.write(`${c.red}[turbo] BLOCKED — safety pattern matched, manual input required${c.reset}\n`);
      }
      return;
    }
  }

  // Check for auto-accept patterns
  for (const pattern of PATTERNS) {
    if (pattern.match.test(outputBuffer)) {
      // Clear the buffer so we don't re-match
      const matchStr = outputBuffer.match(pattern.match)?.[0] || '';

      if (pendingTimeout) clearTimeout(pendingTimeout);

      pendingTimeout = setTimeout(() => {
        if (dryRun) {
          process.stderr.write(
            `${c.yellow}[turbo] WOULD send "${pattern.send === '\r' ? 'Enter' : pattern.send}" ` +
            `for: ${pattern.name}${c.reset}\n`
          );
        } else {
          shell.write(pattern.send + '\r');
          autoAcceptCount++;
          lastAutoAcceptTime = Date.now();

          if (logEnabled) {
            process.stderr.write(
              `${c.green}[turbo] #${autoAcceptCount} auto-accepted: ${pattern.name} → ` +
              `"${pattern.send === '\r' ? 'Enter' : pattern.send}"${c.reset}\n`
            );
          }
        }
        outputBuffer = '';
        pendingTimeout = null;
      }, delayMs);

      return; // Only match first pattern
    }
  }
});

// ============================================================
//  Input Handler — pass user keypresses through
// ============================================================

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (data) => {
  // Cancel pending auto-accept if user types something
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
    if (logEnabled) {
      process.stderr.write(`${c.dim}[turbo] user input detected, cancelled pending auto-accept${c.reset}\n`);
    }
  }
  shell.write(data);
});

// ============================================================
//  Resize handling
// ============================================================

process.stdout.on('resize', () => {
  shell.resize(process.stdout.columns, process.stdout.rows);
});

// ============================================================
//  Exit handling
// ============================================================

shell.onExit(({ exitCode }) => {
  process.stderr.write(
    `\n${c.dim}[turbo] session ended | ${autoAcceptCount} prompts auto-accepted${c.reset}\n`
  );
  process.stdin.setRawMode(false);
  process.exit(exitCode);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  shell.write('\x03'); // Forward Ctrl+C to claude
});

process.on('SIGTERM', () => {
  shell.kill();
});
