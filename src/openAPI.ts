import {
  extendZodWithOpenApi,
  OpenAPIGenerator,
  OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import { RequestHandler, Router } from "express";
import { getSchemaOfOpenAPIRoute } from "./openAPIRoute";
import { z, ZodArray, ZodEffects, ZodObject } from "zod";

extendZodWithOpenApi(z);

export type OpenAPIDocument = ReturnType<OpenAPIGenerator["generateDocument"]>;

export function buildOpenAPIDocument(
  apiRouters: Router[],
  apiSchemaPaths: string[],
  config: Parameters<OpenAPIGenerator["generateDocument"]>[0]
) {
  const registry = new OpenAPIRegistry();
  // Attach all of the Zod schemas to the OpenAPI specification
  // as components that can be referenced in the API definitions
  const schemas = apiSchemaPaths
    .flatMap((apiSchemaPath) =>
      Object.entries(
        require(apiSchemaPath) as { [key: string]: z.ZodType<any> }
      )
    )
    .filter(
      ([key, schema]) =>
        schema instanceof ZodObject || schema instanceof ZodArray
    )
    .map(([key, schema]) => ({
      key,
      schema,
      registered: registry.register(key, schema),
    }));

  const referencingNamedSchemas = (type?: z.ZodType<any>) => {
    if (!type) {
      return undefined;
    }
    if (type instanceof ZodEffects) {
      const nonEffectedObj = schemas.find(
        (s) => s.key === type._def.openapi?.refId
      );
      if (nonEffectedObj) {
        return nonEffectedObj.registered;
      } else {
        return type.innerType();
      }
    }
    const named = schemas.find((a) => a.schema === type);
    if (named) {
      return named.registered;
    }
    if (type instanceof ZodArray) {
      const namedChild = schemas.find((a) => a.schema === type.element);
      if (namedChild) {
        return z.array(namedChild.registered);
      }
    }
    return type;
  };

  // Attach all the API routes, referencing the named components where
  // possible, and falling back to inlining the Zod shapes.
  getRoutes(apiRouters).forEach(({ path, method, handler }) => {
    const { tag, body, params, query, response, description, summary } =
      getSchemaOfOpenAPIRoute(handler) || {};
    //Express: /path/to/:variable/something -> OpenAPI /path/to/{variable}/something
    const pathOpenAPIFormat = path
      .split("/")
      .filter((p) => p.includes(":"))
      .reduce(
        (iPath, replaceMe) =>
          iPath.replace(
            new RegExp(replaceMe, "gi"),
            `{${replaceMe.substring(1)}}`
          ),
        path
      );
    registry.registerPath({
      tags: [tag || "default"],
      method: method,
      summary: summary,
      path: pathOpenAPIFormat,
      description: description,
      request: {
        params: asZodObject(referencingNamedSchemas(params)),
        query: asZodObject(referencingNamedSchemas(query)),
        body: referencingNamedSchemas(body),
      },
      responses: response
        ? {
            200: {
              mediaType: "application/json",
              schema: referencingNamedSchemas(response)!.openapi({
                description: "200",
              }),
            },
          }
        : {
            204: z
              .void()
              .openapi({ description: "No content - successful operation" }),
          },
    });
  });

  const generator = new OpenAPIGenerator(registry.definitions);
  const openapiJSON = generator.generateDocument(config);

  // Verify that none of the "parameters" are appearing as optional, which is invalid
  // in the official OpenAPI spec and unsupported by readme.io
  for (const [route, impl] of Object.entries(openapiJSON.paths)) {
    for (const method of Object.keys(impl)) {
      for (const param of impl[method].parameters || []) {
        if (param.required === false && param.in === "path") {
          throw new Error(
            `OpenAPI Error: The route ${route} has an optional parameter ${param.name} in the path. ` +
              `Optional parameters in the route path are not supported by readme.io. Make the parameter required ` +
              `or split the route definition into two separate ones, one with the param and one without.`
          );
        }
      }
    }
  }
  return openapiJSON;
}

// Helpers
const asZodObject = (type?: z.ZodType<any>) => {
  if (type && type instanceof ZodObject) {
    return type;
  }
  return undefined;
};

// Disable naming convention because fast_slash comes from Express.
const regexPrefixToString = (path: {
  fast_slash: unknown;
  toString: () => string;
}): string => {
  if (path.fast_slash) {
    return "";
  }
  return path
    .toString()
    .replace(`/^\\`, "")
    .replace("(?:\\/(?=$))?(?=\\/|$)/i", "");
};

export const getRoutes = (routers: Router[]) => {
  const routes: {
    path: string;
    method: "get" | "post" | "put" | "delete";
    handler: RequestHandler;
  }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processMiddleware = (middleware: any, prefix = ""): void => {
    if (middleware.name === "router" && middleware.handle.stack) {
      for (const subMiddleware of middleware.handle.stack) {
        processMiddleware(
          subMiddleware,
          `${prefix}${regexPrefixToString(middleware.regexp)}`
        );
      }
    }
    if (!middleware.route) {
      return;
    }
    routes.push({
      path: `${prefix}${middleware.route.path}`,
      method: middleware.route.stack[0].method,
      handler: middleware.route.stack[middleware.route.stack.length - 1].handle,
    });
  };
  // Can remove this any when @types/express upgrades to v5
  for (const router of routers) {
    for (const middleware of router.stack) {
      processMiddleware(middleware);
    }
  }
  return routes;
};
