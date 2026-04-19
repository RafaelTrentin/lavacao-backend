-- AlterTable
ALTER TABLE "Appointment"
ALTER COLUMN "vehicleType" TYPE TEXT
USING "vehicleType"::text;

-- AlterTable
ALTER TABLE "VehicleType"
ALTER COLUMN "kind" TYPE TEXT
USING "kind"::text;

-- Drop old enum type if no longer used
DROP TYPE IF EXISTS "VehicleKind";