// Runs a job in the background until it succeeds. Used for writes to the server share, which
// can fail for a while (the share is down, or the Excel file is open in Excel).
//
// The job never runs twice at once: asking for a run while one is going just means one more
// run afterwards. After a failure it waits a little longer each time before trying again.

const SECOND = 1000;
const DEFAULT_RETRY_DELAYS = [2, 5, 10, 30, 60].map((s) => s * SECOND);

export function backgroundJob(name, job, { retryDelays = DEFAULT_RETRY_DELAYS, log = console } = {}) {
  let wanted = false;   // a run has been asked for that hasn't started yet
  let running = null;   // the loop's promise while it runs
  let wake = null;      // ends a wait between retries early
  let stopped = false;
  let failures = 0;     // failures in a row
  let waiters = [];     // runNow() callers, told the result of the next attempt
  const status = { lastSuccessAt: null, lastError: null, lastErrorAt: null };

  async function loop() {
    while (wanted && !stopped) {
      wanted = false;
      const attemptWaiters = waiters;
      waiters = [];
      try {
        await job();
        if (failures) log.log(`${name}: working again after ${failures} failed ${failures === 1 ? 'try' : 'tries'}.`);
        failures = 0;
        Object.assign(status, { lastSuccessAt: new Date(), lastError: null, lastErrorAt: null });
        attemptWaiters.forEach((w) => w.resolve());
      } catch (err) {
        failures += 1;
        Object.assign(status, { lastError: err.message, lastErrorAt: new Date() });
        attemptWaiters.forEach((w) => w.reject(err));
        wanted = true;
        const delay = retryDelays[Math.min(failures, retryDelays.length) - 1];
        // Log the first failure, then only now and then, so a long outage doesn't fill the window.
        if (failures === 1 || failures % 10 === 0) {
          log.warn(`${name}: failed (${err.message}). Trying again every ${Math.round(delay / SECOND)} seconds or so.`);
        }
        // Someone asked for a run while this one was going: try again for them straight away.
        if (waiters.length) continue;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delay);
          timer.unref();
          wake = () => { clearTimeout(timer); resolve(); };
        });
        wake = null;
      }
    }
    running = null;
    const error = new Error(`${name}: stopped because the program is closing.`);
    waiters.splice(0).forEach((w) => w.reject(error));
  }

  function start() {
    if (!running && !stopped) running = loop();
  }

  return {
    // Asks for a run soon. After a failure, waits out the retry delay first.
    request() {
      wanted = true;
      start();
    },

    // Runs as soon as possible, even mid-retry-wait, and resolves or rejects with the result.
    runNow() {
      if (stopped) return Promise.reject(new Error(`${name}: the program is closing.`));
      const result = new Promise((resolve, reject) => waiters.push({ resolve, reject }));
      wanted = true;
      wake?.();
      start();
      return result;
    },

    status: () => ({ ...status, pending: wanted || running !== null }),

    // Stops retrying and waits for a run in progress to finish.
    async stop() {
      stopped = true;
      wake?.();
      await running;
    },
  };
}
