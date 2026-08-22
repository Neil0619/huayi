import type { ApiEnvironment } from "./environment.js";
import { createRuntimeSql } from "./runtime-sql.js";

export function createProductionRuntimeSql(environment: ApiEnvironment) {
  const tlsCa =
    environment.HUAYI_SECURITY_NOTIFICATION_MODE === "resend"
      ? Buffer.from(environment.HUAYI_DATABASE_TLS_CA_BASE64, "base64").toString("utf8")
      : undefined;
  return createRuntimeSql(environment.HUAYI_DATABASE_URL, tlsCa);
}
