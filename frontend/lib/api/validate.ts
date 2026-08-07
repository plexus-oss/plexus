/**
 * Request body validation using Zod schemas.
 *
 * Usage in route handlers:
 *   const body = await validateBody(request, CreateSourceSchema);
 *   // body is typed and validated — throws ApiError on failure
 */

import { z } from "zod";
import { apiError } from "./errors";

/**
 * Parse request JSON and validate against a Zod schema.
 * Throws ApiError(VALIDATION_ERROR) with Zod issue details on failure.
 */
export async function validateBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw apiError("VALIDATION_ERROR", "Invalid JSON body");
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw apiError("VALIDATION_ERROR", "Request validation failed", issues);
  }

  return result.data;
}
