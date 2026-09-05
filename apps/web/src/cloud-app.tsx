import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import type { WebIdentityApi } from "./identity-api.js";
import { WebIdentityApiError } from "./identity-api.js";
import type { InboxApi } from "./inbox-app.js";
import { StudyInbox } from "./study-inbox.js";
import type { WebStudyCaptureApi } from "./study-capture-api.js";
import { DeviceSessionsPage } from "./device-sessions-page.js";
import { PasteAnalysisPage, type PasteAnalysisApi } from "./paste-analysis-page.js";
import { LearningLibraryPage, type LearningLibraryApi } from "./learning-library-page.js";
import { PracticePage, type PracticePageApi } from "./practice-page.js";
import { PracticeHistoryPage } from "./practice-history-page.js";
import type { PracticeHistoryPageApi } from "./practice-history-page-api.js";
import { WordLibraryPage } from "./word-library-page.js";
import type { WebWordLibraryApi } from "./word-library-api.js";
import { AnalysisHistoryPage } from "./analysis-history-page.js";
import type { AnalysisHistoryPageApi } from "./analysis-history-page-api.js";
import { AccountQuotaPage, type AccountQuotaApi } from "./account-quota-page.js";
import { ExternalWordbookPage } from "./external-wordbook-page.js";
import type { WebExternalWordbookApi } from "./external-wordbook-api.js";
import { AccountDataRightsPage } from "./account-data-rights-page.js";
import { AdminOperationsPage } from "./admin-operations-page.js";
import type { WebAdminOperationsApi } from "./admin-operations-api.js";
import { WorkspaceShell, type WorkspaceSection } from "./workspace-shell.js";
import { PairingApprovalForm } from "./pairing-approval-form.js";

export type IdentityApi = Pick<
  WebIdentityApi,
  | "approvePairing"
  | "bootstrap"
  | "createAccountDataExport"
  | "deleteAccount"
  | "downloadAccountDataExport"
  | "getCurrentAccountDataExport"
  | "getAccountPreferences"
  | "getPairing"
  | "listExtensionSessions"
  | "logout"
  | "reauthenticatePassword"
  | "retryAccountDataExport"
  | "revokeExtensionSession"
>;
export type CloudPage =
  | "account"
  | "admin"
  | "analysis"
  | "data"
  | "devices"
  | "history"
  | "inbox"
  | "library"
  | "practice"
  | "practice-history"
  | "words"
  | "wordbooks";

type ViewState = "approved" | "error" | "loading" | "pending" | "signed-out";
type StudyInboxApi = InboxApi & WebStudyCaptureApi;

function workspaceSection(page: CloudPage): WorkspaceSection {
  if (page === "practice" || page === "practice-history") return "practice";
  if (page === "analysis") return "analysis";
  if (page === "library") return "library";
  if (page === "words" || page === "wordbooks") return "words";
  if (page === "history") return "history";
  if (page === "account" || page === "data" || page === "devices") return "settings";
  return "inbox";
}

export function CloudApp({
  accountApi,
  adminApi,
  analysisApi,
  historyApi,
  identity,
  googleAuthenticationEnabled = false,
  inboxApi,
  libraryApi,
  practiceApi,
  practiceHistoryApi,
  wordApi,
  wordbookApi,
  page = "inbox",
  pairingId,
}: {
  accountApi?: AccountQuotaApi | undefined;
  adminApi?: WebAdminOperationsApi | undefined;
  analysisApi?: PasteAnalysisApi | undefined;
  historyApi?: AnalysisHistoryPageApi | undefined;
  identity: IdentityApi;
  googleAuthenticationEnabled?: boolean | undefined;
  inboxApi?: StudyInboxApi | undefined;
  libraryApi?: LearningLibraryApi | undefined;
  practiceApi?: PracticePageApi | undefined;
  practiceHistoryApi?: PracticeHistoryPageApi | undefined;
  wordApi?: WebWordLibraryApi | undefined;
  wordbookApi?: WebExternalWordbookApi | undefined;
  page?: CloudPage | undefined;
  pairingId?: string | undefined;
}) {
  const [csrfToken, setCsrfToken] = useState("");
  const [sessionAccess, setSessionAccess] = useState<"data-rights" | "full">("full");
  const [cloudUploadConsent, setCloudUploadConsent] = useState(false);
  const [cloudWordCopyMode, setCloudWordCopyMode] = useState<"disabled" | "enabled">("enabled");
  const [deviceLabel, setDeviceLabel] = useState("我的 Chrome 浏览器");
  const [extensionQueryModelMode, setExtensionQueryModelMode] = useState<"byok" | "platform">(
    "platform",
  );
  const [preferencesRevision, setPreferencesRevision] = useState(1);
  const [studyCaptureMode, setStudyCaptureMode] = useState<"automatic" | "manual">("manual");
  const [operator, setOperator] = useState(false);
  const [state, setState] = useState<ViewState>("loading");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const bootstrap = await identity.bootstrap();
        if (!active) return;
        setCsrfToken(bootstrap.csrfToken);
        setSessionAccess(bootstrap.access);
        if (pairingId === undefined) {
          setState("pending");
          return;
        }
        const [pairing, preferences] = await Promise.all([
          identity.getPairing(pairingId),
          identity.getAccountPreferences(),
        ]);
        if (!active) return;
        setCloudWordCopyMode(preferences.cloudWordCopyMode);
        setExtensionQueryModelMode(preferences.extensionQueryModelMode);
        setPreferencesRevision(preferences.revision);
        setStudyCaptureMode(preferences.studyCaptureMode);
        setState(
          pairing.status === "pending"
            ? "pending"
            : pairing.status === "approved"
              ? "approved"
              : "error",
        );
      } catch (error) {
        if (!active) return;
        setState(
          error instanceof WebIdentityApiError && error.code === "authentication_required"
            ? "signed-out"
            : "error",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [identity, pairingId]);

  useEffect(() => {
    if (
      adminApi === undefined ||
      pairingId !== undefined ||
      sessionAccess !== "full" ||
      state !== "pending"
    ) {
      setOperator(false);
      return;
    }
    let active = true;
    void adminApi
      .access()
      .then(() => active && setOperator(true))
      .catch(() => active && setOperator(false));
    return () => {
      active = false;
    };
  }, [adminApi, pairingId, sessionAccess, state]);

  const approve = async (event: FormEvent) => {
    event.preventDefault();
    if (pairingId === undefined || !cloudUploadConsent) return;
    try {
      await identity.approvePairing(pairingId, {
        cloudWordCopyMode,
        deviceLabel,
        expectedPreferencesRevision: preferencesRevision,
        extensionQueryModelMode,
        studyCaptureMode,
      });
      setState("approved");
    } catch {
      setState("error");
    }
  };

  if (state === "loading")
    return (
      <main className="configuration-error" id="main-content">
        <span aria-hidden="true" className="brand-mark" />
        <p className="eyebrow">SEEN & SAID</p>
        <h1>正在确认登录状态</h1>
        <p role="status">正在确认登录状态…</p>
      </main>
    );
  if (state === "signed-out") {
    return (
      <main className="configuration-error" id="main-content">
        <span aria-hidden="true" className="brand-mark" />
        <p className="eyebrow">SEEN & SAID</p>
        <h1>需要先登录</h1>
        <p role="status">当前会话无效。请前往登录页后重试。</p>
        <a href="/login">前往登录</a>
      </main>
    );
  }
  if (state === "approved")
    return (
      <main className="configuration-error" id="main-content">
        <span aria-hidden="true" className="brand-mark" />
        <p className="eyebrow">SEEN & SAID</p>
        <h1>设备配对已批准</h1>
        <p role="status">扩展设备已批准，可以返回扩展。</p>
      </main>
    );
  if (state === "error")
    return (
      <main className="configuration-error" id="main-content">
        <span aria-hidden="true" className="brand-mark" />
        <p className="eyebrow">SEEN & SAID</p>
        <h1>无法继续配对</h1>
        <p role="alert">无法继续这次配对，请重新从扩展发起。</p>
      </main>
    );
  if (pairingId === undefined) {
    const dataRightsPage = (showAccountNavigation: boolean) => (
      <AccountDataRightsPage
        api={{
          createAccountDataExport: () => identity.createAccountDataExport(csrfToken),
          deleteAccount: () => identity.deleteAccount(csrfToken),
          downloadAccountDataExport: (exportId) =>
            identity.downloadAccountDataExport(exportId, csrfToken),
          getCurrentAccountDataExport: () => identity.getCurrentAccountDataExport(),
          logout: () => identity.logout(csrfToken),
          retryAccountDataExport: (exportId, revision) =>
            identity.retryAccountDataExport(exportId, revision, csrfToken),
        }}
        onSessionEnded={() => {
          setCsrfToken("");
          setState("signed-out");
        }}
        showAccountNavigation={showAccountNavigation}
        showOperatorNavigation={operator}
      />
    );
    if (sessionAccess === "data-rights")
      return <WorkspaceShell access="data-rights">{dataRightsPage(false)}</WorkspaceShell>;
    if (page === "admin" && adminApi !== undefined)
      return (
        <AdminOperationsPage
          api={adminApi}
          csrfToken={csrfToken}
          onCsrfTokenChanged={setCsrfToken}
          reauthenticationApi={identity}
        />
      );

    let content: ReactNode;
    if (page === "data") content = dataRightsPage(true);
    else if (page === "account" && accountApi !== undefined)
      content = (
        <AccountQuotaPage
          api={accountApi}
          csrfToken={csrfToken}
          googleAuthenticationEnabled={googleAuthenticationEnabled}
          onCsrfTokenChanged={setCsrfToken}
          showOperatorNavigation={operator}
        />
      );
    else if (page === "devices")
      content = <DeviceSessionsPage api={identity} showOperatorNavigation={operator} />;
    else if (page === "analysis" && inboxApi !== undefined)
      content = <StudyInbox captureApi={inboxApi} reviewApi={inboxApi} pasteDefault />;
    else if (page === "analysis" && analysisApi !== undefined)
      content = <PasteAnalysisPage api={analysisApi} />;
    else if (page === "history" && historyApi !== undefined)
      content = <AnalysisHistoryPage api={historyApi} />;
    else if (page === "library" && libraryApi !== undefined)
      content = <LearningLibraryPage api={libraryApi} />;
    else if (page === "practice" && practiceApi !== undefined)
      content = <PracticePage api={practiceApi} />;
    else if (page === "practice-history" && practiceHistoryApi !== undefined)
      content = <PracticeHistoryPage api={practiceHistoryApi} />;
    else if (page === "words" && wordApi !== undefined) content = <WordLibraryPage api={wordApi} />;
    else if (page === "wordbooks" && wordbookApi !== undefined)
      content = <ExternalWordbookPage api={wordbookApi} />;
    else
      content =
        inboxApi === undefined ? (
          <section className="configuration-error">
            <span aria-hidden="true" className="brand-mark" />
            <p className="eyebrow">SEEN & SAID</p>
            <h1>登录状态有效</h1>
            <p role="status">登录状态有效。</p>
          </section>
        ) : (
          <StudyInbox captureApi={inboxApi} reviewApi={inboxApi} />
        );

    return (
      <WorkspaceShell access="full" activeSection={workspaceSection(page)}>
        {content}
      </WorkspaceShell>
    );
  }
  return (
    <PairingApprovalForm
      approve={approve}
      cloudUploadConsent={cloudUploadConsent}
      cloudWordCopyMode={cloudWordCopyMode}
      deviceLabel={deviceLabel}
      extensionQueryModelMode={extensionQueryModelMode}
      setCloudUploadConsent={setCloudUploadConsent}
      setCloudWordCopyMode={setCloudWordCopyMode}
      setDeviceLabel={setDeviceLabel}
      setExtensionQueryModelMode={setExtensionQueryModelMode}
      setStudyCaptureMode={setStudyCaptureMode}
      studyCaptureMode={studyCaptureMode}
    />
  );
}
