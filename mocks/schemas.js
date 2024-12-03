import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

const BaseSchema = z.object({
  name: z.string(),
  address: z.tuple([z.number().int(), z.string(), z.enum(["street", "avenue", "boulevard"])]).optional(),
});

const BodySchema = BaseSchema.openapi("Body", { title: "User", description: "Required user information" });
const QuerySchema = BaseSchema.extend({ age: z.number().optional() }).openapi({
  title: "User details",
  description: "Optional user information",
});
const ParamsSchema = z.object({ id: z.string() });
const ResponseSchema = z.object({ success: z.boolean(), value: z.bigint().optional() });

export { BodySchema, ParamsSchema, QuerySchema, ResponseSchema };
