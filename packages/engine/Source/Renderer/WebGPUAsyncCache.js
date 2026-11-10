function cancelled(label) {
  return new DOMException(`${label} cancelled or invalidated`, "AbortError");
}

/** Reference-counted async work. Logical cancellation never releases a physical slot. @private */
class WebGPUAsyncCache {
  constructor({
    label,
    concurrency = 4,
    maximumEntries = 128,
    destroyValue = () => {},
  }) {
    this.label = label;
    this.concurrency = concurrency;
    this.maximumEntries = maximumEntries;
    this.destroyValue = destroyValue;
    this.entries = new Map();
    this.queue = [];
    this.active = 0;
    this.destroyed = false;
    this.counters = {
      started: 0,
      completed: 0,
      failed: 0,
      hits: 0,
      peakActive: 0,
    };
  }
  get statistics() {
    return {
      ...this.counters,
      active: this.active,
      queued: this.queue.length,
      entries: this.entries.size,
      references: [...this.entries.values()].reduce(
        (n, e) => n + e.references,
        0,
      ),
    };
  }
  acquire(key, create, signal) {
    if (this.destroyed || signal?.aborted) {
      throw cancelled(this.label);
    }
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size + this.active >= this.maximumEntries) {
        throw new Error(`${this.label}: pending resource budget exceeded`);
      }
      entry = {
        key,
        create,
        references: 0,
        controller: new AbortController(),
        state: "queued",
      };
      entry.promise = new Promise((resolve, reject) => {
        entry.resolve = resolve;
        entry.reject = reject;
      });
      // A last-reference cancellation may precede the caller attaching a handler.
      entry.promise.catch(() => {});
      this.entries.set(key, entry);
      this.queue.push(entry);
    } else {
      this.counters.hits++;
    }
    entry.references++;
    let released = false,
      rejectWait;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      signal?.removeEventListener("abort", onAbort);
      rejectWait?.(cancelled(this.label));
      if (--entry.references === 0) {
        this.retire(entry);
      }
    };
    const onAbort = () => release();
    const promise = new Promise((resolve, reject) => {
      rejectWait = reject;
      entry.promise.then(
        (value) => (released ? reject(cancelled(this.label)) : resolve(value)),
        reject,
      );
    });
    promise.catch(() => {});
    signal?.addEventListener("abort", onAbort, { once: true });
    this.pump();
    return { promise, release };
  }
  retire(entry) {
    if (this.entries.get(entry.key) === entry) {
      this.entries.delete(entry.key);
    }
    entry.controller.abort();
    entry.reject(cancelled(this.label));
    if (entry.state === "queued") {
      this.queue = this.queue.filter((item) => item !== entry);
    }
    if (entry.value !== undefined) {
      this.destroyValue(entry.value);
      entry.value = undefined;
    }
  }
  pump() {
    while (
      !this.destroyed &&
      this.active < this.concurrency &&
      this.queue.length
    ) {
      const entry = this.queue.shift();
      entry.state = "active";
      this.active++;
      this.counters.started++;
      this.counters.peakActive = Math.max(
        this.counters.peakActive,
        this.active,
      );
      Promise.resolve()
        .then(() => entry.create(entry.controller.signal))
        .then(
          (value) => {
            this.counters.completed++;
            if (
              this.destroyed ||
              entry.controller.signal.aborted ||
              !entry.references
            ) {
              this.destroyValue(value);
              entry.reject(cancelled(this.label));
            } else {
              entry.value = value;
              entry.resolve(value);
            }
          },
          (error) => {
            this.counters.failed++;
            if (this.entries.get(entry.key) === entry) {
              this.entries.delete(entry.key);
            }
            entry.reject(error);
          },
        )
        .finally(() => {
          entry.state = "settled";
          this.active--;
          this.pump();
        });
    }
  }
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const entry of [...this.entries.values()]) {
      this.retire(entry);
    }
    this.queue.length = 0;
  }
}
export default WebGPUAsyncCache;
