import { useEffect, useState } from "react";

import { InboxApp, type InboxApi } from "./inbox-app.js";
import { CloudApp, type CloudPage, type IdentityApi } from "./cloud-app.js";
import { AuthPage, type AuthApi, type AuthRoute } from "./auth-page.js";
import type { PasteAnalysisApi } from "./paste-analysis-page.js";
import type { LearningLibraryApi } from "./learning-library-page.js";
import type { PracticePageApi } from "./practice-page.js";
import type { PracticeHistoryPageApi } from "./practice-history-page-api.js";
import type { WebWordLibraryApi } from "./word-library-api.js";
import type { AnalysisHistoryPageApi } from "./analysis-history-page-api.js";
import type { AccountQuotaApi } from "./account-quota-page.js";
import type { WebExternalWordbookApi } from "./external-wordbook-api.js";
import type { WebAdminOperationsApi } from "./admin-operations-api.js";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
import { PrivacyPage } from "./privacy-page.js";
import type { PublicPage } from "./public-bootstrap.js";
import { PasswordRecoveryPage, type PasswordRecoveryApi } from "./password-recovery-page.js";
import type { PasswordRecoveryRoute } from "./password-recovery-route.js";
import { WorkspaceShell } from "./workspace-shell.js";
import { WebAppearanceController } from "./web-appearance-controller.js";

export function authenticatedLandingPath(access: "data-rights" | "full") {
  return access === "data-rights" ? "/settings/data" : "/practice";
}

const workspacePages = new Map<string, CloudPage>([
  ["/admin", "admin"],
  ["/analysis", "analysis"],
  ["/app", "inbox"],
  ["/history", "history"],
  ["/library", "library"],
  ["/practice", "practice"],
  ["/practice/history", "practice-history"],
  ["/settings/account", "account"],
  ["/settings/data", "data"],
  ["/settings/devices", "devices"],
  ["/words", "words"],
  ["/words/wordbooks", "wordbooks"],
]);

export function cloudPageFromPathname(pathname: string): CloudPage | undefined {
  return workspacePages.get(pathname);
}

function AppSurface({
  accountApi,
  api,
  identity,
  googleAuthenticationEnabled = false,
  authRoute,
  onAuthenticated = (access) => location.assign(authenticatedLandingPath(access)),
  onPasswordRecoveryCompleted = () => location.assign("/login"),
  page,
  pairingId,
  publicPage,
  passwordRecoveryApi,
  passwordRecoveryRoute,
  replaceRecoveryUrl = () => history.replaceState(null, "", "/recover"),
  replaceInvitationUrl = () => history.replaceState(null, "", "/join"),
}: {
  readonly accountApi?: AccountQuotaApi | undefined;
  readonly api?:
    | (InboxApi &
        AnalysisHistoryPageApi &
        WebAdminOperationsApi &
        LearningLibraryApi &
        PasteAnalysisApi &
        PracticeHistoryPageApi &
        PracticePageApi &
        WebStudyCaptureApi &
        WebWordLibraryApi &
        WebExternalWordbookApi)
    | undefined;
  readonly authRoute?: AuthRoute | undefined;
  readonly googleAuthenticationEnabled?: boolean | undefined;
  readonly identity?: (AuthApi & IdentityApi) | undefined;
  readonly onAuthenticated?: ((access: "data-rights" | "full") => void) | undefined;
  readonly onPasswordRecoveryCompleted?: (() => void) | undefined;
  readonly page?: CloudPage | undefined;
  readonly pairingId?: string | undefined;
  readonly publicPage?: PublicPage | undefined;
  readonly passwordRecoveryApi?: PasswordRecoveryApi | undefined;
  readonly passwordRecoveryRoute?: PasswordRecoveryRoute | undefined;
  readonly replaceInvitationUrl?: (() => void) | undefined;
  readonly replaceRecoveryUrl?: (() => void) | undefined;
}) {
  if (publicPage === "privacy") return <PrivacyPage />;
  if (passwordRecoveryApi !== undefined && passwordRecoveryRoute !== undefined) {
    return (
      <PasswordRecoveryPage
        api={passwordRecoveryApi}
        onCompleted={onPasswordRecoveryCompleted}
        replaceRecoveryUrl={replaceRecoveryUrl}
        route={passwordRecoveryRoute}
      />
    );
  }
  if (identity !== undefined && authRoute !== undefined) {
    return (
      <AuthPage
        api={identity}
        googleAuthenticationEnabled={googleAuthenticationEnabled}
        onAuthenticated={onAuthenticated}
        replaceInvitationUrl={replaceInvitationUrl}
        {...authRoute}
      />
    );
  }
  if (identity !== undefined)
    return (
      <CloudApp
        accountApi={accountApi}
        adminApi={api}
        analysisApi={api}
        historyApi={api}
        identity={identity}
        googleAuthenticationEnabled={googleAuthenticationEnabled}
        inboxApi={api}
        libraryApi={api}
        practiceHistoryApi={api}
        practiceApi={api}
        wordApi={api}
        wordbookApi={api}
        page={page}
        pairingId={pairingId}
      />
    );
  if (api !== undefined)
    return (
      <WorkspaceShell access="full" activeSection="inbox">
        <InboxApp api={api} />
      </WorkspaceShell>
    );
  return (
    <main className="configuration-error" id="main-content">
      <span aria-hidden="true" className="brand-mark" />
      <p className="eyebrow">SEEN & SAID</p>
      <h1>学习工作台尚未连接</h1>
      <p role="alert">此构建缺少有效的 API Origin，已停止业务请求。请完成部署配置后重试。</p>
    </main>
  );
}

export function App(props: Parameters<typeof AppSurface>[0]) {
  const [page, setPage] = useState<CloudPage>(
    () => props.page ?? cloudPageFromPathname(location.pathname) ?? "inbox",
  );
  const workspaceNavigationEnabled =
    props.identity !== undefined &&
    props.authRoute === undefined &&
    props.passwordRecoveryRoute === undefined &&
    props.publicPage === undefined &&
    props.pairingId === undefined;

  useEffect(() => {
    if (props.page !== undefined) setPage(props.page);
  }, [props.page]);

  useEffect(() => {
    if (!workspaceNavigationEnabled) return;
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (
        anchor === null ||
        anchor.download !== "" ||
        (anchor.target !== "" && anchor.target !== "_self")
      ) {
        return;
      }
      const destination = new URL(anchor.href, location.href);
      const nextPage = cloudPageFromPathname(destination.pathname);
      if (
        destination.origin !== location.origin ||
        nextPage === undefined ||
        destination.hash !== ""
      ) {
        return;
      }
      event.preventDefault();
      history.pushState(null, "", `${destination.pathname}${destination.search}`);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      setPage(nextPage);
    };
    const restore = () => {
      const restored = cloudPageFromPathname(location.pathname);
      if (restored !== undefined) setPage(restored);
    };
    document.addEventListener("click", navigate);
    window.addEventListener("popstate", restore);
    return () => {
      document.removeEventListener("click", navigate);
      window.removeEventListener("popstate", restore);
    };
  }, [workspaceNavigationEnabled]);

  return (
    <WebAppearanceController>
      <AppSurface {...props} page={workspaceNavigationEnabled ? page : props.page} />
    </WebAppearanceController>
  );
}
