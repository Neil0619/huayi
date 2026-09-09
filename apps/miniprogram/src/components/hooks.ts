import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DependencyList,
} from "react";
import { useDidHide, useDidShow } from "@tarojs/taro";
import { errorText, MiniError } from "../services/errors";
import { session } from "../services/session";
import { loginPage } from "./ui";

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const run = async (operation: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (e) {
      setError(errorText(e));
      if (e instanceof MiniError && e.code === "authentication_required") loginPage();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
export function useResource<T>(loader: () => Promise<T>, dependencies: DependencyList = []) {
  const account = useSyncExternalStore(session.subscribe, session.getSnapshot);
  // A result belongs to one query and one authentication epoch, including during render.
  const identity = useMemo(() => ({}), [...dependencies, account.epoch]);
  const [result, setResult] = useState<{
    identity: object;
    data: T | null;
    error: string;
    loading: boolean;
  } | null>(null);
  const sequence = useRef(0);
  const visible = useRef(true);
  const current = useRef({ loader, identity });
  current.current = { loader, identity };
  const reload = useCallback(async () => {
    if (!visible.current) return;
    const generation = ++sequence.current;
    const { loader: load, identity: query } = current.current;
    const epoch = session.getSnapshot().epoch;
    const active = () =>
      visible.current &&
      generation === sequence.current &&
      query === current.current.identity &&
      epoch === session.getSnapshot().epoch;
    setResult((previous) => ({
      identity: query,
      data: previous?.identity === query ? previous.data : null,
      error: "",
      loading: true,
    }));
    try {
      await session.ensure();
      if (!active()) return;
      const data = await load();
      if (active()) setResult({ identity: query, data, error: "", loading: false });
    } catch (e) {
      if (active()) {
        const unauthenticated = e instanceof MiniError && e.code === "authentication_required";
        setResult((previous) => ({
          identity: query,
          data: !unauthenticated && previous?.identity === query ? previous.data : null,
          error: errorText(e),
          loading: false,
        }));
        if (unauthenticated) loginPage();
      }
    }
  }, []);
  useDidShow(() => {
    visible.current = true;
    void reload();
  });
  useDidHide(() => {
    visible.current = false;
    sequence.current++;
  });
  useEffect(() => {
    void reload();
    return () => {
      sequence.current++;
    };
  }, [reload, identity]);
  const matching = result?.identity === identity ? result : null;
  return {
    data: matching?.data ?? null,
    error: matching?.error ?? "",
    loading: matching?.loading ?? true,
    reload,
  };
}
