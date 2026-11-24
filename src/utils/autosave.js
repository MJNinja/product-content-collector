/**
 * Debounced saver. schedule(key, value) queues the latest value per key and
 * writes it after `delay` ms of inactivity; flush() writes everything now.
 */
export function createAutosaver(saveFn, delay = 400, onError = () => {}) {
  const pending = new Map();
  let timer = null;
  let inflight = Promise.resolve();

  function run() {
    timer = null;
    if (!pending.size) return inflight;
    const items = [...pending.values()];
    pending.clear();
    inflight = inflight
      .then(() => Promise.all(items.map((v) => saveFn(v))))
      .catch((err) => onError(err));
    return inflight;
  }

  return {
    schedule(key, value) {
      pending.set(key, value);
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delay);
    },
    flush() {
      if (timer) clearTimeout(timer);
      return run();
    },
    get pendingCount() {
      return pending.size;
    },
  };
}
