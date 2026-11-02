import { describe, expect, it, vi } from 'vitest';

import type { TransportHandler } from '@/agent/transport';
import { DefaultTransport } from '@/agent/transport';
import { CodexAcpTransport } from '@/backends/codex/acp/transport';

import { createAcpToolCallLifecycle } from '../createAcpToolCallLifecycle';

describe('ACP provider tool-call deadlines', () => {

  it('does not invent a deadline when a custom transport omits the optional timeout hook', () => {
    vi.useFakeTimers();
    try {
      const emitted: unknown[] = [];
      const transport: TransportHandler = {
        agentName: 'custom-transport',
        getInitTimeout: () => 60_000,
        getToolPatterns: () => [],
      };
      const lifecycle = createAcpToolCallLifecycle({
        transport,
        emit: (message) => emitted.push(message),
        getToolNameContext: () => ({
          recentPromptHadChangeTitle: false,
          toolCallCountSincePrompt: 0,
        }),
      });

      lifecycle.observe({
        toolCallId: 'long-running-call',
        kind: 'read',
        status: 'in_progress',
      });
      vi.advanceTimersByTime(10 * 60_000);

      expect(lifecycle.activeSize).toBe(1);
      expect(emitted).not.toContainEqual(expect.objectContaining({
        type: 'tool-result',
        callId: 'long-running-call',
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});
