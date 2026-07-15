import { z } from "zod";

function addInvalidBaseUrlIssue(context: z.RefinementCtx): void {
  context.addIssue({ code: "custom", message: "Compatible HTTP base URL is invalid." });
}

export const compatibleHttpBaseUrlSchema = z.string().superRefine((value, context) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    addInvalidBaseUrlIssue(context);
    return;
  }

  const isHostOnly = url.pathname === "/" && value === url.href.slice(0, -1);
  const canonicalValue = isHostOnly ? url.href.slice(0, -1) : url.href;
  if (
    url.protocol !== "http:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    value.includes("?") ||
    value.includes("#") ||
    (!isHostOnly && url.pathname.endsWith("/")) ||
    url.pathname.endsWith("/responses") ||
    value !== canonicalValue
  ) {
    addInvalidBaseUrlIssue(context);
  }
});

const common = {
  allowInsecureHttp: z.literal(true),
  baseUrl: compatibleHttpBaseUrlSchema,
  schemaVersion: z.literal(1),
};

export const compatibleHttpConfigurationSchema = z.discriminatedUnion("model", [
  z.strictObject({ ...common, effort: z.literal("low"), model: z.literal("gpt-5.4-mini") }),
  z.strictObject({ ...common, effort: z.literal("none"), model: z.literal("gpt-5.6-luna") }),
]);

export type CompatibleHttpConfiguration = z.infer<typeof compatibleHttpConfigurationSchema>;
