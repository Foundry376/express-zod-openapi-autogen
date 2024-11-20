import { z } from "zod";

const BodySchema = z.object({ name: z.string() });
const QuerySchema = z.object({ age: z.number().optional() });
const ParamsSchema = z.object({ id: z.string() });
const ResponseSchema = z.object({ success: z.boolean() });

export { BodySchema, ParamsSchema, QuerySchema, ResponseSchema, UnusedSchema };
