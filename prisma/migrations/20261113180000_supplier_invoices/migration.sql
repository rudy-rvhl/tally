-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "tradeName" TEXT,
    "invoiceNo" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "description" TEXT,
    "billedTo" TEXT,
    "serviceAddress" TEXT,
    "buildingId" TEXT,
    "subtotalCents" INTEGER,
    "gstCents" INTEGER,
    "qstCents" INTEGER,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "transactionId" TEXT,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "file" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierInvoice_userId_supplier_idx" ON "SupplierInvoice"("userId", "supplier");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_userId_sha256_key" ON "SupplierInvoice"("userId", "sha256");

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

