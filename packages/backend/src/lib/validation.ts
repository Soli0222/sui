import { INT4_MAX, INT4_MIN } from "@sui/shared";
import { z } from "zod";

export const INT4_MAX_MESSAGE = `must be less than or equal to ${INT4_MAX}`;
export const INT4_MIN_MESSAGE = `must be greater than or equal to ${INT4_MIN}`;

export function int32Schema() {
  return z.number().int().min(INT4_MIN, INT4_MIN_MESSAGE).max(INT4_MAX, INT4_MAX_MESSAGE);
}

export function nonNegativeInt32Schema() {
  return int32Schema().nonnegative();
}

export function positiveInt32Schema() {
  return int32Schema().positive();
}
