import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import { handleRouteError, notFound } from "../lib/http";
import { int32Schema } from "../lib/validation";
import { createPerson, deletePerson, listPeople, updatePerson } from "../services/people";

const payloadSchema = z.object({
  name: z.string().min(1).max(100),
  memo: z.string().max(200).nullish(),
  sortOrder: int32Schema().default(0),
});

const listQuerySchema = z.object({
  includeDeleted: z.enum(["true", "false"]).default("false"),
});

export const peopleRoutes = new Hono()
  .get("/", async (c) => {
    try {
      const query = listQuerySchema.parse({
        includeDeleted: c.req.query("includeDeleted"),
      });
      const people = await listPeople(prisma, { includeDeleted: query.includeDeleted === "true" });
      return c.json(people);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const person = await createPerson(prisma, body);
      return c.json(person, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/:id", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const person = await updatePerson(prisma, c.req.param("id"), body);
      if (!person) {
        return notFound(c, "Person not found");
      }
      return c.json(person);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    try {
      const person = await deletePerson(prisma, c.req.param("id"));
      if (!person) {
        return notFound(c, "Person not found");
      }
      return c.body(null, 204);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
