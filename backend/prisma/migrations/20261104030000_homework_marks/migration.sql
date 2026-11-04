-- CreateTable
CREATE TABLE "homework_marks" (
    "id" SERIAL NOT NULL,
    "column_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "updated_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homework_marks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "homework_marks_column_id_student_id_key" ON "homework_marks"("column_id", "student_id");

-- CreateIndex
CREATE INDEX "homework_marks_student_id_idx" ON "homework_marks"("student_id");

-- AddForeignKey
ALTER TABLE "homework_marks" ADD CONSTRAINT "homework_marks_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "grade_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_marks" ADD CONSTRAINT "homework_marks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
