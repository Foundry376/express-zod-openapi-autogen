/* eslint-disable @typescript-eslint/no-explicit-any */
import { RouteConfig } from "@asteasolutions/zod-to-openapi";
import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, ZodSchema, ZodTypeAny, z } from "zod";
import { ErrorResponse } from "./schemas";

const globalConfig: { warnOnly: boolean } = { warnOnly: false };

/**
 * Set global configuration for all openAPIRoute handlers. Per-route options
 * on SchemaDefinition take precedence over this global default.
 */
export const configureOpenAPIRoute = (config: { warnOnly?: boolean }) => {
  if (config.warnOnly !== undefined) {
    globalConfig.warnOnly = config.warnOnly;
  }
};

type ValidatedMiddleware<ZBody, ZQuery, ZParams, ZResponse> = (
  req: Request<ZParams, any, ZBody, ZQuery>,
  res: Response<ZResponse | { error: string } | z.infer<typeof ErrorResponse>>,
  next: NextFunction,
) => any;

type SchemaDefinition<
  TBody extends ZodTypeAny,
  TQuery extends ZodTypeAny,
  TParams extends ZodTypeAny,
  TResponse extends ZodTypeAny,
> = {
  /**The category this route should be displayed in within the OpenAPI documentation. */
  tag: string;
  /**A short one-line description of the route */
  summary: string;
  /**A long-form explanation of the route  */
  description?: string;
  /**A string key identifying the type of authorization used on this route.
   * Should match one of the security types declared when the OpenAPI documentation
   * is built. */
  security?: string;
  /**The zod schema defining the POST body of the request. */
  body?: TBody;
  /**The zod schema defining the query string of the request. Use .optional() for optional
   * query params. Declare the entire object .strict() to fail if extra parameters are
   * passed, or .strip() to quietly remove them.
   */
  query?: TQuery;
  /**The zod schema defining the route params (eg: /users/:id). Note that these are always
   * string values. Defining them mostly just provides better typescript types on req.params.
   */
  params?: TParams;
  /**The zod schema of the successful API response. In development mode, passing data that
   * does not match this type will yield a console warning.
   */
  response?: TResponse;
  /**The content-type of the response, if it is not JSON. Typically this is passed
   * instead of a response schema for responses that are text/csv, application/pdf, etc.
   */
  responseContentType?: string;
  /** Mark the route as deprecated in generated OpenAPI docs. Does not have any impact on routing. */
  deprecated?: boolean;

  /** Provide a function to apply additional post-processing to the OpenAPI route configuration generated
   * based on your API handler. This is the last function to run before the OpenAPI route is added to the registry.
   */
  finalizeRouteConfig?: (config: RouteConfig) => RouteConfig;

  /** When true, validation failures for body, query, and params will log console warnings
   * instead of returning 400 errors. Useful for rolling out Zod schemas on an existing API
   * where you want to verify schemas match real traffic before enforcing them.
   * Overrides the global setting from configureOpenAPIRoute when specified.
   */
  warnOnly?: boolean;
};

const check = <TType>(obj?: any, schema?: ZodSchema<TType>): z.ZodSafeParseResult<TType> => {
  if (!schema) {
    return { success: true, data: obj };
  }
  const r = schema.safeParse(obj);
  return r;
};

type ValidatedRequestHandler = RequestHandler & {
  validateSchema: SchemaDefinition<any, any, any, any>;
};

export const getSchemaOfOpenAPIRoute = (fn: RequestHandler | ValidatedRequestHandler) => {
  return "validateSchema" in fn ? (fn["validateSchema"] as SchemaDefinition<any, any, any, any>) : null;
};

export const getErrorSummary = (error: ZodError<unknown>) => {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join(", ");
};

/**
 * Note: This function wraps the route handler rather than just being a chained piece
 * of middleware so that we can validate the response shape as well as the request shape.
 */
export const openAPIRoute = <
  TBody extends ZodTypeAny,
  TQuery extends ZodTypeAny,
  TParams extends ZodTypeAny,
  TResponse extends ZodTypeAny,
>(
  schema: SchemaDefinition<TBody, TQuery, TParams, TResponse>,
  middleware: ValidatedMiddleware<z.infer<TBody>, z.infer<TQuery>, z.infer<TParams>, z.infer<TResponse>>,
): RequestHandler => {
  const fn: ValidatedRequestHandler = async (req, res, next) => {
    const bodyResult = check(req.body, schema.body);
    const queryResult = check(req.query, schema.query);
    const paramResult = check(req.params, schema.params);

    const warnOnly = schema.warnOnly ?? globalConfig.warnOnly;

    const allPassed = bodyResult.success && queryResult.success && paramResult.success;

    if (!allPassed && !warnOnly) {
      if (!bodyResult.success) {
        return res.status(400).json({ error: getErrorSummary(bodyResult.error) });
      }
      if (!queryResult.success) {
        return res.status(400).json({ error: getErrorSummary(queryResult.error) });
      }
      if (!paramResult.success) {
        return res.status(400).json({ error: getErrorSummary(paramResult.error) });
      }
      return next(new Error("zod-express-guard could not validate this request"));
    }

    if (!allPassed) {
      if (!bodyResult.success) {
        console.warn(`openAPIRoute: body validation failed: ${getErrorSummary(bodyResult.error)}`);
      }
      if (!queryResult.success) {
        console.warn(`openAPIRoute: query validation failed: ${getErrorSummary(queryResult.error)}`);
      }
      if (!paramResult.success) {
        console.warn(`openAPIRoute: params validation failed: ${getErrorSummary(paramResult.error)}`);
      }
    }

    // Patch the `res.json` method we pass into the handler so that we can validate the response
    // body and warn if it doesn't match the provided response schema.
    const _json = res.json;
    res.json = (body: unknown) => {
      // In dev + test, validate that the JSON response from the endpoint matches
      // the Zod schemas. In production, we skip this because it's just time consuming
      if (process.env.NODE_ENV !== "production") {
        const acceptable = z.union([schema.response as ZodTypeAny, ErrorResponse]);
        const result = schema.response ? acceptable.safeParse(body) : { success: true };

        if (result.success === false && "error" in result) {
          console.warn(`Note: Response JSON does not match schema:\n${getErrorSummary(result.error)}`);
        }
      }
      return _json.apply(res, [body]);
    };

    // Reassign parsed data for validations that succeeded; leave originals for failures
    if (queryResult.success) {
      Object.defineProperty(req, "query", { value: queryResult.data });
    }
    if (bodyResult.success) {
      Object.defineProperty(req, "body", { value: bodyResult.data });
    }
    if (paramResult.success) {
      Object.defineProperty(req, "params", { value: paramResult.data });
    }

    try {
      return await middleware(
        req as unknown as Request<z.output<TParams>, any, z.output<TBody>, z.output<TQuery>>,
        res,
        next,
      );
    } catch (err) {
      return next(err);
    }
  };
  fn.validateSchema = schema;
  return fn;
};
