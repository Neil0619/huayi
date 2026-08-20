import { Hono } from "hono";

import type { AnalysisDatabase } from "./analysis-database.js";
import { createAccountProfileApp } from "./account-profile-app.js";
import { createAccountSignInMethodsApp } from "./account-sign-in-methods-app.js";
import { createPostgresAccountProfile } from "./postgres-account-profile.js";
import { createPostgresAccountSignInMethods } from "./postgres-account-sign-in-methods.js";
import { authenticateWebAccountRequest } from "./web-account-authentication.js";

type WebAccountIdentity = Parameters<typeof authenticateWebAccountRequest>[0];

export function createProductionAccountSettings(options: {
  database: AnalysisDatabase;
  identity: WebAccountIdentity;
  minSupportedExtensionVersion: string;
}) {
  const authenticate = (context: Parameters<typeof authenticateWebAccountRequest>[1]) =>
    authenticateWebAccountRequest(options.identity, context);
  const app = new Hono();
  app.route(
    "/",
    createAccountProfileApp({
      authenticate,
      module: createPostgresAccountProfile({
        database: options.database,
        minSupportedExtensionVersion: options.minSupportedExtensionVersion,
      }),
    }),
  );
  app.route(
    "/",
    createAccountSignInMethodsApp({
      authenticate,
      read: createPostgresAccountSignInMethods(options.database).read,
    }),
  );
  return app;
}
