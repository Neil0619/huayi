import { useEffect, useState, type FormEvent } from "react";

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

export function CloudApp({
  accountApi,
  adminApi,
  analysisApi,
  historyApi,
  identity,
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
  const [deviceLabel, setDeviceLabel] = useState("");
  const [extensionQueryModelMode, setExtensionQueryModelMode] = useState<"byok" | "platform">(
    "platform",
  );
  const [preferencesRevision, setPreferencesRevision] = useState(1);
  const [studyCaptureMode, setStudyCaptureMode] = useState<"automatic" | "manual">("manual");
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

  const approve = async (event: FormEvent) => {
    event.preventDefault();
    if (pairingId === undefined || !cloudUploadConsent) return;
    try {
      await identity.approvePairing(
        pairingId,
        {
          cloudWordCopyMode,
          deviceLabel,
          expectedPreferencesRevision: preferencesRevision,
          extensionQueryModelMode,
          studyCaptureMode,
        },
        csrfToken,
      );
      setState("approved");
    } catch {
      setState("error");
    }
  };

  if (state === "loading")
    return (
      <main className="configuration-error" id="main-content">
        <span aria-hidden="true" className="brand-mark" />
        <p className="eyebrow">HUAYI CLOUD</p>
        <h1>正在确认登录状态</h1>
        <p role="status">正在确认登录状态…</p>
      </main>
    );
  if (state === "signed-out") {
    return (
      <main className="configuration-error" id="main-content">
        <span aria-hidden="true" className="brand-mark" />
        <p className="eyebrow">HUAYI CLOUD</p>
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
        <p className="eyebrow">HUAYI CLOUD</p>
        <h1>设备配对已批准</h1>
        <p role="status">扩展设备已批准，可以返回扩展。</p>
      </main>
    );
  if (state === "error")
    return (
      <main className="configuration-error" id="main-content">
        <span aria-hidden="true" className="brand-mark" />
        <p className="eyebrow">HUAYI CLOUD</p>
        <h1>无法继续配对</h1>
        <p role="alert">无法继续这次配对，请重新从扩展发起。</p>
      </main>
    );
  if (pairingId === undefined) {
    if (sessionAccess === "data-rights" || page === "data")
      return (
        <AccountDataRightsPage
          api={{
            createAccountDataExport: () => identity.createAccountDataExport(csrfToken),
            deleteAccount: () => identity.deleteAccount(csrfToken),
            downloadAccountDataExport: (exportId) =>
              identity.downloadAccountDataExport(exportId, csrfToken),
            getCurrentAccountDataExport: () => identity.getCurrentAccountDataExport(),
            retryAccountDataExport: (exportId, revision) =>
              identity.retryAccountDataExport(exportId, revision, csrfToken),
          }}
          onAccountDeleted={() => {
            setCsrfToken("");
            setState("signed-out");
          }}
        />
      );
    if (page === "account" && accountApi !== undefined)
      return (
        <AccountQuotaPage
          adminApi={adminApi}
          api={accountApi}
          csrfToken={csrfToken}
          onCsrfTokenChanged={setCsrfToken}
        />
      );
    if (page === "admin" && adminApi !== undefined)
      return <AdminOperationsPage api={adminApi} csrfToken={csrfToken} />;
    if (page === "devices") return <DeviceSessionsPage api={identity} csrfToken={csrfToken} />;
    if (page === "analysis" && analysisApi !== undefined)
      return <PasteAnalysisPage api={analysisApi} />;
    if (page === "history" && historyApi !== undefined)
      return <AnalysisHistoryPage api={historyApi} />;
    if (page === "library" && libraryApi !== undefined)
      return <LearningLibraryPage api={libraryApi} />;
    if (page === "practice" && practiceApi !== undefined) return <PracticePage api={practiceApi} />;
    if (page === "practice-history" && practiceHistoryApi !== undefined)
      return <PracticeHistoryPage api={practiceHistoryApi} />;
    if (page === "words" && wordApi !== undefined) return <WordLibraryPage api={wordApi} />;
    if (page === "wordbooks" && wordbookApi !== undefined)
      return <ExternalWordbookPage api={wordbookApi} />;
    return inboxApi === undefined ? (
      <main className="configuration-error" id="main-content">
        <span aria-hidden="true" className="brand-mark" />
        <p className="eyebrow">HUAYI CLOUD</p>
        <h1>登录状态有效</h1>
        <p role="status">登录状态有效。</p>
      </main>
    ) : (
      <StudyInbox captureApi={inboxApi} reviewApi={inboxApi} />
    );
  }
  return (
    <main className="configuration-error" id="main-content">
      <span aria-hidden="true" className="brand-mark" />
      <p className="eyebrow">HUAYI CLOUD</p>
      <h1>批准扩展设备</h1>
      <p>仅在你刚刚从华译扩展发起配对时继续。</p>
      <p>
        连接后，platform 查询只发送最小选区并最多保留一小时；扩展只会按下面的账号偏好保存
        StudyCapture 原始学习意图或复制未来新增单词。BYOK 分析结果、API Key、页面 URL、标题、视频 ID
        和完整页面不会上传。
      </p>
      <form onSubmit={(event) => void approve(event)}>
        <label htmlFor="device-label">设备名称</label>
        <input
          autoComplete="off"
          id="device-label"
          maxLength={100}
          name="deviceLabel"
          onChange={(event) => setDeviceLabel(event.currentTarget.value)}
          required
          value={deviceLabel}
        />
        <label>
          插件查询模型
          <select
            name="extensionQueryModelMode"
            onChange={(event) =>
              setExtensionQueryModelMode(event.currentTarget.value as "byok" | "platform")
            }
            value={extensionQueryModelMode}
          >
            <option value="platform">使用 Web 平台额度</option>
            <option value="byok">使用各插件本机 BYOK Key</option>
          </select>
        </label>
        <label>
          待学习采集
          <select
            name="studyCaptureMode"
            onChange={(event) =>
              setStudyCaptureMode(event.currentTarget.value as "automatic" | "manual")
            }
            value={studyCaptureMode}
          >
            <option value="manual">手动加入</option>
            <option value="automatic">查询后自动加入</option>
          </select>
        </label>
        <label>
          云端单词副本
          <select
            name="cloudWordCopyMode"
            onChange={(event) =>
              setCloudWordCopyMode(event.currentTarget.value as "disabled" | "enabled")
            }
            value={cloudWordCopyMode}
          >
            <option value="enabled">复制未来新增词</option>
            <option value="disabled">仅保存在各插件本机</option>
          </select>
        </label>
        <label>
          <input
            checked={cloudUploadConsent}
            name="cloudUploadConsent"
            onChange={(event) => setCloudUploadConsent(event.currentTarget.checked)}
            required
            type="checkbox"
          />
          我了解并同意上述华译云端同步
        </label>
        <button disabled={!cloudUploadConsent} type="submit">
          批准此设备
        </button>
      </form>
    </main>
  );
}
