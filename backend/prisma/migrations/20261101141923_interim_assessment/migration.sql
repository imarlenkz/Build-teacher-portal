-- AlterEnum
ALTER TYPE "AssessmentType" ADD VALUE 'ARALYK';

-- AlterTable
ALTER TABLE "school_settings" ADD COLUMN     "interim_weight" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "primary_fo_weight" INTEGER NOT NULL DEFAULT 50;
