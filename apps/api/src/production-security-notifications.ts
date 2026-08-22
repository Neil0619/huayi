import type { AnalysisDatabase } from "./analysis-database.js";
import type { ApiEnvironment } from "./environment.js";
import { createPostgresSecurityNotificationRepository } from "./postgres-security-notification.js";
import {
  createResendSecurityNotificationSender,
  type SecurityNotificationFetch,
} from "./resend-security-notification-sender.js";
import { createSecurityNotificationAlert } from "./security-notification-alert.js";
import { createSecurityNotificationApp } from "./security-notification-app.js";
import { createSecurityNotificationWorker } from "./security-notification-worker.js";
import { systemClock, systemSecrets } from "./security.js";

export function createProductionSecurityNotifications(options: {
  database: AnalysisDatabase;
  environment: ApiEnvironment;
  fetch?: SecurityNotificationFetch;
}) {
  if (options.environment.HUAYI_SECURITY_NOTIFICATION_MODE === "disabled-local-acceptance") {
    return createSecurityNotificationApp({
      cronSecret: options.environment.CRON_SECRET,
      worker: {
        async runOne() {
          return "idle";
        },
      },
    });
  }
  const worker = createSecurityNotificationWorker({
    alert: createSecurityNotificationAlert(),
    now: () => systemClock.now(),
    repository: createPostgresSecurityNotificationRepository(options.database, {
      clock: systemClock,
      pepper: options.environment.HUAYI_SECRET_PEPPER,
      secrets: systemSecrets,
    }),
    sender: createResendSecurityNotificationSender({
      apiKey: options.environment.HUAYI_RESEND_API_KEY,
      fetch: options.fetch ?? globalThis.fetch,
      from: options.environment.HUAYI_SECURITY_NOTIFICATION_FROM,
      replyTo: options.environment.HUAYI_SECURITY_NOTIFICATION_REPLY_TO,
    }),
  });
  return createSecurityNotificationApp({
    cronSecret: options.environment.CRON_SECRET,
    worker,
  });
}
