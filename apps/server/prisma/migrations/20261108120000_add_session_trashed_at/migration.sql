ALTER TABLE "Session" ADD COLUMN "trashedAt" TIMESTAMP(3);

CREATE INDEX "Session_trashedAt_idx" ON "Session"("trashedAt");
