## express-zod-openapi-autogen

This repository provides (relatively) un-opinionated utility methods for creating Express APIs that leverage Zod for request and response validation and auto-generate OpenAPI documentation.

## Requirements

- Express@^5.0
- Zod@^3.14

## Basic Use

In your route files, wrap each route handler in `openAPIRoute`. The `tag`, `summary`, and `description` determine how the route is grouped and presented in the OpenAPI schema.

- The `params`, `query`, `body` and `response` are Zod schemas.

- The `openAPIRoute` middleware will automatically validate that the incoming data matches your schemas and return 400 errors if required fields are missing, etc. Your route handler will receive typed fields (`req.query` will match your Zod schema) and you can trust that the data matches the schema.

- The `response` schema is not required, but OpenAPI routes missing a response schema are documented as returning `204 No Content`. If you provide a response schema, the Express `res.json` is typed to expect the schema. When NODE_ENV=development, the `openAPIRoute` middleware will console.warn if your response data does not align with your response schema.

- If you omit one of the Zod schemas, no validation is performed and you receive the untyped data in your route handler.

```ts
router.get(
  '/users/:id',
  openAPIRoute(
    {
      tag: 'Users',
      summary: 'This is how you receive a specific user',
      description: 'Longer form details about the route',
      params: z.object({ id: z.string() }),
      query: z.object({ debugInfo: z.boolean().optional() }),
      response: UserSchema,
    },
    async (req, res) => {
      ...
    }
  )
);
```

Create a folder to hold your Zod schemas (eg: `src/schemas`), and export common types you plan to use repeatedly. For example, in our project we have `UserSchema`. Some APIs return `UserSchema` and others return `z.array(UserSchema)`.

We'll pass a reference to these schemas to the OpenAPI generator, allowing it to define them as OpenAPI component schemas and reference them in our API route definitions.

In your Express application's `app.ts` file, load your route files containing public routes into an array, and pass them to `buildOpenAPIDocument` to create an OpenAPI schema. Note that `buildOpenAPIDocument` will throw errors if your Zod schemas are incomplete or cannot be translated to OpenAPI schemas.

```ts
import { buildOpenAPIDocument } from "express-zod-openapi-autogen";
import swaggerUI from "swagger-ui-express";

const PublicAPIs = [require("./routes/users").default, require("./routes/session").default];

// Attach API routes
for (const router of PublicAPIs) {
  app.use(`${prefix}/api`, router);
}

// Public documentation (auto-generated for all routes above this line)
try {
  const doc = buildOpenAPIDocument({
    routers: publicAPIs,
    schemaPaths: ["src/schemas"],
    config: {
      openapi: "3.0.0",
      servers: [{ url: `https://server.com/api` }],
      info: {
        version: "1.0.0",
        title: "My API",
        description: `Welcome to the My API!`,
      },
    },
    errors: {
      401: "Unauthorized",
      403: "Forbidden",
    },
  });
  app.get(`/openapi.json`, (req, res) => res.json(doc));
  app.use(`/openapi`, swaggerUI.serve, swaggerUI.setup(doc));
} catch (err) {
  console.error(err);
}
```

## Implementation Notes

- Unless you use middleware that converts query parameters to other data types, you may find that `?option=false` and `?option=100` are string values when your Zod schemas are validated. You can fix this by adding middleware that coerces these values to numbers/booleans, or by changing your expected Zod type:

```ts
export const OptionalQueryNumber = z.union([z.string(), z.number()]).optional().openapi({ type: "number" });
```

- If you'd like to provide example values, custom types, or descriptions for your Zod schemas, you can do so by chaining calls to `z.openapi` (shown in the example above). Note that `.openapi({example: ...})` can be used on both individual fields and also on entire objects.

- If you use `z.any()`, you may need to chain a call to `z.openapi` to specify what type should appear in the OpenAPI specification, since 'any' is not a valid OpenAPI type.
