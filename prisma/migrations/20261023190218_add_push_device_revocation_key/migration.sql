/*
  Warnings:

  - A unique constraint covering the columns `[revocationKeyHash]` on the table `PushDevice` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "PushDevice" ADD COLUMN     "revocationKeyHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_revocationKeyHash_key" ON "PushDevice"("revocationKeyHash");
