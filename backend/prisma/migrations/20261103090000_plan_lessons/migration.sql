-- CreateTable
CREATE TABLE "plan_lessons" (
    "id" SERIAL NOT NULL,
    "school_id" INTEGER NOT NULL,
    "class_id" INTEGER NOT NULL,
    "subject_id" INTEGER NOT NULL,
    "quarter_id" INTEGER NOT NULL,
    "group_id" INTEGER,
    "teacher_id" INTEGER,
    "order" INTEGER NOT NULL,
    "section" TEXT,
    "topic" TEXT NOT NULL,
    "objectives" TEXT,
    "hours" INTEGER NOT NULL DEFAULT 1,
    "date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_lessons_class_id_subject_id_quarter_id_idx" ON "plan_lessons"("class_id", "subject_id", "quarter_id");

-- CreateIndex
CREATE INDEX "plan_lessons_school_id_idx" ON "plan_lessons"("school_id");

-- AddForeignKey
ALTER TABLE "plan_lessons" ADD CONSTRAINT "plan_lessons_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_lessons" ADD CONSTRAINT "plan_lessons_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_lessons" ADD CONSTRAINT "plan_lessons_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_lessons" ADD CONSTRAINT "plan_lessons_quarter_id_fkey" FOREIGN KEY ("quarter_id") REFERENCES "quarters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_lessons" ADD CONSTRAINT "plan_lessons_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "subject_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_lessons" ADD CONSTRAINT "plan_lessons_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

