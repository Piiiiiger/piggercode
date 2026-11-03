#!/usr/bin/env node

// @ts-check

/**
 * Builds the CLI release assets that the CLI's own updater and the desktop app's setup download from
 * the GitHub release `cli-<channel>`: one `happier-v<version>-<os>-<arch>.tar.gz` per target and
 * `checksums-happier-v<version>.txt`. When MINISIGN_SECRET_KEY is set the checksums file is signed
 * (`….txt.minisig`); without it, sign that file with the release key before publishing, because every
 * download checks it against `DEFAULT_MINISIGN_PUBLIC_KEY`. The asset names and the `happier` product
 * name are what `resolveReleaseAssetBundle` looks for.
 *
 * usage: node scripts/pipeline/release/build-cli-binaries.mjs [--channel stable] [--version <version>]
 *          [--targets linux-x64,darwin-arm64,darwin-x64,windows-x64]
 * Output: dist/release-assets/cli/
 */

import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import {
  CLI_STACK_TARGETS,
  buildCliBinaryArtifactPayload,
  normalizeChannel,
  packagePreparedTargetBinary,
  parseArgs,
  parseCsv,
  readVersionFromPackageJson,
  resolveRepoRoot,
  resolveTargets,
  maybeSignFile,
  writeChecksumsFile,
} from './lib/binary-release.mjs';

const PRODUCT = 'happier';

async function main() {
  const repoRoot = resolveRepoRoot();
  const { kv } = parseArgs(process.argv.slice(2));

  const channel = normalizeChannel(kv.get('--channel'));
  const version = String(kv.get('--version') ?? '').trim()
    || readVersionFromPackageJson(join(repoRoot, 'apps', 'cli', 'package.json'));
  const outDir = join(repoRoot, 'dist', 'release-assets', 'cli');
  const tempDir = join(repoRoot, 'dist', 'release-assets', '.tmp-cli-binaries', `build-${process.pid}-${randomUUID()}`);
  const externals = parseCsv(kv.get('--externals') ?? process.env.PIGGERCODE_CLI_BUN_EXTERNALS ?? '');
  const targets = resolveTargets({
    availableTargets: CLI_STACK_TARGETS,
    requested: kv.get('--targets'),
  });

  await mkdir(tempDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  try {
    const artifacts = [];
    for (const target of targets) {
      const stageDir = join(tempDir, `${PRODUCT}-v${version}-${target.os}-${target.arch}`);
      await buildCliBinaryArtifactPayload({
        repoRoot,
        payloadDir: stageDir,
        target,
        externals,
        releaseVersion: version,
      });
      artifacts.push(await packagePreparedTargetBinary({ product: PRODUCT, version, target, stageDir, outDir }));
    }

    const checksums = await writeChecksumsFile({ product: PRODUCT, version, artifacts, outDir });
    const signature = await maybeSignFile({ path: checksums, trustedComment: `${PRODUCT} ${version} ${channel}` });
    console.log(JSON.stringify({
      product: PRODUCT,
      channel,
      version,
      outDir,
      artifacts: artifacts.map((artifact) => artifact.name),
      checksums,
      signature,
    }, null, 2));
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch((error) => {
      console.warn(`[release] could not remove ${tempDir}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
