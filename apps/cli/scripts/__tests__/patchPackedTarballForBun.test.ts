import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import * as tar from 'tar';

import { createTempDirSync } from '../../src/testkit/fs/tempDir';
import { patchPackedTarballForBun } from '../postpack/patchPackedTarballForBun.mjs';

describe('patchPackedTarballForBun', () => {
  it('removes internal @piggercode/* dependencies without removing bundled payload files', async () => {
    const tmp = createTempDirSync('happier-cli-postpack-test-');
    const packageDir = join(tmp, 'package');
    const tarballPath = join(tmp, 'artifact.tgz');

    const pkgJsonPath = join(packageDir, 'package.json');
    const bundledMarkerPath = join(packageDir, 'node_modules', '@piggercode', 'protocol', 'package.json');

    mkdirSync(join(packageDir, 'node_modules', '@piggercode', 'protocol'), { recursive: true });
    writeFileSync(
      pkgJsonPath,
      `${JSON.stringify({
        name: '@piggercode/cli',
        version: '0.1.0',
        dependencies: {
          '@piggercode/protocol': '0.0.0',
          '@piggercode/release-runtime': '0.0.0',
          tweetnacl: '^1.0.3',
        },
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      bundledMarkerPath,
      `${JSON.stringify({ name: '@piggercode/protocol', version: '0.0.0' }, null, 2)}\n`,
      'utf8',
    );

    // Re-pack the tarball with the actual payload.
    await tar.c({ gzip: true, file: tarballPath, cwd: tmp, portable: true }, ['package']);

    await patchPackedTarballForBun({ tarballPath, env: {} });

    const extracted = createTempDirSync('happier-cli-postpack-extract-');
    await tar.x({ file: tarballPath, cwd: extracted, strict: true });

    const patchedPkgRaw = readFileSync(join(extracted, 'package', 'package.json'), 'utf8');
    const patchedPkg = JSON.parse(patchedPkgRaw) as { dependencies?: Record<string, string> };

    expect(Object.keys(patchedPkg.dependencies ?? {}).filter((key) => key.startsWith('@piggercode/'))).toEqual([]);
    expect(patchedPkg.dependencies?.tweetnacl).toBeTruthy();

    expect(() => readFileSync(join(extracted, 'package', 'node_modules', '@piggercode', 'protocol', 'package.json'), 'utf8'))
      .not.toThrow();
  });

  it('restores the published cli bin contract when missing from packed package.json', async () => {
    const tmp = createTempDirSync('happier-cli-postpack-bin-contract-');
    const packageDir = join(tmp, 'package');
    const tarballPath = join(tmp, 'artifact.tgz');

    const pkgJsonPath = join(packageDir, 'package.json');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      pkgJsonPath,
      `${JSON.stringify({
        name: '@piggercode/cli',
        version: '0.2.6',
        dependencies: {
          tweetnacl: '^1.0.3',
        },
      }, null, 2)}\n`,
      'utf8',
    );

    await tar.c({ gzip: true, file: tarballPath, cwd: tmp, portable: true }, ['package']);
    await patchPackedTarballForBun({ tarballPath, env: {} });

    const extracted = createTempDirSync('happier-cli-postpack-bin-contract-extract-');
    await tar.x({ file: tarballPath, cwd: extracted, strict: true });

    const patchedPkgRaw = readFileSync(join(extracted, 'package', 'package.json'), 'utf8');
    const patchedPkg = JSON.parse(patchedPkgRaw) as {
      bin?: Record<string, string>;
    };

    expect(patchedPkg.bin).toEqual({
      happier: './bin/piggercode.mjs',
      'happier-dev': './bin/piggercode-dev.mjs',
      'piggercode-mcp': './bin/piggercode-mcp.mjs',
    });
  });
});
