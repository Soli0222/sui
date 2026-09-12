import type { Prisma } from "@sui/db";
import { prisma } from "../lib/db";
import { ConflictError } from "../lib/http";

/** The callback must contain only database work: a serialization retry reruns it. */
export async function mutateLedger<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") {
        throw error;
      }
      if (attempt >= 7) {
        throw new ConflictError("Concurrent ledger update; reload and retry");
      }
      await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt + Math.random() * 20));
    }
  }
}
