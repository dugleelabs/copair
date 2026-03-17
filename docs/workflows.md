# Workflows

Workflows are multi-step YAML files that orchestrate agent prompts, shell commands, and branching logic.

## Locations

```
~/.copair/workflows/     # Global
.copair/workflows/       # Project-level (overrides global)
```

## Step Types

| Type | Description |
|------|-------------|
| `prompt` | Send a message to the agent |
| `shell` | Run a shell command, capture output |
| `command` | Invoke a slash command |
| `condition` | Branch based on an expression |
| `output` | Print a message to the user |

## Example: test-fix workflow

```yaml
# .copair/workflows/test-fix.yaml
name: test-fix
description: Run tests, fix failures, repeat until green
inputs:
  - name: test_command
    description: Command to run tests
    default: npm test
  - name: max_attempts
    default: "3"

steps:
  - id: run-tests
    type: shell
    command: "{{test_command}}"
    capture: test_output
    continue_on_error: true

  - id: check-result
    type: condition
    if: "{{steps.run-tests.exit_code}} == 0"
    then: done
    else: fix-failures

  - id: fix-failures
    type: prompt
    message: |
      Tests failed:
      ```
      {{test_output}}
      ```
      Fix the failures without modifying the tests.

  - id: rerun-tests
    type: shell
    command: "{{test_command}}"
    capture: test_output
    continue_on_error: true
    max_iterations: "{{max_attempts}}"
    loop_until: "{{exit_code}} == 0"
    on_max_iterations: report

  - id: report
    type: prompt
    message: Summarize what was fixed and any remaining failures.

  - id: done
    type: output
    message: All tests passing.
```

## Invocation

```
/workflow test-fix
/workflow test-fix test_command=pytest max_attempts=5
```

Press `Ctrl+C` to cancel a running workflow.
