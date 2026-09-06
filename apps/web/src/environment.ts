import { z } from "zod";

function isExactHttpsOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

const exactHttpsOriginSchema = z
  .string()
  .refine(isExactHttpsOrigin, "Expected an exact HTTPS origin without credentials or a path.");

const webEnvironmentSchema = z
  .object({
    VITE_ACCEPTANCE_MODEL: z.literal("simulated").optional(),
    VITE_API_ORIGIN: exactHttpsOriginSchema,
    VITE_DEPLOYMENT_COMMIT: z
      .string()
      .regex(/^[0-9a-f]{40}$/u)
      .optional(),
    VITE_DEPLOYMENT_ENVIRONMENT: z.enum(["hosted-acceptance", "production"]).optional(),
    VITE_GOOGLE_AUTHENTICATION: z.literal("enabled").optional(),
  })
  .strict()
  .superRefine((environment, context) => {
    if (
      environment.VITE_ACCEPTANCE_MODEL === "simulated" &&
      (environment.VITE_API_ORIGIN !== "https://api.acceptance.localhost:8444" ||
        environment.VITE_DEPLOYMENT_ENVIRONMENT !== undefined ||
        environment.VITE_DEPLOYMENT_COMMIT !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "The simulated model is restricted to local acceptance.",
      });
    }
    const hasDeploymentField =
      environment.VITE_DEPLOYMENT_ENVIRONMENT !== undefined ||
      environment.VITE_DEPLOYMENT_COMMIT !== undefined ||
      environment.VITE_API_ORIGIN === "https://api.seen-said.cn";
    const expectedApiOrigin =
      environment.VITE_DEPLOYMENT_ENVIRONMENT === "production"
        ? "https://api.seen-said.cn"
        : "https://api.acceptance.seen-said.cn";
    if (
      hasDeploymentField &&
      (environment.VITE_DEPLOYMENT_ENVIRONMENT === undefined ||
        environment.VITE_DEPLOYMENT_COMMIT === undefined ||
        environment.VITE_API_ORIGIN !== expectedApiOrigin ||
        environment.VITE_ACCEPTANCE_MODEL !== undefined ||
        environment.VITE_GOOGLE_AUTHENTICATION !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Deployment environment requires its exact origin and deployment identity.",
      });
    }
  });

export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

export function parseWebEnvironment(
  environment: Record<string, string | undefined>,
): WebEnvironment {
  return webEnvironmentSchema.parse(environment);
}
