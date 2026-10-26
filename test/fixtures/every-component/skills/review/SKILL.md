---
description: Reviews code.
allowed-tools: Read, Bash(git diff *)
hooks:
  PostToolUse:
    - matcher: Edit
      hooks:
        - type: command
          command: echo reviewed
---
Review the change.
