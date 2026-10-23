-- AlterTable
ALTER TABLE "PushDevice" ADD COLUMN     "installationId" TEXT;

-- CreateIndex
CREATE INDEX "PushDevice_installationId_idx" ON "PushDevice"("installationId");
