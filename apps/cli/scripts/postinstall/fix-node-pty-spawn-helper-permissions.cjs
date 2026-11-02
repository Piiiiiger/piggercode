#!/usr/bin/env node

const { fixNodePtySpawnHelperPermissions } = require('@piggercode/cli-common/nodePtySpawnHelperPermissions');

module.exports = {
  fixNodePtySpawnHelperPermissions,
};

if (require.main === module) {
  try {
    fixNodePtySpawnHelperPermissions();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
