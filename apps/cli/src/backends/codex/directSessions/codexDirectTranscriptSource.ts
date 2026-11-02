import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { DirectSessionsSource } from '@piggercode/protocol';
import { DirectSessionsProviderUnavailableError, type DirectSessionTranscriptPage } from '@/backends/directSessions/providerOps';
import { withCodexAppServerClient } from '../appServer/client/withCodexAppServerClient';
import { resolveCodexAppServerProcessEnv } from '../appServer/resolveCodexAppServerProcessEnv';
import { readCodexSessionMetaFromRollout } from '../localControl/rolloutDiscovery';
import { collectCodexSessionRolloutFiles } from './collectCodexSessionRolloutFiles';
import { pageCodexRolloutStreams, readAfterCodexRolloutStreams } from './codexDirectTranscriptStreamPaging';
import { decodeCodexNativeTranscriptCursor, pageCodexNativeTranscript } from './pageCodexNativeTranscript';
import { resolveCodexHomesForDirectSessionsSource } from './resolveCodexHomesForDirectSessionsSource';

async function hasRecordAfterSessionMeta(filePath: string): Promise<boolean> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    let sawSessionMeta = false;
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (sawSessionMeta) return true;
      sawSessionMeta = true;
    }
    return false;
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** One source decision for browse, import and follow. Native cursors retain their selected home. */
export async function readCodexDirectTranscript(params: Readonly<{
  source: DirectSessionsSource;
  activeServerDir: string;
  env?: NodeJS.ProcessEnv;
  remoteSessionId: string;
  direction: 'older' | 'newer';
  cursor?: string;
  maxBytes: number;
  maxItems: number;
  follow?: boolean;
}>): Promise<DirectSessionTranscriptPage> {
  const env = params.env ?? process.env;
  const homes = await resolveCodexHomesForDirectSessionsSource({ ...params, env });
  const nativeCursor = decodeCodexNativeTranscriptCursor(params.cursor);
  if (nativeCursor && (!homes.includes(nativeCursor.home) || nativeCursor.threadId !== params.remoteSessionId)) {
    throw new DirectSessionsProviderUnavailableError('Codex transcript cursor does not match the selected source');
  }
  let selectedNativeHome: string | undefined;
  let hasPaginatedRollout = false;
  let paginatedRolloutMayHoldHistory = false;
  if (!nativeCursor) {
    const perHome = await Promise.all(homes.map(async home => ({ home,
      files: await collectCodexSessionRolloutFiles({ codexHome: home, remoteSessionId: params.remoteSessionId }) })));
    const best = perHome.filter(entry => entry.files.length > 0).sort((left, right) =>
      Math.max(...right.files.map(file => file.mtimeMs)) - Math.max(...left.files.map(file => file.mtimeMs)))[0];
    // A paginated rollout can be only a local segment with an inherited history_base.
    // Codex owns replaying that lineage; the legacy JSONL projection cannot prove completeness.
    const rollouts = best ? await Promise.all(best.files.map(async file => ({ file,
      metadata: await readCodexSessionMetaFromRollout(file.filePath) }))) : [];
    hasPaginatedRollout = rollouts.some(({ metadata }) => metadata?.history_mode === 'paginated');
    // Only a rollout that inherits nothing and recorded nothing after its session_meta
    // (a thread that never ran a turn) proves that empty native history is complete.
    paginatedRolloutMayHoldHistory = hasPaginatedRollout && (await Promise.all(rollouts.map(({ file, metadata }) =>
      !metadata || metadata.history_base != null ? true : hasRecordAfterSessionMeta(file.filePath)))).some(Boolean);
    selectedNativeHome = best?.home;
    if (best && !hasPaginatedRollout) {
      const input = { ...params, codexHome: best.home, initialRolloutFiles: best.files };
      if (params.follow) {
        const page = await readAfterCodexRolloutStreams({ ...input, cursor: params.cursor! });
        return { ...page, tailCursor: null, hasMore: page.truncationReason === 'page_limit' };
      }
      const page = await pageCodexRolloutStreams(input);
      return { ...page, truncated: page.truncated === true };
    }
  }
  let failure: unknown = new DirectSessionsProviderUnavailableError('Codex transcript source is unavailable');
  for (const home of nativeCursor ? [nativeCursor.home] : selectedNativeHome ? [selectedNativeHome] : homes) {
    try {
      const processEnv = await resolveCodexAppServerProcessEnv({ processEnv: { ...process.env, ...env },
        affinity: { home: params.source.kind === 'codexHome' ? params.source.home : 'user', homePath: home } });
      const reset = Boolean(params.cursor && params.cursor !== 'tail' && !nativeCursor);
      const page = await withCodexAppServerClient({ processEnv, run: client => pageCodexNativeTranscript({
        ...params, client, home, paginatedRolloutMayHoldHistory, cursor: nativeCursor ? params.cursor : undefined,
        tailOnly: params.follow && (!nativeCursor || params.cursor === 'tail'),
      }) });
      return reset ? { ...page, items: [], truncated: true, truncationReason: 'source_discontinuity' } : page;
    } catch (error) { failure = error; }
  }
  throw failure;
}
