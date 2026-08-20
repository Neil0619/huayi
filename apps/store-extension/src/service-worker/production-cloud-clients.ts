import { createCloudWordbookApi } from "./cloud-wordbook-api.js";
import { createCloudIdentityApi } from "./cloud-identity-api.js";
import { createCloudStudyCaptureApi } from "./cloud-study-capture-api.js";
import { createCloudWordCopyApi } from "./cloud-word-copy-api.js";
import { createCloudExtensionQueryApi } from "./cloud-extension-query-api.js";

function releaseOrigin(value: string | null): string | null {
  if (value === null) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === ""
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

export function createProductionCloudClients(
  apiOrigin: string | null,
  clientVersion: string,
  fetchRequest: typeof fetch,
) {
  const origin = releaseOrigin(apiOrigin);
  if (origin === null) {
    return {
      extensionQueries: null,
      identity: null,
      studyCaptures: null,
      wordCopies: null,
      wordbooks: null,
    };
  }
  return {
    extensionQueries: createCloudExtensionQueryApi({
      apiOrigin: origin,
      clientVersion,
      fetch: fetchRequest,
    }),
    identity: createCloudIdentityApi({
      apiOrigin: origin,
      clientVersion,
      fetch: fetchRequest,
    }),
    studyCaptures: createCloudStudyCaptureApi({
      apiOrigin: origin,
      clientVersion,
      fetch: fetchRequest,
    }),
    wordCopies: createCloudWordCopyApi({
      apiOrigin: origin,
      clientVersion,
      fetch: fetchRequest,
    }),
    wordbooks: createCloudWordbookApi({
      apiOrigin: origin,
      clientVersion,
      fetch: fetchRequest,
    }),
  };
}
