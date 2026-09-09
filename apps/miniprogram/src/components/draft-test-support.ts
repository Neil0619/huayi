import { act, createElement, type PropsWithChildren, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { PracticeSession } from "@huayi/cloud-contracts";

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function createStore() {
  const values = new Map<string, unknown>();
  return {
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => {
      values.set(key, value);
    },
    remove: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}

export function practiceFixture(
  type: PracticeSession["type"] = "sentence-creation",
): PracticeSession {
  return {
    id: "session",
    revision: 1,
    createdAt: "2026-09-09T00:00:00Z",
    updatedAt: "2026-09-09T00:00:00Z",
    type,
    status: "active",
    prompt: "Try a sentence.",
    turns: [],
    items: [
      {
        itemId: "item",
        position: 0,
        scheduleBefore: { level: -1, dueAt: null, consecutiveMastered: 0 },
      },
    ],
    workspace: { phase: "active", mode: "free", draft: "", draftRevision: 0 },
  };
}

export function savedPractice(type: PracticeSession["type"]): PracticeSession {
  const value = practiceFixture(type);
  return {
    ...value,
    revision: 2,
    ...(type === "sentence-creation"
      ? {
          attempts: [
            { id: "attempt", answer: "A", itemIds: ["item"], submittedAt: value.updatedAt },
          ],
        }
      : {
          turns: [
            {
              id: "turn",
              role: "user" as const,
              ordinal: 0,
              content: "A",
              createdAt: value.updatedAt,
            },
          ],
        }),
  };
}

export function mount(element: ReactElement) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return {
    container,
    render(next: ReactElement) {
      act(() => root.render(next));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export function button(container: HTMLElement, label: string) {
  const found = Array.from(container.querySelectorAll("button")).find(
    (value) => value.textContent === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

export function input(container: HTMLElement, text: string, selector = "textarea") {
  const field = container.querySelector<HTMLTextAreaElement | HTMLInputElement>(selector);
  if (!field) throw new Error(`Missing input: ${selector}`);
  act(() => {
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return field;
}

interface FieldProps {
  value: string;
  maxlength: number;
  disabled?: boolean;
  onBlur?: () => void;
  onInput: (event: { detail: { value: string } }) => void;
}
function field(tag: "textarea" | "input", props: FieldProps) {
  return createElement(tag, {
    value: props.value,
    maxLength: props.maxlength < 0 ? undefined : props.maxlength,
    disabled: props.disabled,
    onBlur: props.onBlur,
    onChange: () => undefined,
    onInput: (event: { currentTarget: { value: string } }) =>
      props.onInput({ detail: { value: event.currentTarget.value } }),
  });
}
export const testComponents = {
  View: ({ children }: PropsWithChildren) => createElement("div", null, children),
  Text: ({ children }: PropsWithChildren) => createElement("span", null, children),
  Button: ({
    children,
    ...props
  }: PropsWithChildren<{ disabled?: boolean; onClick?: () => void }>) =>
    createElement("button", props, children),
  Textarea: (props: FieldProps) => field("textarea", props),
  Input: (props: FieldProps) => field("input", props),
  Picker: ({ children }: PropsWithChildren) => createElement("div", null, children),
};
