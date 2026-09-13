import {
  accountDataExportFormatRequestSchema,
  accountDataExportFormatVersionSchema,
  accountDataExportJobReadResourceSchema,
  accountDataRightsHttpRoutes,
  currentAccountDataExportReadResponseSchema,
  csrfTokenResponseSchema,
  downloadAccountDataExportResponseSchema,
  retryAccountDataExportReadRequestSchema,
  type AccountDataExportFormatVersion,
  type AccountDataExportJobReadResource,
} from "@huayi/cloud-contracts";

function path(template: string, id: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw new TypeError("Resource ID is invalid.");
  return template.replace(":id", encodeURIComponent(id));
}
function formatInput(formatVersion: AccountDataExportFormatVersion) {
  accountDataExportFormatVersionSchema.parse(formatVersion);
  return accountDataExportFormatRequestSchema.parse(formatVersion === 1 ? {} : { formatVersion });
}
function job(value: unknown, format: AccountDataExportFormatVersion) {
  const parsed = accountDataExportJobReadResourceSchema.parse(value);
  if (parsed.formatVersion !== format) throw new Error("Export format mismatch.");
  return parsed;
}
export async function readLatestAccountExport(
  read: (
    format: AccountDataExportFormatVersion,
  ) => Promise<{ job: AccountDataExportJobReadResource | null }>,
) {
  const responses = await Promise.all(([1, 2, 3] as const).map(read));
  const jobs = responses.flatMap((value) => (value.job ? [value.job] : []));
  const active = (value: AccountDataExportJobReadResource) =>
    ["pending", "running", "ready"].includes(value.state) ? 1 : 0;
  jobs.sort(
    (a, b) =>
      active(b) - active(a) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  return { job: jobs[0] ?? null };
}

export function createWebAccountExportApi(
  request: (path: string, init?: RequestInit) => Promise<Response>,
) {
  const headers = (csrfToken: string) => ({
    "Content-Type": "application/json",
    "X-CSRF-Token": csrfTokenResponseSchema.parse({ access: "full", csrfToken }).csrfToken,
  });
  return {
    async createAccountDataExport(csrf: string, format: AccountDataExportFormatVersion = 1) {
      const response = await request(accountDataRightsHttpRoutes.createExport, {
        body: JSON.stringify(formatInput(format)),
        credentials: "include",
        method: "POST",
        headers: { ...headers(csrf), "Idempotency-Key": crypto.randomUUID() },
      });
      return job(await response.json(), format);
    },
    async getCurrentAccountDataExport(format: AccountDataExportFormatVersion = 1) {
      formatInput(format);
      const response = await request(
        accountDataRightsHttpRoutes.currentExport +
          (format === 1 ? "" : `?formatVersion=${format}`),
        { credentials: "include", headers: { Accept: "application/json" } },
      );
      const current = currentAccountDataExportReadResponseSchema.parse(await response.json());
      return { job: current.job ? job(current.job, format) : null };
    },
    async retryAccountDataExport(
      id: string,
      revision: number,
      csrf: string,
      format: AccountDataExportFormatVersion = 1,
    ) {
      const input = retryAccountDataExportReadRequestSchema.parse({
        expectedRevision: revision,
        ...formatInput(format),
      });
      const response = await request(path(accountDataRightsHttpRoutes.retryExport, id), {
        body: JSON.stringify(input),
        credentials: "include",
        method: "POST",
        headers: {
          ...headers(csrf),
          "Idempotency-Key": crypto.randomUUID(),
          "X-Huayi-Revision": `"${revision}"`,
        },
      });
      const current = job(await response.json(), format);
      if (current.id !== id) throw new Error("Export identity mismatch.");
      return current;
    },
    async downloadAccountDataExport(
      id: string,
      csrf: string,
      format: AccountDataExportFormatVersion = 1,
    ) {
      const response = await request(path(accountDataRightsHttpRoutes.downloadExport, id), {
        body: JSON.stringify(formatInput(format)),
        credentials: "include",
        method: "POST",
        headers: headers(csrf),
      });
      return downloadAccountDataExportResponseSchema.parse(await response.json());
    },
  };
}
