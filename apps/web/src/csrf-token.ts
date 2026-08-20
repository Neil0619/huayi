import { csrfTokenResponseSchema } from "@huayi/cloud-contracts";

export async function fetchCsrfToken(
  apiOrigin: string,
  request: typeof fetch = fetch,
): Promise<string> {
  const response = await request(new URL("/v1/auth/csrf", apiOrigin), {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Huayi CSRF bootstrap failed with ${response.status}.`);
  return csrfTokenResponseSchema.parse(await response.json()).csrfToken;
}
