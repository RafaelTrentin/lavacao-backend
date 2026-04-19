/*
  Warnings:

  - A unique constraint covering the columns `[businessId,kind]` on the table `VehicleType` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `businessId` to the `VehicleType` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `VehicleType` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "VehicleType_kind_key";

-- AlterTable
ALTER TABLE "VehicleType" ADD COLUMN     "businessId" TEXT NOT NULL,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "VehicleType_businessId_idx" ON "VehicleType"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleType_businessId_kind_key" ON "VehicleType"("businessId", "kind");

-- AddForeignKey
ALTER TABLE "VehicleType" ADD CONSTRAINT "VehicleType_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
