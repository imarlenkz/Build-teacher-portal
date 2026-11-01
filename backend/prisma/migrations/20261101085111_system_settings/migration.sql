/*
  Warnings:

  - You are about to drop the column `backup_auto_enabled` on the `school_settings` table. All the data in the column will be lost.
  - You are about to drop the column `backup_retention_days` on the `school_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "school_settings" DROP COLUMN "backup_auto_enabled",
DROP COLUMN "backup_retention_days";

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);
