import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { WebSocketServer } from 'ws-node';

/**
 * Codex 0.166.0's managed app-server daemon boundary: JSON-RPC over WebSocket on
 * `$CODEX_HOME/app-server-control/app-server-control.sock`, which Codex publishes as a
 * symlink to a short runtime socket (`/tmp/codex-daemon-<uid>/<hash>`).
 */
export async function startFakeCodexAppServerDaemon(params: Readonly<{
  codexHome: string;
  loadedThreadIds: readonly string[];
}>): Promise<Readonly<{ close: () => Promise<void> }>> {
  const runtimeDir = await mkdtemp(join('/tmp', 'happier-codex-daemon-'));
  const socketPath = join(runtimeDir, 'control.sock');
  const httpServer = createServer();
  const webSocketServer = new WebSocketServer({
    server: httpServer,
    // Codex's tungstenite endpoint closes the handshake when clients offer permessage-deflate.
    verifyClient: (info, done) => done(info.req.headers['sec-websocket-extensions'] === undefined),
  });
  webSocketServer.on('connection', (socket) => {
    socket.on('message', (payload) => {
      const message = JSON.parse(String(payload)) as { id?: number; method?: string };
      if (message.id === undefined) return;
      if (message.method === 'initialize') {
        socket.send(JSON.stringify({ id: message.id, result: { codexHome: params.codexHome } }));
      } else if (message.method === 'thread/loaded/list') {
        socket.send(JSON.stringify({ id: message.id, result: { data: params.loadedThreadIds, nextCursor: null } }));
      } else {
        socket.send(JSON.stringify({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(socketPath, resolve);
  });
  const controlDir = join(params.codexHome, 'app-server-control');
  await mkdir(controlDir, { recursive: true });
  await symlink(socketPath, join(controlDir, 'app-server-control.sock'));
  return {
    close: async () => {
      for (const client of webSocketServer.clients) client.terminate();
      await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await rm(runtimeDir, { recursive: true, force: true });
    },
  };
}
