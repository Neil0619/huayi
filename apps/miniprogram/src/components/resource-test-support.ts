import { useEffect, useRef } from "react";
import type { MiniProgramAccount } from "@huayi/cloud-contracts";
import { MiniError } from "../services/errors";

export function createTestSession() {
  let state: { account: MiniProgramAccount | null; epoch: number } = {
    account: { id: "owner-a", email: null, linkedToWeb: false },
    epoch: 1,
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async ensure() {
      if (!state.account) throw new MiniError("authentication_required");
      return "test-token";
    },
    changeAccount(id: string | null) {
      state = {
        account: id ? { id, email: null, linkedToWeb: false } : null,
        epoch: state.epoch + 1,
      };
      listeners.forEach((listener) => listener());
    },
  };
}

export function useTestLifecycle(listeners: Set<() => void>, callback: () => void) {
  const current = useRef(callback);
  current.current = callback;
  useEffect(() => {
    const run = () => current.current();
    listeners.add(run);
    return () => {
      listeners.delete(run);
    };
  }, [listeners]);
}
