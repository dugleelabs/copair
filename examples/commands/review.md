---
name: review
description: Review staged changes for bugs, security issues, and style
args:
  - name: focus
    description: "Area to focus on: security, performance, style, or general"
    default: general
---

Review the currently staged git changes:

```
git diff --cached
```

Focus area: {{focus}}

Check for:
- Bugs and logic errors
- Security vulnerabilities (injection, auth bypass, data exposure)
- Missing error handling
- Code style and consistency with the existing codebase

Provide a concise summary with specific, actionable feedback. Reference file names and line numbers where relevant.
