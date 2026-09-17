export type Task<T> = () => Promise<T>;

export class AsyncQueue {
  private readonly concurrency: number;
  private active = 0;
  private readonly waiting: Array<{
    task: Task<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  constructor(concurrency = 1) {
    this.concurrency = Math.max(1, concurrency);
  }

  get pending(): number {
    return this.waiting.length;
  }

  get running(): number {
    return this.active;
  }

  add<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        task: task as Task<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const next = this.waiting.shift();
      if (!next) return;
      this.active += 1;
      void next
        .task()
        .then(next.resolve, next.reject)
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }
}
