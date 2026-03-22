import type { Command, AgentContext } from '../interface.js';
import { SessionManager, resolveSessionsDir } from '../../core/session.js';

// Session manager and agent are injected at startup
let sessionManagerRef: SessionManager | null = null;
let onResumeRef: ((sessionId: string) => Promise<void>) | null = null;

export function setSessionManagerRef(mgr: SessionManager): void {
  sessionManagerRef = mgr;
}

export function setOnResume(fn: (sessionId: string) => Promise<void>): void {
  onResumeRef = fn;
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const sessionCommand: Command = {
  definition: {
    name: 'session',
    description: 'Manage sessions (list, resume, rename, delete, save, info)',
    source: 'builtin',
    args: [
      { name: 'subcommand', description: 'list | resume | rename | delete | save | info' },
      { name: 'ARGUMENTS', description: 'Arguments for subcommand' },
    ],
  },
  async execute(args: Record<string, string>, context: AgentContext): Promise<void> {
    const sub = args.subcommand || args.ARGUMENTS?.split(' ')[0] || '';
    const rest = args.ARGUMENTS?.split(' ').slice(1).join(' ') || '';
    const sessionsDir = resolveSessionsDir(context.cwd);

    switch (sub) {
      case 'list': {
        const sessions = await SessionManager.listSessions(sessionsDir);
        if (sessions.length === 0) {
          console.log('No sessions found.');
          return;
        }
        console.log('\nSessions:');
        for (const s of sessions) {
          const current = sessionManagerRef?.getMetadata()?.id === s.id ? ' (current)' : '';
          console.log(
            `  ${s.identifier}  ${timeAgo(s.lastActive)}  ${s.messageCount} msgs  ${s.model}${current}`,
          );
        }
        console.log('');
        return;
      }

      case 'resume': {
        const target = rest.trim();
        if (!target) {
          console.log('Usage: /session resume <identifier>');
          return;
        }
        const sessions = await SessionManager.listSessions(sessionsDir);
        const match = sessions.find(
          (s) => s.identifier === target || s.id.startsWith(target),
        );
        if (!match) {
          console.log(`Session not found: ${target}`);
          return;
        }
        if (onResumeRef) {
          await onResumeRef(match.id);
        } else {
          console.log('Resume not available in current context.');
        }
        return;
      }

      case 'rename': {
        const newName = rest.trim();
        if (!newName) {
          console.log('Usage: /session rename <new-name>');
          return;
        }
        if (!sessionManagerRef) {
          console.log('No active session.');
          return;
        }
        sessionManagerRef.rename(newName);
        console.log(`Session renamed to: ${newName}`);
        return;
      }

      case 'delete': {
        const target = rest.trim();
        if (!target) {
          console.log('Usage: /session delete <identifier>');
          return;
        }
        const sessions = await SessionManager.listSessions(sessionsDir);
        const match = sessions.find(
          (s) => s.identifier === target || s.id.startsWith(target),
        );
        if (!match) {
          console.log(`Session not found: ${target}`);
          return;
        }
        if (sessionManagerRef?.getMetadata()?.id === match.id) {
          console.log('Cannot delete the current session.');
          return;
        }
        await SessionManager.deleteSession(sessionsDir, match.id);
        console.log(`Deleted session: ${match.identifier}`);
        return;
      }

      case 'save': {
        if (!sessionManagerRef) {
          console.log('No active session.');
          return;
        }
        console.log('Session saved.');
        return;
      }

      case 'info': {
        const meta = sessionManagerRef?.getMetadata();
        if (!meta) {
          console.log('No active session.');
          return;
        }
        console.log(`\nSession: ${meta.identifier}`);
        console.log(`  ID:        ${meta.id}`);
        console.log(`  Model:     ${meta.model}`);
        console.log(`  Created:   ${meta.created}`);
        console.log(`  Active:    ${timeAgo(meta.lastActive)}`);
        console.log(`  Messages:  ${meta.messageCount}`);
        console.log(`  Summary:   ${meta.hasSummary ? 'yes' : 'no'}`);
        if (meta.branch) console.log(`  Branch:    ${meta.branch}`);
        console.log('');
        return;
      }

      default:
        console.log('Usage: /session <list|resume|rename|delete|save|info>');
        return;
    }
  },
};
