export type StatusClass = '' | 'recording' | 'paused' | 'saved';

export class StatusView {
  private timerInterval: number | null = null;
  private startTime = 0;

  constructor(
    private statusEl: HTMLElement,
    private timerEl: HTMLElement,
    private countdownEl: HTMLElement,
  ) {}

  setStatus(text: string, cls: StatusClass): void {
    this.statusEl.textContent = text;
    this.statusEl.className = cls;
  }

  async showCountdown(): Promise<void> {
    this.countdownEl.style.display = 'block';
    this.setStatus('Starting in...', '');
    for (let i = 3; i > 0; i--) {
      this.countdownEl.textContent = String(i);
      this.countdownEl.classList.remove('active');
      void this.countdownEl.offsetWidth;
      this.countdownEl.classList.add('active');
      await new Promise(r => setTimeout(r, 1000));
    }
    this.countdownEl.style.display = 'none';
    this.countdownEl.classList.remove('active');
  }

  startTimer(): void {
    this.startTime = Date.now();
    this.timerEl.style.display = 'block';
    this.restartInterval();
  }

  pauseTimer(): void {
    this.clearInterval();
  }

  resumeTimer(elapsedMs: number): void {
    this.startTime = Date.now() - elapsedMs;
    this.restartInterval();
  }

  stopTimer(): void {
    this.clearInterval();
    this.timerEl.style.display = 'none';
  }

  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  getTimerText(): string {
    return this.timerEl.textContent ?? '00:00:00';
  }

  private restartInterval(): void {
    this.clearInterval();
    this.timerInterval = window.setInterval(() => {
      const ms = Date.now() - this.startTime;
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      this.timerEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }, 1000);
  }

  private clearInterval(): void {
    if (this.timerInterval !== null) {
      window.clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
}
