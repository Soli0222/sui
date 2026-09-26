import { payloadSchema } from "../schemas/people";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import { handleRouteError, notFound } from "../lib/http";
import { createPerson, deletePerson, getPersonSummary, listPeople, updatePerson } from "../services/people";

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
  })
  .get("/:id/summary", async (c) => {
    try {
      const summary = await getPersonSummary(prisma, c.req.param("id"));
      if (!summary) {
        return notFound(c, "Person not found");
      }
      return c.json(summary);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
