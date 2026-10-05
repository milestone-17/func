-- CreateTable
CREATE TABLE "fund_nav_history" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "nav" DOUBLE PRECISION NOT NULL,
    "accNav" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'eastmoney',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_nav_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dca_funds" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "dca_funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fund_nav_history_code_idx" ON "fund_nav_history"("code");

-- CreateIndex
CREATE UNIQUE INDEX "fund_nav_history_code_date_key" ON "fund_nav_history"("code", "date");

-- CreateIndex
CREATE INDEX "dca_funds_userId_idx" ON "dca_funds"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "dca_funds_userId_code_key" ON "dca_funds"("userId", "code");

-- CreateIndex
CREATE INDEX "admin_audit_createdAt_idx" ON "admin_audit"("createdAt");
