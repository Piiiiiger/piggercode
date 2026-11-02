-- CreateTable
CREATE TABLE `AccountPasswordCredential` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `loginName` VARCHAR(191) NOT NULL,
    `kdf` VARCHAR(191) NOT NULL,
    `verifierSalt` LONGBLOB NOT NULL,
    `verifierHash` LONGBLOB NOT NULL,
    `wrappedSecret` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AccountPasswordCredential_accountId_key`(`accountId`),
    UNIQUE INDEX `AccountPasswordCredential_loginName_key`(`loginName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AccountPasswordCredential` ADD CONSTRAINT `AccountPasswordCredential_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

