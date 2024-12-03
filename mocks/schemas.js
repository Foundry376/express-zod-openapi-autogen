import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

const BodySchema = z.object({ name: z.string() }).openapi({ title: "User", description: "Required user information" });
const QuerySchema = BodySchema.extend({ age: z.number().optional() }).openapi({
  title: "User details",
  description: "Optional user information",
});
const ParamsSchema = z.object({ id: z.string() });
const ResponseSchema = z.object({ success: z.boolean() });

export { BodySchema, ParamsSchema, QuerySchema, ResponseSchema };
