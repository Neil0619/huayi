export type YouTubeStartupRetryExecutor = <T>(operation: () => Promise<T>) => Promise<T>;

interface YouTubeStartupRetryOptions {
  readonly waitForRetry?: () => Promise<void>;
}

const STARTUP_ATTEMPTS = 3;
const STARTUP_RETRY_DELAY_MS = 200;

export function createYouTubeStartupRetryExecutor(
  options: YouTubeStartupRetryOptions = {},
): YouTubeStartupRetryExecutor {
  const waitForRetry =
    options.waitForRetry ??
    (() =>
      new Promise((resolve) => {
        setTimeout(resolve, STARTUP_RETRY_DELAY_MS);
      }));
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= STARTUP_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < STARTUP_ATTEMPTS) await waitForRetry();
      }
    }
    throw lastError;
  };
}
