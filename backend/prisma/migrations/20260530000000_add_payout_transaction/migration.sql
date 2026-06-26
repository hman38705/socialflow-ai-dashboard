-- CreateTable
CREATE TABLE "PayoutTransaction" (
    "id"              TEXT NOT NULL,
    "groupId"         TEXT NOT NULL,
    "recipient"       TEXT NOT NULL,
    "amount"          DOUBLE PRECISION NOT NULL,
    "currency"        TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "jobId"           TEXT,
    "status"          TEXT NOT NULL DEFAULT 'pending',
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt"     TIMESTAMP(3),

    CONSTRAINT "PayoutTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutTransaction_transactionHash_key" ON "PayoutTransaction"("transactionHash");

-- CreateIndex
CREATE INDEX "PayoutTransaction_groupId_idx" ON "PayoutTransaction"("groupId");

-- CreateIndex
CREATE INDEX "PayoutTransaction_recipient_idx" ON "PayoutTransaction"("recipient");

-- CreateIndex
CREATE INDEX "PayoutTransaction_transactionHash_idx" ON "PayoutTransaction"("transactionHash");

-- CreateIndex
CREATE INDEX "PayoutTransaction_jobId_idx" ON "PayoutTransaction"("jobId");
