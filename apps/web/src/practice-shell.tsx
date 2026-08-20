import type { ReactNode } from "react";

const navigation = ["今日练习", "待整理", "分析", "学习库", "生词", "外部词典", "分析历史", "设置"];

function href(item: string) {
  if (item === "今日练习") return "#main-content";
  if (item === "待整理") return "/app";
  if (item === "分析") return "/analysis";
  if (item === "学习库") return "/library";
  if (item === "生词") return "/words";
  if (item === "外部词典") return "/words/wordbooks";
  if (item === "分析历史") return "/history";
  if (item === "设置") return "/settings/account";
  if (item === "运营") return "/admin";
  return `#${item}`;
}

export function PracticeShell({
  children,
  current = "今日练习",
  operator = false,
}: {
  readonly children: ReactNode;
  readonly current?: string | undefined;
  readonly operator?: boolean | undefined;
}) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="topbar">
        <span aria-hidden="true" className="brand-mark" />
        <div>
          <strong>华译</strong>
          <span>Cloud 学习工作台</span>
        </div>
      </header>
      <nav aria-label="主导航" className="sidebar">
        {[...navigation, ...(operator ? ["运营"] : [])].map((item) => (
          <a aria-current={item === current ? "page" : undefined} href={href(item)} key={item}>
            {item}
          </a>
        ))}
      </nav>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
