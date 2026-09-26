import { z } from "zod";
import { name100Schema, memo200Schema, sortOrderSchema } from "./fields";

export const payloadSchema = z.object({
  name: name100Schema,
  memo: memo200Schema.nullish(),
  sortOrder: sortOrderSchema.default(0),
});
