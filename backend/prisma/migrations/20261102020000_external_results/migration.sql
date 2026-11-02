-- CreateTable
CREATE TABLE "external_results" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "test_id" TEXT,
    "test_title" TEXT NOT NULL,
    "subject_name" TEXT,
    "class_name" TEXT,
    "student_name" TEXT NOT NULL,
    "student_id" INTEGER,
    "kind" TEXT,
    "percent" DECIMAL(5,2) NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "target" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_results_school_id_status_idx" ON "external_results"("school_id", "status");

-- CreateIndex
CREATE INDEX "external_results_school_id_test_id_student_id_idx" ON "external_results"("school_id", "test_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_results_source_source_id_key" ON "external_results"("source", "source_id");

-- AddForeignKey
ALTER TABLE "external_results" ADD CONSTRAINT "external_results_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_results" ADD CONSTRAINT "external_results_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;

