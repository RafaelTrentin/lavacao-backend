-- CreateEnum
CREATE TYPE "AppointmentOrigin" AS ENUM ('APP', 'ADMIN', 'WALK_IN');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "operationalRequestKey" TEXT,
ADD COLUMN     "origin" "AppointmentOrigin",
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "vehicleDescription" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_businessId_operationalRequestKey_key" ON "Appointment"("businessId", "operationalRequestKey");

