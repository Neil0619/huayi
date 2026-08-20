import {
  idempotencyKeySchema,
  studyCaptureCreateRequestSchema,
  studyCaptureCreateResponseSchema,
  studyCaptureDeleteRequestSchema,
  studyCaptureDeleteResponseSchema,
  studyCaptureHttpRoutes,
  type StudyCaptureCreateRequest,
} from "@huayi/cloud-contracts";

import { extensionSessionHeaders } from "../cloud/extension-session-headers.js";

export type CloudStudyCaptureFailureKind =
  "authentication" | "client-upgrade-required" | "permanent" | "transient";

export class CloudStudyCaptureError extends Error {
  constructor(readonly kind: CloudStudyCaptureFailureKind) {
    super(`Huayi StudyCapture request failed: ${kind}.`);
    this.name = "CloudStudyCaptureError";
  }
}

interface CloudStudyCaptureApiOptions {
  readonly apiOrigin: string;
  readonly clientVersion: string;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function fixedOrigin(value: string): URL {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError("Huayi API origin is invalid.");
  }
  return parsed;
}

export function createCloudStudyCaptureApi(options: CloudStudyCaptureApiOptions) {
  const origin = fixedOrigin(options.apiOrigin);
  const headers = (sessionToken: string) => {
    try {
      return extensionSessionHeaders(sessionToken, options.clientVersion);
    } catch {
      throw new CloudStudyCaptureError("authentication");
    }
  };
  const execute = async (url: URL, init: RequestInit) => {
    let response: Response;
    try {
      response = await options.fetch(url, init);
    } catch {
      throw new CloudStudyCaptureError("transient");
    }
    if (response.status === 401 || response.status === 403) {
      throw new CloudStudyCaptureError("authentication");
    }
    if ([408, 425, 429].includes(response.status) || response.status >= 500) {
      throw new CloudStudyCaptureError("transient");
    }
    if (response.status === 426) throw new CloudStudyCaptureError("client-upgrade-required");
    if (!response.ok) throw new CloudStudyCaptureError("permanent");
    return response;
  };
  return {
    async submit(input: StudyCaptureCreateRequest, idempotencyKey: string, sessionToken: string) {
      const content = studyCaptureCreateRequestSchema.parse(input);
      const key = idempotencyKeySchema.parse(idempotencyKey);
      const response = await execute(new URL(studyCaptureHttpRoutes.create, origin), {
        body: JSON.stringify(content),
        credentials: "omit",
        headers: {
          ...headers(sessionToken),
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        method: "POST",
      });
      try {
        return studyCaptureCreateResponseSchema.parse(await response.json());
      } catch {
        throw new CloudStudyCaptureError("transient");
      }
    },
    async undo(
      captureId: string,
      expectedRevision: number,
      idempotencyKey: string,
      sessionToken: string,
    ) {
      if (!/^[A-Za-z0-9_-]{1,128}$/u.test(captureId)) {
        throw new CloudStudyCaptureError("permanent");
      }
      const content = studyCaptureDeleteRequestSchema.parse({ expectedRevision });
      const key = idempotencyKeySchema.parse(idempotencyKey);
      const response = await execute(
        new URL(
          studyCaptureHttpRoutes.detail.replace(":id", encodeURIComponent(captureId)),
          origin,
        ),
        {
          body: JSON.stringify(content),
          credentials: "omit",
          headers: {
            ...headers(sessionToken),
            "Content-Type": "application/json",
            "Idempotency-Key": key,
            "If-Match": `"${expectedRevision}"`,
          },
          method: "DELETE",
        },
      );
      try {
        return studyCaptureDeleteResponseSchema.parse(await response.json());
      } catch {
        throw new CloudStudyCaptureError("transient");
      }
    },
  };
}

export type CloudStudyCaptureApi = ReturnType<typeof createCloudStudyCaptureApi>;
