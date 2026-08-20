import { useEffect, useState, type ReactNode } from "react";

export type WorkspaceSection =
  "analysis" | "history" | "inbox" | "library" | "practice" | "settings" | "words";

const navigation: readonly {
  readonly href: string;
  readonly label: string;
  readonly section: WorkspaceSection;
}[] = [
  { href: "/practice", label: "今日练习", section: "practice" },
  { href: "/app", label: "待整理", section: "inbox" },
  { href: "/analysis", label: "分析", section: "analysis" },
  { href: "/library", label: "学习库", section: "library" },
  { href: "/words", label: "生词", section: "words" },
  { href: "/history", label: "分析历史", section: "history" },
  { href: "/settings/account", label: "设置", section: "settings" },
];

const narrowNavigationQuery = "(max-width: 48rem)";

function navigationStartsOpen(): boolean {
  return (
    typeof window.matchMedia !== "function" || !window.matchMedia(narrowNavigationQuery).matches
  );
}

type WorkspaceShellProps =
  | {
      readonly access: "data-rights";
      readonly children: ReactNode;
    }
  | {
      readonly access: "full";
      readonly activeSection: WorkspaceSection;
      readonly children: ReactNode;
    };

export function WorkspaceShell(props: WorkspaceShellProps) {
  const [navigationOpen, setNavigationOpen] = useState(navigationStartsOpen);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(narrowNavigationQuery);
    const update = () => setNavigationOpen(!media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const active =
    props.access === "full"
      ? navigation.find((item) => item.section === props.activeSection)
      : undefined;
  return (
    <div
      className={`app-shell${props.access === "data-rights" ? " workspace-shell-restricted" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="topbar">
        <span aria-hidden="true" className="brand-mark" />
        <div>
          <strong>语见</strong>
          <span>{props.access === "full" ? "Cloud 学习工作台" : "账号数据权利"}</span>
        </div>
      </header>
      {props.access === "full" && (
        <details
          className="workspace-navigation"
          onToggle={(event) => {
            if (
              typeof window.matchMedia === "function" &&
              window.matchMedia(narrowNavigationQuery).matches
            ) {
              setNavigationOpen(event.currentTarget.open);
            }
          }}
          open={navigationOpen}
        >
          <summary>主导航 · {active?.label}</summary>
          <nav aria-label="主导航" className="sidebar">
            {navigation.map((item) => {
              const current = item.section === props.activeSection;
              return (
                <a
                  aria-current={current ? "page" : undefined}
                  href={current ? "#main-content" : item.href}
                  key={item.section}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>
        </details>
      )}
      <main id="main-content" tabIndex={-1}>
        {props.children}
      </main>
    </div>
  );
}
