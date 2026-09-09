import { useEffect, type PropsWithChildren } from "react";
import { WorkspaceAppearanceMenu } from "./web-appearance-controller.js";

export function PublicSiteShell({
  children,
  page,
}: PropsWithChildren<{ readonly page: "home" | "guide" }>) {
  useEffect(() => {
    const previous = document.title;
    document.title =
      page === "home" ? "语见 · Seen & Said — 把看见的，变成会说的" : "开始使用语见 · Seen & Said";
    return () => {
      document.title = previous;
    };
  }, [page]);
  return (
    <div className="public-site">
      <a className="skip-link" href="#site-content">
        跳到主要内容
      </a>
      <header className="site-header">
        <a className="site-brand" href="/" aria-label="语见首页">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            <strong>语见</strong>
            <small>SEEN & SAID</small>
          </span>
        </a>
        <nav className="site-navigation" aria-label="官网导航">
          <a href="/#try-it">看看怎么学</a>
          <a href="/guide" aria-current={page === "guide" ? "page" : undefined}>
            使用帮助
          </a>
          <a className="site-login" href="/login">
            进入网页版 <span aria-hidden="true">↗</span>
          </a>
        </nav>
        <WorkspaceAppearanceMenu />
      </header>
      <main className="site-main" id="site-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div>
          <strong>语见 · Seen & Said</strong>
          <p>从一句看见的英文，到一句自己的表达。</p>
        </div>
        <nav aria-label="官网页脚">
          <a href="/guide">使用帮助</a>
          <a href="/privacy">隐私说明</a>
          <a href="mailto:niu0619@gmail.com">联系 Neil</a>
        </nav>
        <p className="site-personal">为本人及朋友制作的英语学习工具。</p>
      </footer>
    </div>
  );
}
