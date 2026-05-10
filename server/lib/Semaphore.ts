/**
 * Semaphore — bounded concurrency primitive.
 *
 * Unlike Promise.all batching, a semaphore fills slots immediately as they
 * free up rather than waiting for an entire batch to finish before starting
 * the next one. Much better for heterogeneous task durations (e.g. GitHub
 * tree fetches where small repos finish in 200 ms and large ones take 10 s).
 */
export class Semaphore {
  private queue:   Array<() => void> = []
  private running = 0

  constructor(private readonly concurrency: number) {
    if (concurrency < 1) throw new RangeError('Semaphore concurrency must be >= 1')
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  /**
   * Map over an array with bounded concurrency — fires all tasks immediately
   * but limits how many run at the same time.
   */
  mapAll<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    return Promise.all(items.map((item, i) => this.run(() => fn(item, i))))
  }

  get pending()  { return this.queue.length }
  get active()   { return this.running }
  get capacity() { return this.concurrency }

  private acquire(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running++
      return Promise.resolve()
    }
    return new Promise<void>(resolve => this.queue.push(resolve))
  }

  private release(): void {
    const next = this.queue.shift()
    if (next) {
      // next slot — keep running count the same, hand the slot to waiter
      next()
    } else {
      this.running--
    }
  }
}

/**
 * Convenience factory for one-off bounded parallel maps without managing a
 * semaphore instance yourself.
 */
export function pMap<T, R>(
  items:       T[],
  fn:          (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  return new Semaphore(concurrency).mapAll(items, fn)
}
