# Contributing to plugvet

The most useful contribution is a **rule**: a new attack technique plugvet should catch, or a better version of an existing rule. Fixing a false alarm counts just as much. Your name is printed with every finding your rule makes (`--explain`) and listed in the README.

## Set up

```bash
git clone https://github.com/badsvetac/plugvet && cd plugvet
npm install
npm test
```

## Write a rule

A rule is a folder under `rules/`:

```
rules/pv-your-rule/
├── rule.yaml
├── malicious/          one folder per example the rule MUST flag (at least two)
│   └── some-case/      laid out like a real plugin or skill: hooks/hooks.json, skills/x/SKILL.md…
└── benign/             one folder per example it must NOT flag (at least two)
    └── some-case/
```

`rule.yaml`:

```yaml
id: pv-your-rule            # the folder name; lowercase, starts with pv-
title: What it catches, in plain words
severity: high              # info | low | medium | high | critical
kind: pattern               # pattern | structure | prose (descriptive)
targets: [hook-command, script]
where:                      # optional
  event: [SessionStart]     # only units from these hook events ("monitor" for monitors)
flags: i                    # optional regex flags: i m s u (default i)
match:
  any: ['regex', 'regex']   # flags if any matches…
  all: ['regex', 'regex']   # …or if every one of these matches in the same unit
  none: ['regex']           # never flags a unit where one of these matches
why: >
  What an attacker gets. Two or three sentences a user can act on.
fix: What the plugin author should do instead.
author: { name: Your Name, url: https://github.com/you }
```

**Targets** are the pieces of a plugin plugvet hands to rules:

| Target | What it is |
|---|---|
| `hook-command` | the command line of a command hook (exec-form arguments joined) |
| `hook-url` | the URL of an HTTP hook |
| `monitor-command` | a monitor's command |
| `server-command` | an MCP or LSP server's command line, or an MCP `headersHelper` |
| `server-url` | a remote MCP server's URL, or an `.mcpb` bundle URL |
| `run-script` | a plugin file that a hook, monitor or server command runs (`${CLAUDE_PLUGIN_ROOT}/x.sh`), tagged with that hook's event |
| `script` | every code file in the plugin, whoever runs it |
| `instructions` | skills, commands, agents, output styles, inline commands, prompt and agent hooks |
| `grant` | one tool from a skill's or command's `allowed-tools` |

Write regexes in single-quoted YAML strings: backslashes stay as they are, and a literal `'` is written `''`. Run `npm test`: every `malicious/` folder must be flagged and every `benign/` folder must not be.

### Fixtures must be inert

Fixtures are real-looking plugins, so they must never work as real attacks:

- domains end in `.invalid` (`https://collect.example.invalid`), addresses come from `203.0.113.0/24`
- payloads do nothing harmful: `echo pwned`
- a base64 blob decodes to something harmless, and a comment says what

A fixture that would harm someone who ran it is rejected in review.

### Good benign fixtures are the hard part

A rule that flags safe plugins gets ignored. Make the `benign/` cases the near misses: the safe code that looks most like the attack. When plugvet flags something safe in the wild, add a paraphrased version of it as a benign fixture and fix the rule.

## Report a false alarm

Open an issue with the plugin, the finding, and why it is safe. Or send the fix: a benign fixture plus the rule change.

## Pull requests

- One rule or one fix per pull request.
- Say what you tested, and paste `npx plugvet audit` output for any real plugin you checked.
- Reviews within two days.

## AI tools

Welcome, on two conditions: you have run the result and read it, and you say in the pull request which tool you used and for what. You are answerable for every line.

## Licence

By contributing you agree that your contribution is licensed under the MIT licence of this project.
