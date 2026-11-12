-- CreateEnum
CREATE TYPE "BankConnectionStatus" AS ENUM ('OK', 'NEEDS_LOGIN', 'ERROR', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "BankConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'plaid',
    "itemId" TEXT NOT NULL,
    "accessToken" BYTEA NOT NULL,
    "institutionId" TEXT,
    "institutionName" TEXT NOT NULL,
    "cursor" TEXT,
    "status" "BankConnectionStatus" NOT NULL DEFAULT 'OK',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankFeedAccount" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "officialName" TEXT,
    "mask" TEXT,
    "type" TEXT,
    "subtype" TEXT,
    "currency" TEXT,
    "currentBalanceCents" INTEGER,
    "availableBalanceCents" INTEGER,
    "balanceAt" TIMESTAMP(3),
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankFeedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankConnection_userId_idx" ON "BankConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BankConnection_provider_itemId_key" ON "BankConnection"("provider", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "BankFeedAccount_connectionId_externalId_key" ON "BankFeedAccount"("connectionId", "externalId");

-- AddForeignKey
ALTER TABLE "BankConnection" ADD CONSTRAINT "BankConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankFeedAccount" ADD CONSTRAINT "BankFeedAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankFeedAccount" ADD CONSTRAINT "BankFeedAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
