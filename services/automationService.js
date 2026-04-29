const AUTOMATION_TICK_MS = 60_000;

export class AutomationService {
  constructor({ runtime }) {
    this.runtime = runtime;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runCycle();
    }, AUTOMATION_TICK_MS);

    void this.runCycle();
  }

  stop() {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async runCycle() {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      await this.runtime.runAutomationCycle();
    } catch (error) {
      console.error("Automation cycle failed:", error);
    } finally {
      this.running = false;
    }
  }
}
