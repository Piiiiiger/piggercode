import { createCodexAppServerStreamEventBridge } from '../streamEventBridge';
import type { CodexRolloutAction } from '../../localControl/rolloutMapper';

/**
 * The native history API returns the same completed items as live app-server notifications, so
 * history shows what the live transcript shows. An item the bridge gives no Direct row (a web
 * search, an image view, a subagent call, a review, reasoning) is left out, and a user message
 * keeps its text without its media, as the live and rollout readers do. Failing the whole read on
 * such an item left every Codex thread that ran a web search unreadable.
 */
export function projectCodexNativeHistoryItem(item: Readonly<Record<string, unknown>>): CodexRolloutAction[] {
  const bridge = createCodexAppServerStreamEventBridge();
  const updates = bridge.onNotification({
    method: item.type === 'userMessage' ? 'item/started' : 'item/completed', params: { item },
  });
  const actions: CodexRolloutAction[] = [];
  for (const update of updates) {
    switch (update.type) {
      case 'provider-user-text': actions.push({ type: 'user-text', text: update.text }); break;
      case 'assistant-text-final':
      case 'async-user-input-request': actions.push({ type: 'assistant-text', text: update.text }); break;
      case 'tool-call': actions.push({ type: 'tool-call', callId: update.callId, name: update.name, input: update.input }); break;
      case 'tool-result': actions.push({ type: 'tool-result', callId: update.callId, output: update.output }); break;
      case 'context-compaction': actions.push({ type: 'context-compaction', phase: 'completed', lifecycleId: `codex:context-compaction:${update.itemId}`, source: 'provider-event', providerEventId: update.itemId }); break;
      // No row in the Direct transcript vocabulary (reasoning, reviews, generated media).
      default: break;
    }
  }
  return actions;
}
