#!/usr/bin/env node

/**
 * Stress test for claude-turbo pattern matching.
 * Simulates real Claude Code terminal output (with ANSI codes) and verifies
 * that every prompt type gets matched correctly.
 */

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BLUE = '\x1b[34m';
const BG_GRAY = '\x1b[48;5;236m';
const CURSOR_ICON = '\x1b[36m❯\x1b[0m';

// ── Patterns (copied from claude-turbo.js) ──

const PATTERNS = [
  {
    name: 'trust-folder',
    match: /(?:trust this folder|I trust this folder)/i,
    send: '1',
  },
  {
    name: 'cc-proceed',
    match: /Do you want to proceed\?/,
    send: '1',
  },
  {
    name: 'numbered-yes',
    match: /1[.)]\s*Yes/,
    send: '1',
  },
  {
    name: 'proceed-yn',
    match: /(?:proceed|continue)\?\s*\(?[yYnN]/,
    send: 'y',
  },
  {
    name: 'allow-yn',
    match: /(?:allow|approve|accept)\s*(?:this)?\s*(?:action|operation|tool)?\??\s*\(?[yYnN]/i,
    send: 'y',
  },
  {
    name: 'allow-deny-numbered',
    match: /1[.)]\s*(?:Allow|Yes|Approve|Accept).*(?:2|3)[.)]\s*(?:Deny|No|Reject|Cancel)/s,
    send: '1',
  },
  {
    name: 'press-enter',
    match: /(?:press\s+)?enter\s+to\s+(?:continue|proceed|confirm)/i,
    send: '\r',
  },
  {
    name: 'permission-allow',
    match: /(?:Allow|Approve)\s+(?:once|always|for this session)/i,
    send: '1',
  },
  {
    name: 'want-to-allow',
    match: /do you want to (?:allow|permit|approve)/i,
    send: 'y',
  },
  {
    name: 'tool-approval',
    match: /(?:Allow|Block)\s+\w+\s+tool/i,
    send: '1',
  },
  {
    name: 'yes-no',
    match: /\((?:Yes|Y)\s*\/\s*(?:No|N)\)/,
    send: 'y',
  },
  {
    name: 'allow-always',
    match: /(?:3[.)]\s*)?(?:Always allow|Don'?t ask again|Allow always)/i,
    send: '3',
  },
  {
    name: 'plan-confirmation',
    match: /(?:sound(?:s)?\s+(?:right|good|ok)|(?:does|do)\s+(?:this|that)\s+(?:look|sound)\s+(?:right|good|ok)|(?:should|shall)\s+I\s+(?:proceed|start|go ahead|begin|continue)|(?:ready\s+to\s+(?:proceed|start|begin))|(?:want\s+(?:me\s+)?to\s+(?:adjust|change|modify)\s+(?:anything|priorities|the plan)))\s*\?/i,
    send: 'yes, proceed. Act as a super genius and do what you think is best.\r',
  },
  {
    name: 'approach-check',
    match: /(?:what\s+do\s+you\s+think|any\s+(?:feedback|thoughts|concerns|objections)|(?:before\s+I\s+(?:start|begin|proceed|dive in)))\s*\?/i,
    send: 'looks good, go for it\r',
  },
  {
    name: 'which-option',
    match: /(?:which\s+(?:option|approach|method|strategy)\s+(?:do you|would you|should))|(?:option\s+\d\s+or\s+option\s+\d)/i,
    send: 'whichever you think is best, you decide\r',
  },
];

const BLOCK_PATTERNS = [
  /(?:delete|remove|destroy|drop)\s+(?:all|everything|database|production)/i,
  /(?:force\s+push|--force)\s+(?:to\s+)?(?:main|master|production)/i,
  /rm\s+-rf\s+[/~]/,
  /(?:are you sure|this cannot be undone|irreversible)/i,
];

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

// ── Test Cases ──
// Each has: raw terminal output (with ANSI), expected pattern name, and whether it should be blocked

const TEST_CASES = [
  // === BASIC PERMISSION PROMPTS ===
  {
    name: 'Basic proceed prompt (plain)',
    raw: 'Do you want to proceed?\n❯ 1. Yes\n  2. Yes, and always allow\n  3. No',
    expect: 'cc-proceed',
  },
  {
    name: 'Proceed prompt with ANSI bold',
    raw: `${BOLD}Do you want to proceed?${RESET}\n${CURSOR_ICON} 1. Yes\n  2. Yes, and always allow\n  3. No`,
    expect: 'cc-proceed',
  },
  {
    name: 'Proceed with heavy ANSI formatting',
    raw: `${BG_GRAY}${BOLD}${CYAN}Do you want to proceed?${RESET}\n${GREEN}❯${RESET} ${BOLD}1.${RESET} Yes\n  ${DIM}2.${RESET} Yes, and always allow access\n  ${DIM}3.${RESET} No`,
    expect: 'cc-proceed',
  },
  {
    name: 'Bash command proceed',
    raw: `${BOLD}Bash command${RESET}\n\nmkdir -p /tmp/test\nCreate test directory\n\n${BOLD}Do you want to proceed?${RESET}\n❯ 1. Yes\n  2. Yes, and always allow access to test/ from this project\n  3. No\n\nEsc to cancel · Tab to amend · ctrl+e to explain`,
    expect: 'cc-proceed',
  },

  // === NUMBERED OPTIONS ===
  {
    name: 'Numbered Yes option (plain)',
    raw: '1. Yes\n2. No',
    expect: 'numbered-yes',
  },
  {
    name: 'Numbered Yes with ANSI',
    raw: `${BOLD}1.${RESET} Yes\n${DIM}2.${RESET} No`,
    expect: 'numbered-yes',
  },
  {
    name: 'Numbered with parenthesis',
    raw: '1) Yes, proceed\n2) No, cancel',
    expect: 'numbered-yes',
  },

  // === Y/N PROMPTS ===
  {
    name: 'Proceed y/n (plain)',
    raw: 'Do you want to proceed? (y/n)',
    expect: 'proceed-yn',
  },
  {
    name: 'Continue Y/n with ANSI',
    raw: `${BOLD}continue?${RESET} (Y/n)`,
    expect: 'proceed-yn',
  },
  {
    name: 'Allow action y/n',
    raw: 'Allow this action? (y/N)',
    expect: 'allow-yn',
  },
  {
    name: 'Approve operation',
    raw: 'Approve this operation? (y/n)',
    expect: 'allow-yn',
  },

  // === ALLOW/DENY NUMBERED ===
  {
    name: 'Allow/Deny numbered',
    raw: '1. Allow\n2. Deny',
    expect: 'allow-deny-numbered',
  },
  {
    name: 'Yes/No numbered with ANSI',
    raw: `${GREEN}1.${RESET} Allow this tool\n${RED}2.${RESET} Deny`,
    expect: 'allow-deny-numbered',
  },
  {
    name: 'Accept/Reject/Cancel',
    raw: '1. Accept changes\n2. Reject\n3. Cancel',
    expect: 'allow-deny-numbered',
  },

  // === PRESS ENTER ===
  {
    name: 'Press Enter to continue',
    raw: 'Press Enter to continue',
    expect: 'press-enter',
  },
  {
    name: 'Enter to proceed with ANSI',
    raw: `${DIM}Enter to proceed${RESET}`,
    expect: 'press-enter',
  },
  {
    name: 'Press enter to confirm',
    raw: 'press enter to confirm',
    expect: 'press-enter',
  },

  // === PERMISSION PATTERNS ===
  {
    name: 'Allow once',
    raw: 'Allow once',
    expect: 'permission-allow',
  },
  {
    name: 'Approve for this session',
    raw: 'Approve for this session',
    expect: 'permission-allow',
  },
  {
    name: 'Allow always with ANSI',
    raw: `${GREEN}Allow always${RESET}`,
    expect: 'permission-allow',
  },
  {
    name: 'Do you want to allow',
    raw: 'Do you want to allow this operation?',
    expect: 'want-to-allow',
  },
  {
    name: 'Allow/Block tool',
    raw: 'Allow Bash tool',
    expect: 'tool-approval',
  },
  {
    name: 'Block Read tool',
    raw: 'Allow Read tool call?',
    expect: 'tool-approval',
  },

  // === YES/NO PARENTHETICAL ===
  {
    name: '(Yes / No) prompt',
    raw: 'Save changes? (Yes / No)',
    expect: 'yes-no',
  },
  {
    name: '(Y / N) prompt',
    raw: 'Overwrite file? (Y / N)',
    expect: 'yes-no',
  },

  // === ALWAYS ALLOW ===
  {
    name: 'Always allow option',
    raw: "3. Always allow",
    expect: 'allow-always',
  },
  {
    name: "Don't ask again",
    raw: "Don't ask again",
    expect: 'allow-always',
  },

  // === PLAN/APPROACH CONFIRMATIONS ===
  {
    name: 'Sounds right?',
    raw: "I'll restructure the auth module and add rate limiting. Sound right?",
    expect: 'plan-confirmation',
  },
  {
    name: 'Does this look good?',
    raw: 'Does this look good?',
    expect: 'plan-confirmation',
  },
  {
    name: 'Should I proceed?',
    raw: 'Should I proceed?',
    expect: 'plan-confirmation',
  },
  {
    name: 'Shall I go ahead?',
    raw: 'Shall I go ahead?',
    expect: 'plan-confirmation',
  },
  {
    name: 'Should I start?',
    raw: 'Should I start?',
    expect: 'plan-confirmation',
  },
  {
    name: 'Ready to proceed?',
    raw: 'Ready to proceed?',
    expect: 'plan-confirmation',
  },
  {
    name: 'Want me to adjust anything?',
    raw: 'Want me to adjust anything?',
    expect: 'plan-confirmation',
  },
  {
    name: 'Should I continue with ANSI',
    raw: `${BOLD}Should I continue?${RESET}`,
    expect: 'plan-confirmation',
  },

  // === APPROACH CHECKS ===
  {
    name: 'What do you think?',
    raw: "Here's my approach. What do you think?",
    expect: 'approach-check',
  },
  {
    name: 'Any feedback?',
    raw: 'Any feedback?',
    expect: 'approach-check',
  },
  {
    name: 'Any concerns?',
    raw: 'Any concerns?',
    expect: 'approach-check',
  },
  {
    name: 'Before I start?',
    raw: 'Before I start?',
    expect: 'approach-check',
  },
  {
    name: 'Before I dive in?',
    raw: 'Before I dive in?',
    expect: 'approach-check',
  },

  // === WHICH OPTION ===
  {
    name: 'Which option do you prefer?',
    raw: 'Which option do you prefer?',
    expect: 'which-option',
  },
  {
    name: 'Which approach would you like?',
    raw: 'Which approach would you like?',
    expect: 'which-option',
  },
  {
    name: 'Option 1 or option 2?',
    raw: 'Option 1 or option 2?',
    expect: 'which-option',
  },

  // === WORKSPACE TRUST ===
  {
    name: 'REAL: Trust folder prompt',
    raw: `${BOLD}Accessing workspace:${RESET}\n\n/Volumes/JacobiusT7/IMURME-Social-System\n\nQuick safety check: Is this a project you created or one you trust?\n\n> ${GREEN}1. Yes, I trust this folder${RESET}\n  2. No, exit\n\nEnter to confirm · Esc to cancel`,
    expect: 'trust-folder',
  },
  {
    name: 'Trust folder plain text',
    raw: '1. Yes, I trust this folder\n2. No, exit',
    expect: 'trust-folder',
  },

  // === REAL CLAUDE CODE OUTPUT (exact copies) ===
  {
    name: 'REAL: Strata mkdir proceed',
    raw: `${BOLD}Bash command${RESET}\n\nmkdir -p /Volumes/PortableSSD/Aquifer/aquifer/strata/routes\nCreate strata module directories\n\n${BOLD}Do you want to proceed?${RESET}\n${CURSOR_ICON} 1. Yes\n  2. Yes, and always allow access to strata/ from this project\n  3. No\n\nEsc to cancel · Tab to amend · ctrl+e to explain`,
    expect: 'cc-proceed',
  },
  {
    name: 'REAL: npm install proceed',
    raw: `${BOLD}Bash command${RESET}\n\nnpm install fastify @fastify/cors\nInstall dependencies\n\n${BOLD}Do you want to proceed?${RESET}\n❯ 1. Yes\n  2. Yes, and always allow Bash commands from this project\n  3. No`,
    expect: 'cc-proceed',
  },
  {
    name: 'REAL: Edit file proceed',
    raw: `${BOLD}Edit file${RESET}\n\n/Volumes/PortableSSD/Aquifer/aquifer/strata/server.py\n\n${BOLD}Do you want to proceed?${RESET}\n❯ 1. Yes\n  2. Yes, and always allow edits from this project\n  3. No`,
    expect: 'cc-proceed',
  },
  {
    name: 'REAL: Write file proceed',
    raw: `${BOLD}Write file${RESET}\n\n/tmp/test.js\n\n${BOLD}Do you want to proceed?${RESET}\n❯ 1. Yes\n  2. Yes, and always allow writes\n  3. No`,
    expect: 'cc-proceed',
  },

  // === BLOCKED (safety) ===
  {
    name: 'BLOCK: delete all',
    raw: 'Do you want to delete all files?',
    expect: 'BLOCKED',
  },
  {
    name: 'BLOCK: rm -rf /',
    raw: 'rm -rf /etc/config',
    expect: 'BLOCKED',
  },
  {
    name: 'BLOCK: force push to main',
    raw: 'force push to main',
    expect: 'BLOCKED',
  },
  {
    name: 'BLOCK: are you sure',
    raw: 'Are you sure? This cannot be undone.',
    expect: 'BLOCKED',
  },
  {
    name: 'BLOCK: drop production',
    raw: 'drop production database',
    expect: 'BLOCKED',
  },
  {
    name: 'BLOCK: --force to master',
    raw: 'git push --force to master',
    expect: 'BLOCKED',
  },
  {
    name: 'BLOCK: irreversible with ANSI',
    raw: `${RED}${BOLD}This action is irreversible${RESET}`,
    expect: 'BLOCKED',
  },

  // === SHOULD NOT MATCH (false positive check) ===
  {
    name: 'NO MATCH: regular code output',
    raw: 'function processData(input) {\n  return input.map(x => x * 2);\n}',
    expect: null,
  },
  {
    name: 'NO MATCH: git log output',
    raw: 'commit abc123\nAuthor: Jacob\nDate: 2026-03-29\n\nFix auth bug',
    expect: null,
  },
  {
    name: 'NO MATCH: npm install output',
    raw: 'added 127 packages in 4s\n\n14 packages are looking for funding',
    expect: null,
  },
  {
    name: 'NO MATCH: test results',
    raw: 'PASS  src/auth.test.js\n  ✓ validates token (4ms)\n  ✓ rejects expired token (2ms)\n\nTest Suites: 1 passed, 1 total',
    expect: null,
  },
  {
    name: 'NO MATCH: markdown with "option" in prose',
    raw: 'Another option is to use Redis for caching, which gives us better performance.',
    expect: null,
  },
];

// ── Run Tests ──

let passed = 0;
let failed = 0;
const failures = [];

for (const tc of TEST_CASES) {
  const stripped = stripAnsi(tc.raw);

  // Check blocked first
  let isBlocked = false;
  for (const bp of BLOCK_PATTERNS) {
    if (bp.test(stripped)) {
      isBlocked = true;
      break;
    }
  }

  if (tc.expect === 'BLOCKED') {
    if (isBlocked) {
      passed++;
      process.stdout.write(`${GREEN}  PASS${RESET} ${tc.name}\n`);
    } else {
      failed++;
      failures.push({ ...tc, got: 'NOT BLOCKED' });
      process.stdout.write(`${RED}  FAIL${RESET} ${tc.name} — expected BLOCKED but wasn't\n`);
    }
    continue;
  }

  if (isBlocked) {
    // Shouldn't be blocked
    if (tc.expect !== 'BLOCKED') {
      failed++;
      failures.push({ ...tc, got: 'BLOCKED (false positive)' });
      process.stdout.write(`${RED}  FAIL${RESET} ${tc.name} — unexpectedly BLOCKED\n`);
    }
    continue;
  }

  // Find matching pattern
  let matched = null;
  for (const pattern of PATTERNS) {
    if (pattern.match.test(stripped)) {
      matched = pattern.name;
      break;
    }
  }

  if (matched === tc.expect) {
    passed++;
    process.stdout.write(`${GREEN}  PASS${RESET} ${tc.name}${matched ? ` → ${matched}` : ''}\n`);
  } else {
    failed++;
    failures.push({ ...tc, got: matched });
    process.stdout.write(`${RED}  FAIL${RESET} ${tc.name} — expected "${tc.expect}" got "${matched}"\n`);
  }
}

// ── Summary ──

console.log(`\n${'─'.repeat(60)}`);
console.log(`${BOLD}Results:${RESET} ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : DIM}${failed} failed${RESET} / ${TEST_CASES.length} total`);

if (failures.length > 0) {
  console.log(`\n${RED}${BOLD}Failures:${RESET}`);
  for (const f of failures) {
    console.log(`\n  ${BOLD}${f.name}${RESET}`);
    console.log(`  Expected: ${f.expect}`);
    console.log(`  Got:      ${f.got}`);
    console.log(`  Stripped: ${stripAnsi(f.raw).slice(0, 120)}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
