import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import { isDateString } from "../lib/dates";
import { badRequest, handleRouteError } from "../lib/http";
import { positiveInt32Schema } from "../lib/validation";

const payloadSchema = z.object({
  accountId: z.string().uuid(),
  transferToAccountId: z.string().uuid().optional(),
  date: z.string(),
  type: z.enum(["income", "expense", "transfer"]),
  description: z.string().min(1).max(200),
  amount: positiveInt32Schema(),
});

export const transactionsRoutes = new Hono()
  .get("/", async (c) => {
    const page = Number(c.req.query("page") ?? "1");
    const limit = Number(c.req.query("limit") ?? "50");
    const accountId = c.req.query("accountId");
    const where = accountId ? { accountId } : undefined;

    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          account: true,
          transferToAccount: true,
        },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    return c.json({
      items: items.map((item) => ({
        ...item,
        date: item.date.toISOString().slice(0, 10),
        createdAt: item.createdAt.toISOString(),
        accountName: item.account.name,
        transferToAccountName: item.transferToAccount?.name ?? null,
      })),
      page,
      limit,
      total,
    });
  })
  .post("/", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      if (!isDateString(body.date)) {
        return badRequest(c, "date must be YYYY-MM-DD");
      }
      if (body.type === "transfer" && !body.transferToAccountId) {
        return badRequest(c, "transferToAccountId is required for transfer");
      }
      if (body.type !== "transfer" && body.transferToAccountId) {
        return badRequest(c, "transferToAccountId is only allowed for transfer");
      }
      if (body.accountId === body.transferToAccountId) {
        return badRequest(c, "transfer accounts must be different");
      }

      const date = new Date(`${body.date}T00:00:00.000Z`);

      const transaction = await prisma.$transaction(async (tx) => {
        const account = await tx.account.findFirst({
          where: { id: body.accountId, deletedAt: null },
        });
        if (!account) {
          throw new Error("Source account not found");
        }

        if (body.type === "income") {
          await tx.account.update({
            where: { id: account.id },
            data: { balance: { increment: body.amount } },
          });
        } else if (body.type === "expense") {
          await tx.account.update({
            where: { id: account.id },
            data: { balance: { decrement: body.amount } },
          });
        } else {
          const transferToAccount = await tx.account.findFirst({
            where: { id: body.transferToAccountId, deletedAt: null },
          });
          if (!transferToAccount) {
            throw new Error("Destination account not found");
          }

          await tx.account.update({
            where: { id: account.id },
            data: { balance: { decrement: body.amount } },
          });
          await tx.account.update({
            where: { id: transferToAccount.id },
            data: { balance: { increment: body.amount } },
          });
        }

        return tx.transaction.create({
          data: {
            accountId: body.accountId,
            transferToAccountId: body.transferToAccountId,
            date,
            type: body.type,
            description: body.description,
            amount: body.amount,
          },
        });
      });

      return c.json(transaction, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
