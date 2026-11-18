-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "boxId" TEXT,
ADD COLUMN     "snapshotBoxName" TEXT;

-- CreateTable
CREATE TABLE "WashBox" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isLegacyDefault" BOOLEAN NOT NULL DEFAULT false,
    "serviceModeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WashBox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WashBox_id_businessId_key" ON "WashBox"("id", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "WashBox_businessId_name_key" ON "WashBox"("businessId", "name");

-- CreateIndex
CREATE INDEX "Appointment_businessId_boxId_scheduledStartAt_idx" ON "Appointment"("businessId", "boxId", "scheduledStartAt");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_boxId_businessId_fkey" FOREIGN KEY ("boxId", "businessId") REFERENCES "WashBox"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WashBox" ADD CONSTRAINT "WashBox_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

