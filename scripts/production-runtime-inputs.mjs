import { readProductionCredential } from "./production-credentials.mjs";
import { loadProductionRuntimeSecrets } from "./production-runtime-credentials.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import { buildProductionEnvironment } from "./production-release-environment.mjs";

const projectRef = "pxqqgxfumovegbcxnmzb";

export async function loadProductionRuntimeEnvironment({
  readCredential = readProductionCredential,
  readRuntimeSecrets = loadProductionRuntimeSecrets,
  readCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  fetch_ = globalThis.fetch,
} = {}) {
  try {
    // Read only: never generate, overwrite or fall back to acceptance credentials.
    const token = await readCredential("supabase-management-token");
    const read = async (suffix) => {
      const response = await fetch_(`https://api.supabase.com/v1/projects/${projectRef}${suffix}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      const text = await response.text();
      if (text.length > 100000) throw new Error();
      return JSON.parse(text);
    };
    const project = await read("");
    if (
      project.id !== projectRef ||
      project.organization_id !== "ipkurvkfzrhqdxtfeuzz" ||
      project.region !== "ap-southeast-1" ||
      project.status !== "ACTIVE_HEALTHY"
    )
      throw new Error();
    const keys = await read("/api-keys?reveal=true");
    if (!Array.isArray(keys)) throw new Error();
    const publishable = keys.filter((k) => k.type === "publishable" && k.name === "default");
    const serviceRole = keys.filter(
      (k) => k.type === "legacy" && k.id === "service_role" && k.name === "service_role",
    );
    if (
      publishable.length !== 1 ||
      serviceRole.length !== 1 ||
      !publishable[0].api_key?.startsWith("sb_publishable_")
    )
      throw new Error();
    const claims = JSON.parse(
      Buffer.from(serviceRole[0].api_key.split(".")[1], "base64url").toString("utf8"),
    );
    if (claims.ref !== projectRef || claims.role !== "service_role") throw new Error();
    return buildProductionEnvironment({
      ...(await readRuntimeSecrets()),
      databaseCa: await readCertificate(),
      deepseekApiKey: await readCredential("deepseek-api-key"),
      resendNotificationKey: await readCredential("resend-notification-key"),
      supabasePublishableKey: publishable[0].api_key,
      supabaseServiceRoleKey: serviceRole[0].api_key,
    });
  } catch {
    throw new Error("Production runtime credentials or project identity are unavailable.");
  }
}
