import {
  ProviderSessionInfoV1Schema,
  type ProviderSessionInfoV1,
} from '@piggercode/protocol';

import type { Metadata } from '@/api/types';

export type ProviderSessionInfoUpdate = Readonly<{
  title?: string | null;
  updatedAt?: string | null;
}>;

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function hasDurableHappierTitle(metadata: Metadata): boolean {
  return typeof metadata.summary?.text === 'string' && metadata.summary.text.trim().length > 0;
}

export function applyProviderSessionInfoUpdate(params: Readonly<{
  metadata: Metadata;
  provider: string;
  sessionId: string;
  observedAt: number;
  update: ProviderSessionInfoUpdate;
  /**
   * `initialize` (default, chat sessions): the provider's title names an untitled session once.
   * `follow` (「终端」 sessions, where the CLI is the only one naming the conversation): the session
   * title keeps following the provider's title, across renames and new conversations, until the
   * session is named differently.
   */
  titlePolicy?: 'initialize' | 'follow';
}>): Metadata {
  const currentParse = ProviderSessionInfoV1Schema.safeParse(params.metadata.providerSessionInfoV1);
  const current = currentParse.success ? currentParse.data : undefined;
  const sameSession = current?.provider === params.provider && current.sessionId === params.sessionId;
  const candidate: ProviderSessionInfoV1 = {
    v: 1,
    provider: params.provider,
    sessionId: params.sessionId,
    observedAt: params.observedAt,
    ...(sameSession && current && hasOwn(current, 'title') ? { title: current.title } : {}),
    ...(sameSession && current && hasOwn(current, 'updatedAt') ? { updatedAt: current.updatedAt } : {}),
    ...(hasOwn(params.update, 'title') ? { title: params.update.title } : {}),
    ...(hasOwn(params.update, 'updatedAt') ? { updatedAt: params.update.updatedAt } : {}),
  };
  const parsed = ProviderSessionInfoV1Schema.safeParse(candidate);
  if (!parsed.success) return params.metadata;

  const providerTitle = parsed.data.title;
  const previousProviderTitle = typeof current?.title === 'string' ? current.title.trim() : '';
  const titleFollowsProvider = params.titlePolicy === 'follow'
    && previousProviderTitle.length > 0
    && params.metadata.summary?.text?.trim() === previousProviderTitle;
  const shouldInitializeTitle = (!hasDurableHappierTitle(params.metadata) || titleFollowsProvider)
    && typeof providerTitle === 'string'
    && providerTitle.length > 0;

  return {
    ...params.metadata,
    providerSessionInfoV1: parsed.data,
    ...(shouldInitializeTitle
      ? { summary: { text: providerTitle, updatedAt: params.observedAt } }
      : {}),
  };
}
