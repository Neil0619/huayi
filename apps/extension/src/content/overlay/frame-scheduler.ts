export interface FrameScheduler {
  cancel(handle: number): void;
  request(callback: () => void): number;
}

export function createFrameScheduler(view: Window | null): FrameScheduler {
  if (view?.requestAnimationFrame !== undefined) {
    return {
      cancel: (handle) => view.cancelAnimationFrame(handle),
      request: (callback) => view.requestAnimationFrame(() => callback()),
    };
  }
  return {
    cancel: (handle) => clearTimeout(handle),
    request: (callback) => setTimeout(callback, 16) as unknown as number,
  };
}
