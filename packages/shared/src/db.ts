import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __signalPrisma: PrismaClient | undefined;
}

export const prisma = global.__signalPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__signalPrisma = prisma;
