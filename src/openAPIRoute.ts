/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, ZodSchema, ZodTypeAny, z } from "zod";

export const ErrorResponse = z.object({
  error: z.string(),
});

export type ErrorResponse = z.infer<typeof ErrorResponse>;

type ValidatedMiddleware<TBody, TQuery, TParams, TResponse> = (
  req: Request<TParams, any, TBody, TQuery>,
  res: Response<TResponse | z.infer<typeof ErrorResponse>>,
  next: NextFunction
) => any;

type SchemaDefinition<TBody, TQuery, TParams, TResponse> = {
  tag: string;
  summary: string;
  description?: string;
  body?: ZodSchema<TBody>;
  query?: ZodSchema<TQuery>;
  params?: ZodSchema<TParams>;
  response?: ZodSchema<TResponse>;
};

const check = <TType>(
  obj?: any,
  schema?: ZodSchema<TType>
): z.SafeParseReturnType<TType, TType> => {
  if (!schema) {
    return { success: true, data: obj };
  }
  const r = schema.safeParse(obj);
  return r;
};

type ValidatedRequestHandler = RequestHandler & {
  validateSchema: SchemaDefinition<any, any, any, any>;
};

export const getSchemaOfOpenAPIRoute = (
  fn: RequestHandler | ValidatedRequestHandler
) => {
  return "validateSchema" in fn
    ? (fn["validateSchema"] as SchemaDefinition<any, any, any, any>)
    : null;
};

export const getErrorSummary = (error: ZodError<unknown>) => {
  return error.issues
    .map((i) =>
      i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message
    )
    .join(", ");
};

/**
 * Note: This function wraps the route handler rather than just being a chained piece
 * of middleware so that we can validate the response shape as well as the request shape.
 */
export const openAPIRoute = <
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  TResponse = unknown
>(
  schema: SchemaDefinition<TBody, TQuery, TParams, TResponse>,
  middleware: ValidatedMiddleware<TBody, TQuery, TParams, TResponse>
): RequestHandler => {
  const fn: ValidatedRequestHandler = async (req, res, next) => {
    const bodyResult = check(req.body, schema.body);
    const queryResult = check(req.query, schema.query);
    const paramResult = check(req.params, schema.params);

    if (bodyResult.success && queryResult.success && paramResult.success) {
      // Patch the `res.json` method we pass into the handler so that we can validate the response
      // body and warn if it doesn't match the provided response schema.
      const _json = res.json;
      res.json = (body: unknown) => {
        // In dev + test, validate that the JSON response from the endpoint matches
        // the Zod schemas. In production, we skip this because it's just time consuming
        if (process.env.NODE_ENV !== "production") {
          const acceptable = z.union([
            schema.response as ZodTypeAny,
            ErrorResponse,
          ]);
          const result = schema.response
            ? acceptable.safeParse(body)
            : { success: true };

          if (result.success === false && "error" in result) {
            console.warn(
              `Note: Response JSON does not match schema:\n${getErrorSummary(
                result.error
              )}`
            );
          }
        }
        return _json.apply(res, [body]);
      };

      Object.defineProperty(req, "query", { value: queryResult.data });
      Object.defineProperty(req, "body", { value: bodyResult.data });
      Object.defineProperty(req, "params", { value: paramResult.data });

      try {
        return await middleware(
          req as unknown as Request<TParams, any, TBody, TQuery>,
          res,
          next
        );
      } catch (err) {
        return next(err);
      }
    }

    if (!bodyResult.success) {
      return res.status(400).json({ error: getErrorSummary(bodyResult.error) });
    }

    if (!queryResult.success) {
      return res
        .status(400)
        .json({ error: getErrorSummary(queryResult.error) });
    }

    if (!paramResult.success) {
      return res
        .status(400)
        .json({ error: getErrorSummary(paramResult.error) });
    }

    return next(new Error("zod-express-guard could not validate this request"));
  };
  fn.validateSchema = schema;
  return fn;
};
