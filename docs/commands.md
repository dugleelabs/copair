# Custom Commands

Custom commands are markdown files with YAML frontmatter. Invoke them with `/command-name`.

## Locations

```
~/.copair/commands/      # Global (available in all projects)
.copair/commands/        # Project-level (overrides global)
```

## Format

```markdown
---
name: review
description: Review staged changes
args:
  - name: focus
    description: Area to focus on
    default: general
---

Review the currently staged git changes (`git diff --cached`).

Focus: {{focus}}

Check for bugs, security issues, and missing error handling.
```

## Variables

| Syntax | Source |
|--------|--------|
| `{{argName}}` | Command argument |
| `{{env.VAR_NAME}}` | Environment variable |
| `{{model}}` | Current model alias |
| `{{cwd}}` | Working directory |
| `{{branch}}` | Current git branch |

## Invocation

```
/review
/review focus=security
```
