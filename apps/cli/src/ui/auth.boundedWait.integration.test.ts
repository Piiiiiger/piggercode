import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { installAxiosFastifyAdapter } from '@/testkit/http/axiosAdapter';
import { captureConsoleLogAndMuteStdout, captureConsoleText } from '@/testkit/logger/captureOutput';
import { setStdioTtyForTest } from '@/testkit/process/stdio';

/**
 * A relay that never gets approved.
 *
 * That is not a failure — it is what every unapproved sign-in looks like from
 * here, and it is the state that used to own the terminal until the process was
 * killed. Guided setup hands `auth login` an inherited stdio terminal, so an
 * unbounded wait is a terminal nobody can get back.
 */
function pendingRelay() {
  const app = fastify({ logger: false });
  app.post('/v1/auth/request', async (_req, reply) => reply.send({ state: 'requested' }));
  app.get('/v1/auth/request/status', async (_req, reply) => reply.send({ status: 'pending', supportsV2: true }));
  return app;
}

function setStderrTtyForTest(isTTY: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  Object.defineProperty(process.stderr, 'isTTY', { value: isTTY, configurable: true });
  return () => {
    if (descriptor) Object.defineProperty(process.stderr, 'isTTY', descriptor);
    else delete (process.stderr as { isTTY?: boolean }).isTTY;
  };
}

describe('terminal auth wait bound', () => {
  const envKeys = [
    'PIGGERCODE_HOME_DIR',
    'PIGGERCODE_NO_BROWSER_OPEN',
    'PIGGERCODE_AUTH_METHOD',
    'PIGGERCODE_AUTH_POLL_INTERVAL_MS',
    'PIGGERCODE_AUTH_WAIT_TIMEOUT_MS',
    'PIGGERCODE_NO_ANIMATION',
    'PIGGERCODE_SERVER_URL',
    'PIGGERCODE_WEBAPP_URL',
    'NO_COLOR',
    'TERM',
  ] as const;

  let restoreTty: (() => void) | null = null;
  let restoreStderrTty: (() => void) | null = null;
  let homeDir = '';
  let envScope = createEnvKeyScope(envKeys);

  beforeEach(async () => {
    vi.useRealTimers();
    envScope = createEnvKeyScope(envKeys);
    homeDir = await createTempDir('happier-cli-auth-bounded-wait-');
    envScope.patch({
      PIGGERCODE_HOME_DIR: homeDir,
      PIGGERCODE_NO_BROWSER_OPEN: '1',
      PIGGERCODE_AUTH_METHOD: 'web',
      PIGGERCODE_AUTH_POLL_INTERVAL_MS: '1',
      PIGGERCODE_SERVER_URL: 'http://happier-auth-bounded.test',
      PIGGERCODE_WEBAPP_URL: 'http://example.test',
    });
    restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
  });

  afterEach(async () => {
    restoreTty?.();
    restoreTty = null;
    restoreStderrTty?.();
    restoreStderrTty = null;
    envScope.restore();
    vi.resetModules();
    vi.unstubAllGlobals();
    await removeTempDir(homeDir);
  });

  it('stops waiting once the caller-set bound elapses and names the way back in', async () => {
    envScope.patch({ PIGGERCODE_AUTH_WAIT_TIMEOUT_MS: '200' });

    const app = pendingRelay();
    await app.ready();
    const restoreAxios = installAxiosFastifyAdapter({ app, origin: process.env.PIGGERCODE_SERVER_URL ?? '' });
    vi.resetModules();
    const { doAuth } = await import('./auth');

    const output = captureConsoleText();
    try {
      const startedAt = performance.now();
      const result = await doAuth();
      const elapsedMs = performance.now() - startedAt;

      expect(result).toBeNull();
      expect(elapsedMs).toBeLessThan(2_000);
      const logs = output.text().toLowerCase();
      expect(logs).not.toContain('\r');
      expect(logs).toContain('piggercode auth login');
      expect(logs).toContain('create a new sign-in request');
      expect(logs).not.toContain('approve it on your phone');
    } finally {
      output.restore();
      restoreAxios();
      await app.close().catch(() => {});
    }
  }, 30_000);

  it('keeps QR approval on compact progress so the code stays visible', async () => {
    envScope.patch({
      PIGGERCODE_AUTH_METHOD: undefined,
      PIGGERCODE_AUTH_WAIT_TIMEOUT_MS: '200',
      PIGGERCODE_NO_ANIMATION: '',
      NO_COLOR: '1',
      TERM: 'xterm-256color',
    });
    restoreTty?.();
    restoreTty = setStdioTtyForTest({ stdin: false, stdout: true });
    restoreStderrTty = setStderrTtyForTest(true);

    const app = pendingRelay();
    await app.ready();
    const restoreAxios = installAxiosFastifyAdapter({ app, origin: process.env.PIGGERCODE_SERVER_URL ?? '' });
    vi.resetModules();
    const { doAuth } = await import('./auth');

    const output = captureConsoleText();
    const clear = vi.spyOn(console, 'clear');
    try {
      await expect(doAuth()).resolves.toBeNull();
      const text = output.text();
      expect(text).toContain('Scan this QR code');
      // One compact spinner line, never the multi-row planet that would push the code away.
      expect(text).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Waiting for authentication/u);
      expect(text).not.toContain('⣿');
      expect(clear).not.toHaveBeenCalled();
    } finally {
      clear.mockRestore();
      output.restore();
      restoreAxios();
      await app.close().catch(() => {});
    }
  }, 30_000);

  it('keeps waiting when no bound was asked for', async () => {
    // The default has to stay unbounded: someone watching a QR code on their
    // desk is not a hung process, and this is the same wait every existing
    // `piggercode auth login` performs.
    const app = pendingRelay();
    await app.ready();
    const restoreAxios = installAxiosFastifyAdapter({ app, origin: process.env.PIGGERCODE_SERVER_URL ?? '' });
    vi.resetModules();
    const { doAuth } = await import('./auth');

    const output = captureConsoleLogAndMuteStdout();
    try {
      const settled = await Promise.race([
        doAuth().then(() => 'settled' as const),
        new Promise<'still-waiting'>((resolve) => setTimeout(() => resolve('still-waiting'), 750)),
      ]);

      expect(settled).toBe('still-waiting');
    } finally {
      output.restore();
      restoreAxios();
      await app.close().catch(() => {});
    }
  }, 30_000);
});
