import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App, authenticatedLandingPath } from "./app.js";
import { parseAuthRoute } from "./auth-route.js";
import { createWebAnalysisApi } from "./analysis-api.js";
import { fetchCsrfToken } from "./csrf-token.js";
import { createWebIdentityApi } from "./identity-api.js";
import { createWebLearningLibraryApi } from "./learning-library-api.js";
import { createWebPracticeApi } from "./practice-api.js";
import { createWebWordLibraryApi } from "./word-library-api.js";
import { createWebExternalWordbookApi } from "./external-wordbook-api.js";
import { createWebAdminOperationsApi } from "./admin-operations-api.js";
import { createWebStudyCaptureApi } from "./study-capture-api.js";
import { resolveWebBootstrap } from "./public-bootstrap.js";
import { parsePasswordRecoveryRoute } from "./password-recovery-route.js";
import { HostedAcceptanceNotice } from "./hosted-acceptance-notice.js";
import { LocalAcceptanceNotice } from "./local-acceptance-notice.js";
import "./styles.css";
import "./account-quota-page.css";
import "./account-data-rights-page.css";
import "./analysis-page.css";
import "./analysis-history-page.css";
import "./library-page.css";
import "./practice-page.css";
import "./word-page.css";
import "./external-wordbook-page.css";
import "./admin-operations-page.css";
import "./privacy-page.css";
import "./study-inbox.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Web application root is missing.");

let api;
let identity;
const acceptanceModel = import.meta.env.VITE_ACCEPTANCE_MODEL;
const deploymentEnvironment = import.meta.env.VITE_DEPLOYMENT_ENVIRONMENT;
const googleAuthentication = import.meta.env.VITE_GOOGLE_AUTHENTICATION;
const deploymentCommit = HUAYI_DEPLOYMENT_COMMIT;
const bootstrap = resolveWebBootstrap(location.pathname, {
  ...(acceptanceModel === undefined ? {} : { VITE_ACCEPTANCE_MODEL: acceptanceModel }),
  VITE_API_ORIGIN: import.meta.env.VITE_API_ORIGIN,
  ...(deploymentEnvironment === undefined
    ? {}
    : { VITE_DEPLOYMENT_ENVIRONMENT: deploymentEnvironment }),
  ...(deploymentCommit === "" ? {} : { VITE_DEPLOYMENT_COMMIT: deploymentCommit }),
  ...(googleAuthentication === undefined
    ? {}
    : { VITE_GOOGLE_AUTHENTICATION: googleAuthentication }),
});
if (bootstrap.environment !== undefined) {
  const environment = bootstrap.environment;
  const analysisApi = createWebAnalysisApi({
    apiOrigin: environment.VITE_API_ORIGIN,
    csrfToken: () => fetchCsrfToken(environment.VITE_API_ORIGIN),
    fetch: (input, init) => fetch(input, init),
  });
  api = Object.assign(
    analysisApi,
    createWebLearningLibraryApi({
      apiOrigin: environment.VITE_API_ORIGIN,
      csrfToken: () => fetchCsrfToken(environment.VITE_API_ORIGIN),
      fetch: (input, init) => fetch(input, init),
    }),
    createWebPracticeApi({
      apiOrigin: environment.VITE_API_ORIGIN,
      csrfToken: () => fetchCsrfToken(environment.VITE_API_ORIGIN),
      fetch: (input, init) => fetch(input, init),
    }),
    createWebWordLibraryApi({
      apiOrigin: environment.VITE_API_ORIGIN,
      csrfToken: () => fetchCsrfToken(environment.VITE_API_ORIGIN),
      fetch: (input, init) => fetch(input, init),
    }),
    createWebExternalWordbookApi({
      apiOrigin: environment.VITE_API_ORIGIN,
      csrfToken: () => fetchCsrfToken(environment.VITE_API_ORIGIN),
      fetch: (input, init) => fetch(input, init),
    }),
    createWebAdminOperationsApi({
      apiOrigin: environment.VITE_API_ORIGIN,
      csrfToken: () => fetchCsrfToken(environment.VITE_API_ORIGIN),
      fetch: (input, init) => fetch(input, init),
    }),
    createWebStudyCaptureApi({
      apiOrigin: environment.VITE_API_ORIGIN,
      csrfToken: () => fetchCsrfToken(environment.VITE_API_ORIGIN),
      fetch: (input, init) => fetch(input, init),
    }),
  );
  identity = createWebIdentityApi({
    apiOrigin: environment.VITE_API_ORIGIN,
    fetch: (input, init) => fetch(input, init),
  });
} else {
  api = undefined;
  identity = undefined;
}

const pairingMatch = /^\/pair-extension\/([A-Za-z0-9_-]{1,128})$/u.exec(location.pathname);
const authRoute = parseAuthRoute(location.pathname, location.hash);
const passwordRecoveryRoute = parsePasswordRecoveryRoute(location.pathname, location.search);
const page =
  location.pathname === "/settings/account"
    ? "account"
    : location.pathname === "/admin"
      ? "admin"
      : location.pathname === "/settings/data"
        ? "data"
        : location.pathname === "/settings/devices"
          ? "devices"
          : location.pathname === "/analysis"
            ? "analysis"
            : location.pathname === "/practice"
              ? "practice"
              : location.pathname === "/practice/history"
                ? "practice-history"
                : location.pathname === "/words"
                  ? "words"
                  : location.pathname === "/words/wordbooks"
                    ? "wordbooks"
                    : location.pathname === "/history"
                      ? "history"
                      : location.pathname === "/library"
                        ? "library"
                        : "inbox";

createRoot(root).render(
  <StrictMode>
    <HostedAcceptanceNotice commit={bootstrap.environment?.VITE_DEPLOYMENT_COMMIT} />
    <LocalAcceptanceNotice mode={acceptanceModel === "simulated" ? "simulated" : undefined} />
    <App
      api={api}
      accountApi={identity}
      authRoute={authRoute}
      googleAuthenticationEnabled={bootstrap.environment?.VITE_GOOGLE_AUTHENTICATION === "enabled"}
      identity={identity}
      onAuthenticated={(access) => location.assign(authenticatedLandingPath(access))}
      onPasswordRecoveryCompleted={() => location.assign("/login")}
      page={page}
      pairingId={pairingMatch?.[1]}
      passwordRecoveryApi={identity}
      passwordRecoveryRoute={passwordRecoveryRoute}
      publicPage={bootstrap.publicPage}
      replaceInvitationUrl={() => history.replaceState(null, "", "/join")}
      replaceRecoveryUrl={() => history.replaceState(null, "", "/recover")}
    />
  </StrictMode>,
);
