import { INT4_MAX } from "@sui/shared";
import { z } from "zod";

export const INT4_MAX_MESSAGE = `must be less than or equal to ${INT4_MAX}`;

export function int32Schema() {
  return z.number().int().max(INT4_MAX, INT4_MAX_MESSAGE);
}

export function nonNegativeInt32Schema() {
  return int32Schema().nonnegative();
}

export function positiveInt32Schema() {
  return int32Schema().positive();
}
