export function createTaskLifecycle() {
  let visible = true;
  const listeners = new Set<(visible: boolean) => void>();
  return {
    visible: () => visible,
    subscribe(listener: (visible: boolean) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hide() {
      visible = false;
      listeners.forEach((listener) => listener(false));
    },
    show() {
      visible = true;
      listeners.forEach((listener) => listener(true));
    },
  };
}
export const taskLifecycle = createTaskLifecycle();
