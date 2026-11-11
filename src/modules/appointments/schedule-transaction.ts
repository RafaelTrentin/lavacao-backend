import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Every writer of appointment occupancy and schedule blocks uses this lock.
 * NO KEY UPDATE serializes a business's agenda without blocking FK inserts.
 * ReadCommitted makes reads AFTER the lock see the preceding writer's commit.
 * Internal event/notification rows belong in this transaction; network delivery does not.
 */
export function withScheduleTransaction<T>(
  prisma: PrismaService,
  businessId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const businesses = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Business"
      WHERE id = ${businessId} AND "isActive" = true AND "deletedAt" IS NULL
      FOR NO KEY UPDATE
    `;
    if (!businesses.length) throw new NotFoundException('Empresa não encontrada');
    return work(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 10000 });
}
