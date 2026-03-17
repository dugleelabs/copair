export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /lin_api_[a-zA-Z0-9_-]+/g,
  /AIza[a-zA-Z0-9_-]{35}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/g,
];

function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.DEBUG]: 'DEBUG',
};

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.ERROR) {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(component: string, message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, component, message, data);
  }

  info(component: string, message: string): void {
    this.log(LogLevel.INFO, component, message);
  }

  warn(component: string, message: string): void {
    this.log(LogLevel.WARN, component, message);
  }

  error(component: string, message: string, error?: Error): void {
    this.log(LogLevel.ERROR, component, message, error?.stack);
  }

  private log(
    level: LogLevel,
    component: string,
    message: string,
    data?: unknown,
  ): void {
    if (level > this.level) return;

    const label = LEVEL_LABELS[level];
    let line = `[${label}][${component}] ${redactSecrets(message)}`;

    if (data !== undefined) {
      const dataStr =
        typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      line += ` ${redactSecrets(dataStr)}`;
    }

    process.stderr.write(line + '\n');
  }
}

// Global singleton
export const logger = new Logger();
