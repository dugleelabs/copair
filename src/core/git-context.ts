import { execSync } from 'node:child_process';

export interface GitContext {
  isGitRepo: boolean;
  branch?: string;
  status?: string;
}

export function detectGitContext(cwd: string): GitContext {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch {
    return { isGitRepo: false };
  }

  let branch: string | undefined;
  let status: string | undefined;

  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  } catch {
    // not a problem
  }

  try {
    status = execSync('git status --short', {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
  } catch {
    // not a problem
  }

  return { isGitRepo: true, branch, status };
}
