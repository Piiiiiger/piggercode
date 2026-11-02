-- CreateTable
CREATE TABLE "AccountPasswordCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "loginName" TEXT NOT NULL,
    "kdf" TEXT NOT NULL,
    "verifierSalt" BLOB NOT NULL,
    "verifierHash" BLOB NOT NULL,
    "wrappedSecret" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountPasswordCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountPasswordCredential_accountId_key" ON "AccountPasswordCredential"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountPasswordCredential_loginName_key" ON "AccountPasswordCredential"("loginName");

