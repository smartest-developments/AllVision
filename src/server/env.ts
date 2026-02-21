import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "postgresql:" || parsed.protocol === "postgres:";
      } catch {
        return false;
      }
    }, "DATABASE_URL must be a valid postgres connection URL")
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = parsedEnv.data;
