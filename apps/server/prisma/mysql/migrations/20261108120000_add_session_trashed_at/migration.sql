ALTER TABLE `Session` ADD COLUMN `trashedAt` DATETIME(3) NULL;

CREATE INDEX `Session_trashedAt_idx` ON `Session`(`trashedAt`);
