-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "group_id" INTEGER;

-- AlterTable
ALTER TABLE "grade_columns" ADD COLUMN     "group_id" INTEGER;

-- CreateTable
CREATE TABLE "subject_groups" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "class_id" INTEGER NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "teacher_id" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subject_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_group_members" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "class_id" INTEGER NOT NULL,
    "subject_id" INTEGER NOT NULL,

    CONSTRAINT "subject_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subject_groups_teacher_id_idx" ON "subject_groups"("teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_groups_class_id_subject_id_name_key" ON "subject_groups"("class_id", "subject_id", "name");

-- CreateIndex
CREATE INDEX "subject_group_members_group_id_idx" ON "subject_group_members"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "subject_group_members_class_id_subject_id_student_id_key" ON "subject_group_members"("class_id", "subject_id", "student_id");

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "subject_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_groups" ADD CONSTRAINT "subject_groups_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_groups" ADD CONSTRAINT "subject_groups_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_groups" ADD CONSTRAINT "subject_groups_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_groups" ADD CONSTRAINT "subject_groups_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_group_members" ADD CONSTRAINT "subject_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "subject_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_group_members" ADD CONSTRAINT "subject_group_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_columns" ADD CONSTRAINT "grade_columns_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "subject_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
