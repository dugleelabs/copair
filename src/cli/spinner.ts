import chalk from 'chalk';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

/**
 * Terminal spinner that animates on a single line via setInterval.
 * Includes an elapsed timer that counts up while the spinner runs.
 *
 * Usage:
 *   const s = new Spinner('Thinking...');
 *   s.start();
 *   await doWork();
 *   s.stop();            // clears the line
 *   s.stopWith('Done');  // replaces with final text
 */
export class Spinner {
  private label: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIdx = 0;
  private startTime = 0;
  private color: (text: string) => string;
  private showTimer: boolean;

  constructor(
    label: string,
    color: (text: string) => string = chalk.cyan,
    showTimer = true,
  ) {
    this.label = label;
    this.color = color;
    this.showTimer = showTimer;
  }

  start(): void {
    if (this.timer) return; // already running
    this.frameIdx = 0;
    this.startTime = performance.now();
    this.draw();
    this.timer = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % FRAMES.length;
      this.draw();
    }, INTERVAL_MS);
  }

  /** Update the label while the spinner is running. */
  update(label: string): void {
    this.label = label;
    if (this.timer) this.draw();
  }

  /** Update the displayed text label without stopping or restarting the spinner. */
  updateText(newLabel: string): void {
    this.label = newLabel;
  }

  /** Stop and clear the spinner line. */
  stop(): void {
    this.clearTimer();
    process.stderr.write('\r\x1b[2K');
  }

  /** Stop and replace the spinner line with final text + newline. */
  stopWith(text: string): void {
    this.clearTimer();
    process.stderr.write(`\r\x1b[2K${text}\n`);
  }

  /** Elapsed milliseconds since start(). */
  get elapsed(): number {
    return performance.now() - this.startTime;
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  private draw(): void {
    const frame = this.color(FRAMES[this.frameIdx]);
    const timerStr = this.showTimer
      ? ` ${chalk.gray.dim(formatElapsed(performance.now() - this.startTime))}`
      : '';
    process.stderr.write(`\r\x1b[2K  ${frame} ${this.label}${timerStr}`);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${String(sec).padStart(2, '0')}s`;
}
