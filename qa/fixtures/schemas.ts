import { z } from "zod";

/**
 * Response shapes as contract, straight from docs/specs/03-api-contract.md §0-§1
 * and docs/specs/05-user-layers.md §5. `.strict()` makes an added or renamed
 * field a test failure.
 */

export const PublicUser = z
  .object({
    id: z.string(),
    username: z.string(),
    email: z.string(),
  })
  .strict();

export const AuthSuccess = z
  .object({
    user: PublicUser,
    accessToken: z.string().min(1),
  })
  .strict();

export const GeneralError = z
  .object({
    error: z.string().min(1),
  })
  .strict();

export const ValidationError = z
  .object({
    errors: z
      .array(
        z
          .object({
            field: z.string(),
            message: z.string(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

/** Either of the two — and only these two — error shapes. */
export function isOneOfTheTwoErrorShapes(body: unknown): { ok: boolean; which?: "error" | "errors"; reason?: string } {
  if (GeneralError.safeParse(body).success) return { ok: true, which: "error" };
  if (ValidationError.safeParse(body).success) return { ok: true, which: "errors" };
  return { ok: false, reason: `body is neither {error} nor {errors:[{field,message}]}: ${JSON.stringify(body)}` };
}
