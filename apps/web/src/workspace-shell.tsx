import { useEffect, useState, type ReactNode } from "react";
import { WorkspaceAppearanceMenu } from "./web-appearance-controller.js";

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
    label: "学习与账户",
    items: [
      { href: "/practice", index: "01", label: "今日练习", section: "practice" },
      { href: "/app", index: "02", label: "收集箱", section: "inbox" },
      { href: "/library", index: "03", label: "学习库", section: "library" },
      { href: "/settings/account", index: "04", label: "设置", section: "settings" },
    ],
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
  const selectedSection =
    props.access === "full"
      ? props.activeSection === "analysis" || props.activeSection === "history"
        ? "inbox"
        : props.activeSection === "words"
          ? "library"
          : props.activeSection
      : undefined;
  const active =
    props.access === "full"
      ? navigation.find((item) => item.section === selectedSection)
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
                    const current = item.section === selectedSection;
                    return (
                      <a
                        aria-current={current ? "page" : undefined}
                        href={current ? "#main-content" : item.href}
                        key={item.section}
                        onClick={() => {
                          if (
                            typeof window.matchMedia === "function" &&
                            window.matchMedia(narrowNavigationQuery).matches
                          ) {
                            setNavigationOpen(false);
                          }
                        }}
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
        <WorkspaceAppearanceMenu />
      </header>
      <main id="main-content" tabIndex={-1}>
        {props.access === "full" && selectedSection === "inbox" && (
          <nav aria-label="收集箱导航" className="workspace-subnav">
            <a href="/app">收集箱</a>
            <a href="/app?paste=1">粘贴原文</a>
            <a href="/history">分析历史</a>
          </nav>
        )}
        {props.access === "full" && selectedSection === "library" && (
          <nav aria-label="学习库导航" className="workspace-subnav">
            <a
              aria-current={props.activeSection === "library" ? "page" : undefined}
              href="/library"
            >
              表达与句型
            </a>
            <a aria-current={props.activeSection === "words" ? "page" : undefined} href="/words">
              生词
            </a>
          </nav>
        )}
        {props.children}
      </main>
    </div>
  );
}
