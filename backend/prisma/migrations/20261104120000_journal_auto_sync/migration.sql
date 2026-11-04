-- CreateTable
CREATE TABLE "journal_auto_sync" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "school_id" INTEGER NOT NULL,
    "synced_until" DATE NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_auto_sync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "journal_auto_sync_key_key" ON "journal_auto_sync"("key");

-- CreateIndex
CREATE INDEX "journal_auto_sync_school_id_idx" ON "journal_auto_sync"("school_id");
