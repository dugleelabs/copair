---
name: commit-message
description: Generate a conventional commit message for staged changes
---

Look at the staged git changes and generate a conventional commit message.

Run: `git diff --cached`

Format the message as:
```
<type>(<scope>): <short description>

<optional body — only if changes need explanation>
```

Types: feat, fix, chore, docs, refactor, test, perf

Rules:
- Keep the subject line under 72 characters
- Use imperative mood ("add" not "added")
- Only include a body if the why isn't obvious from the diff
- Do not include the backtick code block in your response — just output the raw commit message text
