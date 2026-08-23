import { useEffect, useState, type ReactNode } from "react";

export type WorkspaceSection =
  "analysis" | "history" | "inbox" | "library" | "practice" | "settings" | "words";

interface NavigationItem {
  readonly href: string;
  readonly index: string;
  readonly label: string;
  readonly section: WorkspaceSection;
}

const navigationGroups: readonly {
  readonly items: readonly NavigationItem[];
  readonly label: string;
}[] = [
  {
    label: "开始",
    items: [
      { href: "/practice", index: "01", label: "今日练习", section: "practice" },
      { href: "/app", index: "02", label: "待整理", section: "inbox" },
      { href: "/analysis", index: "03", label: "分析", section: "analysis" },
    ],
  },
  {
    label: "积累",
    items: [
      { href: "/library", index: "04", label: "学习库", section: "library" },
      { href: "/words", index: "05", label: "生词", section: "words" },
    ],
  },
  {
    label: "回看",
    items: [{ href: "/history", index: "06", label: "分析历史", section: "history" }],
  },
  {
    label: "账户",
    items: [{ href: "/settings/account", index: "07", label: "设置", section: "settings" }],
  },
];

const navigation = navigationGroups.flatMap((group) => group.items);

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
        <div className="brand-lockup">
          <strong>语见</strong>
          <span>Seen &amp; Said</span>
        </div>
        <p>{props.access === "full" ? "个人语言工作台" : "账号数据权利"}</p>
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
            {navigationGroups.map((group) => (
              <section aria-label={group.label} data-navigation-group key={group.label}>
                <p aria-hidden="true">{group.label}</p>
                {group.items.map((item) => {
                  const current = item.section === props.activeSection;
                  return (
                    <a
                      aria-current={current ? "page" : undefined}
                      href={current ? "#main-content" : item.href}
                      key={item.section}
                    >
                      <span aria-hidden="true" data-navigation-index={item.index} />
                      <span>{item.label}</span>
                    </a>
                  );
                })}
              </section>
            ))}
          </nav>
        </details>
      )}
      <main id="main-content" tabIndex={-1}>
        {props.children}
      </main>
    </div>
  );
}
