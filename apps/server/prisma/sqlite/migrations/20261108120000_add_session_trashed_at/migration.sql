ALTER TABLE "Session" ADD COLUMN "trashedAt" DATETIME;

CREATE INDEX "Session_trashedAt_idx" ON "Session"("trashedAt");
