export { OpenAPIConfig, OpenAPIDocument, buildOpenAPIDocument, getRoutes } from "./openAPI";
export { configureOpenAPIRoute, getErrorSummary, openAPIRoute } from "./openAPIRoute";
export { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
// Re-export from zod-extensions so the `declare module 'zod'` augmentation
// (which adds `.openapi()` to ZodType) loads when consumers import from
// this library, even without explicitly importing zod-to-openapi.
export type { ZodOpenAPIMetadata } from "@asteasolutions/zod-to-openapi/dist/zod-extensions";
