-- AlterEnum
ALTER TYPE "TenantStatus" ADD VALUE 'VACANT';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "layout" TEXT,
ADD COLUMN     "moveIn" DATE,
ADD COLUMN     "reportedBalanceAsOf" DATE,
ADD COLUMN     "reportedBalanceCents" INTEGER,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "sqft" INTEGER;
