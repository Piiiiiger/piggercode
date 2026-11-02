-- CreateTable
CREATE TABLE "AccountPasswordCredential" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "loginName" TEXT NOT NULL,
    "kdf" TEXT NOT NULL,
    "verifierSalt" BYTEA NOT NULL,
    "verifierHash" BYTEA NOT NULL,
    "wrappedSecret" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountPasswordCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountPasswordCredential_accountId_key" ON "AccountPasswordCredential"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountPasswordCredential_loginName_key" ON "AccountPasswordCredential"("loginName");

-- AddForeignKey
ALTER TABLE "AccountPasswordCredential" ADD CONSTRAINT "AccountPasswordCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

