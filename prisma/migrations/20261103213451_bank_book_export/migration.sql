-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "bookNumber" TEXT;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "bookCode" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1;
