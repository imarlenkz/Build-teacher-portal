-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "idp_code" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "idp_sub" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "schools_idp_code_key" ON "schools"("idp_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_idp_sub_key" ON "users"("idp_sub");

