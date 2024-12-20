import {
  extendZodWithOpenApi,
  OpenApiGeneratorV3,
  OpenApiGeneratorV31,
  OpenAPIRegistry,
  ResponseConfig,
  RouteConfig,
} from "@asteasolutions/zod-to-openapi";
import { OpenApiVersion } from "@asteasolutions/zod-to-openapi/dist/openapi-generator";
import { RequestHandler, Router } from "express";
import type { ComponentsObject } from "openapi3-ts/oas30";
import { z, ZodArray, ZodEffects, ZodObject } from "zod";
import { getSchemaOfOpenAPIRoute } from "./openAPIRoute";
import { ErrorResponse } from "./schemas";

extendZodWithOpenApi(z);

export type OpenAPIDocument = ReturnType<OpenApiGeneratorV3["generateDocument"]>;
export type OpenAPIV31Document = ReturnType<OpenApiGeneratorV31["generateDocument"]>;
export type OpenAPIComponents = ReturnType<OpenApiGeneratorV3["generateComponents"]>;
export type OpenAPIConfig = Parameters<OpenApiGeneratorV3["generateDocument"]>[0];

export function buildOpenAPIDocument(args: {
  config: Omit<OpenAPIConfig, "openapi">;
  routers: Router[];
  schemaPaths: string[];
  errors: { 401?: string; 403?: string };
  securitySchemes?: ComponentsObject["securitySchemes"];
  openApiVersion: OpenApiVersion;
}): OpenAPIDocument | OpenAPIV31Document {
  const { config, routers, schemaPaths, securitySchemes, errors, openApiVersion } = args;
  const registry = new OpenAPIRegistry();
  // Attach all of the Zod schemas to the OpenAPI specification
  // as components that can be referenced in the API definitions
  const schemas = schemaPaths
    .flatMap((apiSchemaPath) => Object.entries(require(apiSchemaPath) as { [key: string]: z.ZodType<any> }))
    .filter(([key, schema]) => schema instanceof ZodObject || schema instanceof ZodArray)
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
      const nonEffectedObj = schemas.find((s) => s.key === type._def.openapi?._internal?.refId);
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
  getRoutes(routers).forEach(({ path, method, handler }) => {
    const {
      tag,
      body,
      params,
      query,
      response,
      description,
      summary,
      security,
      deprecated,
      finalizeRouteConfig,
      responseContentType,
    } = getSchemaOfOpenAPIRoute(handler) || {};

    //Express: /path/to/:variable/something -> OpenAPI /path/to/{variable}/something
    const pathOpenAPIFormat = path
      .split("/")
      .filter((p) => p.includes(":"))
      .reduce((iPath, replaceMe) => iPath.replace(new RegExp(replaceMe, "gi"), `{${replaceMe.substring(1)}}`), path);

    const responses: {
      [statusCode: string]: ResponseConfig;
    } = {};

    if (errors[401]) {
      responses[401] = {
        description: errors[401],
        content: {
          "application/json": {
            schema: ErrorResponse,
          },
        },
      };
    }
    if (errors[403]) {
      responses[403] = {
        description: errors[403],
        content: {
          "application/json": {
            schema: ErrorResponse,
          },
        },
      };
    }

    // If the request includes path parameters, a 404 error is most likely possible
    if (params) {
      responses[404] = {
        description: "The item you requested could not be found",
        content: {
          "application/json": {
            schema: ErrorResponse,
          },
        },
      };
    }

    // If the request includes a query string or request body, Zod 400 errors are possible
    if (query || body) {
      responses[400] = {
        description: "The request payload or query string parameter you passed was not valid",
        content: {
          "application/json": {
            schema: ErrorResponse,
          },
        },
      };
    }

    // If the API defines a response, assume a 200. If no response schema is specified
    // we assume the response will be a 204 No Content
    if (responseContentType) {
      responses[200] = {
        description: `A ${responseContentType} payload`,
        content: {
          [responseContentType]: {
            schema: z.unknown(),
          },
        },
      };
    } else if (response) {
      responses[200] = {
        description: "200",
        content: {
          "application/json": {
            schema: referencingNamedSchemas(response)!,
          },
        },
      };
    } else {
      responses[204] = { description: "No content - successful operation" };
    }
    let openapiRouteConfig: RouteConfig = {
      tags: [tag || "default"],
      method: method,
      summary: summary,
      path: pathOpenAPIFormat,
      description: description,
      deprecated: deprecated,
      security: security ? [{ [security]: [] }] : undefined,
      request: {
        params: asZodObject(referencingNamedSchemas(params)),
        query: asZodObject(referencingNamedSchemas(query)),
        body: body
          ? {
              content: {
                "application/json": {
                  schema: referencingNamedSchemas(body),
                },
              },
            }
          : undefined,
      },
      responses: responses,
    };
    if (finalizeRouteConfig) {
      openapiRouteConfig = finalizeRouteConfig(openapiRouteConfig);
    }

    registry.registerPath(openapiRouteConfig);
  });

  const generator =
    openApiVersion === "3.1.0"
      ? new OpenApiGeneratorV31(registry.definitions)
      : new OpenApiGeneratorV3(registry.definitions);
  const openapiJSON = generator.generateDocument({ ...config, openapi: openApiVersion });

  // Attach the security schemes provided
  if (securitySchemes) {
    openapiJSON.components!.securitySchemes ||= {};
    Object.assign(openapiJSON.components!.securitySchemes, securitySchemes);
  }

  // Verify that none of the "parameters" are appearing as optional, which is invalid
  // in the official OpenAPI spec and unsupported by readme.io
  if (openapiJSON.paths) {
    for (const [route, impl] of Object.entries(openapiJSON.paths)) {
      for (const key of Object.keys(impl)) {
        const method = key as keyof typeof impl;
        for (const param of impl[method].parameters || []) {
          if (param.required === false && param.in === "path") {
            param.required = true;
            console.warn(
              `OpenAPI Warning: The route ${route} has an optional parameter ${param.name} in the path. ` +
                `Optional parameters in the route path are not supported by readme.io. Make the parameter required ` +
                `or split the route definition into two separate ones, one with the param and one without.`,
            );
          }
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
const regexPrefixToString = (path: { fast_slash: unknown; toString: () => string }): string => {
  if (path.fast_slash) {
    return "";
  }
  return path.toString().replace(`/^\\`, "").replace("(?:\\/(?=$))?(?=\\/|$)/i", "");
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
        processMiddleware(subMiddleware, `${prefix}${regexPrefixToString(middleware.regexp)}`);
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
