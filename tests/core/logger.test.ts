import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, LogLevel } from '../../src/core/logger.js';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('filters by log level', () => {
    const logger = new Logger(LogLevel.WARN);

    logger.error('test', 'error msg');
    logger.warn('test', 'warn msg');
    logger.info('test', 'info msg');
    logger.debug('test', 'debug msg');

    expect(stderrSpy).toHaveBeenCalledTimes(2);
    expect(stderrSpy.mock.calls[0][0]).toContain('ERROR');
    expect(stderrSpy.mock.calls[1][0]).toContain('WARN');
  });

  it('includes component name', () => {
    const logger = new Logger(LogLevel.DEBUG);
    logger.debug('provider:openai', 'request sent');

    expect(stderrSpy.mock.calls[0][0]).toContain('[provider:openai]');
  });

  it('writes to stderr', () => {
    const logger = new Logger(LogLevel.ERROR);
    logger.error('test', 'something broke');

    expect(stderrSpy).toHaveBeenCalled();
  });

  it('redacts API keys', () => {
    const logger = new Logger(LogLevel.DEBUG);
    logger.debug('config', 'key: sk-proj-abc123def456ghi789jkl012mno345');

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).not.toContain('sk-proj-abc123');
    expect(output).toContain('[REDACTED]');
  });

  it('redacts Linear API keys', () => {
    const logger = new Logger(LogLevel.DEBUG);
    logger.debug('config', 'key: lin_api_test12345678');

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('[REDACTED]');
  });

  it('redacts Bearer tokens', () => {
    const logger = new Logger(LogLevel.DEBUG);
    logger.debug('http', 'Authorization: Bearer eyJhbGciOi.test.token');

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('eyJhbGciOi');
  });

  it('shows nothing when level is too low', () => {
    const logger = new Logger(LogLevel.ERROR);
    logger.debug('test', 'should not appear');
    logger.info('test', 'should not appear');
    logger.warn('test', 'should not appear');

    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
