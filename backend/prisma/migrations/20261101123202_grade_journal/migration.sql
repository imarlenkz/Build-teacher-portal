-- AlterTable
ALTER TABLE "school_settings" ADD COLUMN     "bjb_weight" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN     "fo_weight" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN     "tjb_weight" INTEGER NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "grade_columns" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "class_id" INTEGER NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "quarter_id" INTEGER NOT NULL,
    "teacher_id" INTEGER,
    "date" DATE NOT NULL,
    "topic" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grade_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" SERIAL NOT NULL,
    "column_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "updated_by_id" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quarter_grades" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "quarter_id" INTEGER NOT NULL,
    "class_id" INTEGER NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "mark" INTEGER NOT NULL,
    "computed_pct" DECIMAL(5,2),
    "updated_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quarter_grades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grade_columns_class_id_subject_id_quarter_id_idx" ON "grade_columns"("class_id", "subject_id", "quarter_id");

-- CreateIndex
CREATE INDEX "grades_student_id_idx" ON "grades"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "grades_column_id_student_id_key" ON "grades"("column_id", "student_id");

-- CreateIndex
CREATE INDEX "quarter_grades_student_id_idx" ON "quarter_grades"("student_id");

-- CreateIndex
CREATE INDEX "quarter_grades_class_id_subject_id_idx" ON "quarter_grades"("class_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "quarter_grades_quarter_id_class_id_subject_id_student_id_key" ON "quarter_grades"("quarter_id", "class_id", "subject_id", "student_id");

-- AddForeignKey
ALTER TABLE "grade_columns" ADD CONSTRAINT "grade_columns_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_columns" ADD CONSTRAINT "grade_columns_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_columns" ADD CONSTRAINT "grade_columns_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_columns" ADD CONSTRAINT "grade_columns_quarter_id_fkey" FOREIGN KEY ("quarter_id") REFERENCES "quarters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_columns" ADD CONSTRAINT "grade_columns_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "grade_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quarter_grades" ADD CONSTRAINT "quarter_grades_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quarter_grades" ADD CONSTRAINT "quarter_grades_quarter_id_fkey" FOREIGN KEY ("quarter_id") REFERENCES "quarters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quarter_grades" ADD CONSTRAINT "quarter_grades_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quarter_grades" ADD CONSTRAINT "quarter_grades_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quarter_grades" ADD CONSTRAINT "quarter_grades_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
