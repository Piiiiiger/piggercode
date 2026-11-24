import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { systemTasks } from '@piggercode/cli-common';

export const OAUTH_CALLBACK_TASK_KIND = 'connectedServices.oauthCallback.v1';

/**
 * Bounds of the wait the app asks for. The app cancels the task when its sign-in screen closes; the bound only
 * matters when the app went away without cancelling, so a forgotten task cannot hold a fixed port (Codex: 1455).
 */
const MIN_WAIT_MS = 1_000;
const MAX_WAIT_MS = 30 * 60_000;

export type OauthCallbackListeningEvent = Readonly<{
  type: 'listening';
  stepId: 'listen';
  /** The port the browser comes back to, and the loopback addresses that answer on it. */
  data: Readonly<{ port: number; addresses: readonly string[] }>;
}>;

export type OauthCallbackTaskResult = Readonly<{ callbackUrl: string }>;

type OauthCallbackParams = Readonly<{
  port: number;
  path: string;
  timeoutMs: number;
  page: Readonly<{ title: string; message: string }>;
}>;

function invalid(message: string): never {
  throw new systemTasks.SystemTaskExecutionError('invalid_params', message);
}

export function parseOauthCallbackParams(params: unknown): OauthCallbackParams {
  if (!params || typeof params !== 'object' || Array.isArray(params)) invalid('Sign-in callback params must be an object.');
  const record = params as Record<string, unknown>;
  const { port, path, timeoutMs } = record;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65_535) {
    invalid('The callback port must be a whole number from 0 (any free port) to 65535.');
  }
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9/_-]{0,200}$/u.test(path)) {
    invalid('The callback path must be a plain absolute path.');
  }
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < MIN_WAIT_MS || timeoutMs > MAX_WAIT_MS) {
    invalid(`The wait must be ${MIN_WAIT_MS} to ${MAX_WAIT_MS} ms.`);
  }
  const page = record.page && typeof record.page === 'object' ? record.page as Record<string, unknown> : {};
  const title = typeof page.title === 'string' ? page.title.trim() : '';
  const message = typeof page.message === 'string' ? page.message.trim() : '';
  if (!title || !message) invalid('The page the browser lands on needs a title and a message.');
  return { port, path, timeoutMs, page: { title, message } };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (character) => (
    character === '&' ? '&amp;'
      : character === '<' ? '&lt;'
        : character === '>' ? '&gt;'
          : character === '"' ? '&quot;'
            : '&#39;'
  ));
}

function renderLandingPage(page: OauthCallbackParams['page']): string {
  const title = escapeHtml(page.title);
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${title}</title><style>`
    + 'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;'
    + 'font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#f6f5f2;color:#1d1d1b}'
    + 'main{max-width:420px;padding:24px;text-align:center}h1{margin:0 0 8px;font-size:20px}'
    + 'p{margin:0;line-height:1.5;color:#5f5e5a}'
    + '@media (prefers-color-scheme:dark){body{background:#1d1d1b;color:#f6f5f2}p{color:#b5b3ad}}'
    + `</style></head><body><main><h1>${title}</h1><p>${escapeHtml(page.message)}</p></main></body></html>`;
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ port, host });
  });
}

function waitForCallback(callback: Promise<string>, timeoutMs: number, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  return Promise.race([
    callback,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new systemTasks.SystemTaskExecutionError('timeout', 'No sign-in came back from the browser in time.'));
      }, timeoutMs);
    }),
    new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
    }),
  ]).finally(() => {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

/** Random-port picks that may collide with another program on ::1 before the task says the port is taken. */
const DYNAMIC_PORT_TRIES = 3;

function portInUse(port: number): systemTasks.SystemTaskExecutionError {
  return new systemTasks.SystemTaskExecutionError('port_in_use', `Port ${port} on this computer is already in use.`);
}

/**
 * Listens on 127.0.0.1 and, where this computer has IPv6 loopback, on ::1 at the same port: a browser may try
 * `localhost` on either. Another program on that port at either address could receive the code, so the task
 * refuses a fixed port it cannot hold on both, and picks another when the port was its own random pick.
 */
async function listenOnLoopback(
  port: number,
  onRequest: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<Readonly<{ servers: readonly Server[]; port: number; addresses: readonly string[] }>> {
  for (let tries = 1; ; tries += 1) {
    const primary = createServer(onRequest);
    try {
      await listen(primary, port, '127.0.0.1');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') throw portInUse(port);
      throw error;
    }
    const chosen = (primary.address() as AddressInfo).port;
    const secondary = createServer(onRequest);
    try {
      await listen(secondary, chosen, '::1');
      return { servers: [primary, secondary], port: chosen, addresses: ['127.0.0.1', '::1'] };
    } catch (error) {
      secondary.close();
      // No IPv6 loopback here: the browser reaches 127.0.0.1.
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        return { servers: [primary], port: chosen, addresses: ['127.0.0.1'] };
      }
      primary.close();
      if (port !== 0 || tries >= DYNAMIC_PORT_TRIES) throw portInUse(chosen);
    }
  }
}

/**
 * `connectedServices.oauthCallback.v1` — catches one sign-in redirect for the desktop app.
 *
 * The provider sends the browser back to `http://localhost:<port><path>`. The browser runs on this computer, so
 * this task listens here, on the loopback addresses only, answers the browser with a short page and hands the
 * full address back to the app, which checks its state and exchanges the code. Nothing is kept here. Port 0
 * takes any free port and reports it in the `listening` event, before the app opens the browser.
 */
export function createOauthCallbackHandler() {
  return async function* (
    params: unknown,
    context: Readonly<{ signal: AbortSignal }>,
  ): AsyncGenerator<OauthCallbackListeningEvent, OauthCallbackTaskResult, void> {
    const parsed = parseOauthCallbackParams(params);
    const landingPage = renderLandingPage(parsed.page);
    let port = parsed.port;
    let settle: (url: string) => void = () => {};
    const callback = new Promise<string>((resolve) => {
      settle = resolve;
    });
    const onRequest = (request: IncomingMessage, response: ServerResponse) => {
      const target = request.url ?? '';
      // Only a plain path on this server is the browser coming back; anything else gets a 404.
      let pathname: string | null = null;
      if (target.startsWith('/') && !target.startsWith('//')) {
        try {
          const url = new URL(target, 'http://localhost');
          // A target such as `/\\host/path` names another host once parsed.
          pathname = url.origin === 'http://localhost' ? url.pathname : null;
        } catch {
          pathname = null;
        }
      }
      if (request.method !== 'GET' || pathname !== parsed.path) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
        response.end('Not found');
        return;
      }
      // The address goes back once the page is sent, so closing the listener cannot cut the page off.
      const answered = () => settle(`http://localhost:${port}${target}`);
      response.once('finish', answered);
      response.once('close', answered);
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
      response.end(landingPage);
    };

    let servers: readonly Server[] = [];
    try {
      const listening = await listenOnLoopback(parsed.port, onRequest);
      servers = listening.servers;
      port = listening.port;
      yield { type: 'listening', stepId: 'listen', data: { port, addresses: listening.addresses } };
      const callbackUrl = await waitForCallback(callback, parsed.timeoutMs, context.signal);
      return { callbackUrl };
    } finally {
      for (const server of servers) {
        server.close();
        // The desktop's hsetup runs on Bun; drop a browser's keep-alive socket where the runtime offers it.
        (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }
    }
  };
}
