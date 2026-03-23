# Contributing to Copair

Thank you for your interest in contributing to copair! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js >= 20.0.0
- pnpm (install via `corepack enable`)

### Getting Started

```bash
# Fork and clone the repository
git clone https://github.com/<your-username>/copair.git
cd copair

# Install dependencies
pnpm install

# Run tests
pnpm test

# Run linter
pnpm lint

# Build
pnpm build
```

## Making Changes

### Branch Naming

Create a branch from `main`:

```bash
git checkout -b feat/your-feature    # new feature
git checkout -b fix/your-bugfix      # bug fix
```

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Examples:**

```
feat(mcp): add stdio transport support
fix(session): prevent duplicate cleanup on startup
docs: update installation instructions
```

### Code Quality

Before submitting a PR, ensure:

```bash
pnpm lint        # ESLint passes with 0 errors
pnpm test        # All tests pass
pnpm build       # Build succeeds
```

## Pull Request Process

1. Create a PR against `main`
2. Fill out the PR template completely
3. Ensure CI passes (lint, test, build)
4. Use a conventional commit title for the PR (this drives automated releases)
5. Wait for review — a maintainer will review your PR

### PR Title

Your PR title must follow the conventional commit format since we use squash merges:

```
feat: add support for custom system prompts
fix(ui): resolve bordered input ghosting in iTerm
```

## Reporting Issues

- **Bugs:** Use the bug report template — include reproduction steps and environment details
- **Features:** Use the feature request template — describe the use case, not just the solution

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
