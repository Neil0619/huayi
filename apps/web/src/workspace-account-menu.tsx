import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type { WebIdentityApi } from "./identity-api.js";

export function WorkspaceAccountMenu({
  access,
  api,
  csrfToken,
  onSessionEnded,
}: {
  readonly access: "data-rights" | "full";
  readonly api: Pick<WebIdentityApi, "getAccount" | "logout">;
  readonly csrfToken: string;
  readonly onSessionEnded: () => void;
}) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const firstFocus = useRef<"first" | "last">("first");
  const logoutPending = useRef(false);
  const [email, setEmail] = useState<string | null>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setEmail(undefined);
    if (access !== "full") return;
    void api.getAccount().then(
      (account) => {
        if (active) setEmail(account.email);
      },
      () => {
        if (active) setEmail(null);
      },
    );
    return () => {
      active = false;
    };
  }, [access, api]);

  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLElement>("[role='menuitem']");
    items?.[firstFocus.current === "last" ? items.length - 1 : 0]?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  const openMenu = (focus: "first" | "last" = "first") => {
    firstFocus.current = focus;
    setOpen(true);
  };
  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    const items = [
      ...(menu.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)") ?? []),
    ];
    const index = items.findIndex((item) => item === document.activeElement);
    const destination =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (index + 1) % items.length
            : event.key === "ArrowUp"
              ? (index - 1 + items.length) % items.length
              : undefined;
    if (destination !== undefined) {
      event.preventDefault();
      items[destination]?.focus();
    }
  };
  const logout = async () => {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setBusy(true);
    setError("");
    try {
      await api.logout(csrfToken);
      onSessionEnded();
    } catch {
      setError("退出失败，请重试。");
    } finally {
      logoutPending.current = false;
      setBusy(false);
    }
  };
  const label = access === "data-rights" ? "数据权利会话" : (email ?? "我的账户");

  return (
    <div
      className="workspace-account"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        aria-controls={`${id}-menu`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`账户菜单 · ${label}`}
        className="workspace-account-trigger"
        id={`${id}-trigger`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          openMenu(event.key === "ArrowUp" ? "last" : "first");
        }}
        ref={trigger}
        title={label}
        type="button"
      >
        <span aria-hidden="true" className="workspace-account-avatar">
          {email?.slice(0, 1).toUpperCase() ?? "我"}
        </span>
        <span className="workspace-account-label">{label}</span>
        <span aria-hidden="true" className="workspace-account-chevron">
          ⌄
        </span>
      </button>
      {open && (
        <div className="workspace-account-popover">
          <div className="workspace-account-identity">
            <strong>{access === "data-rights" ? "数据权利会话" : "当前账户"}</strong>
            <p>
              {access === "data-rights"
                ? "仅可导出、删除账号与退出"
                : email === undefined
                  ? "正在读取账户…"
                  : (email ?? "账户信息暂不可用")}
            </p>
          </div>
          <div
            aria-labelledby={`${id}-trigger`}
            id={`${id}-menu`}
            onKeyDown={handleMenuKeyDown}
            ref={menu}
            role="menu"
          >
            {access === "full" && (
              <>
                <a
                  href="/settings/account"
                  onClick={() => setOpen(false)}
                  role="menuitem"
                  tabIndex={-1}
                >
                  账号与用量
                </a>
                <a
                  href="/settings/devices"
                  onClick={() => setOpen(false)}
                  role="menuitem"
                  tabIndex={-1}
                >
                  扩展设备
                </a>
              </>
            )}
            <a href="/settings/data" onClick={() => setOpen(false)} role="menuitem" tabIndex={-1}>
              数据与账号
            </a>
            <button
              disabled={busy}
              onClick={() => void logout()}
              role="menuitem"
              tabIndex={-1}
              type="button"
            >
              {busy ? "正在退出…" : "退出登录"}
            </button>
          </div>
          {error && (
            <p className="workspace-account-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
