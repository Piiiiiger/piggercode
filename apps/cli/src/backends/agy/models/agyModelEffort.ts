export const AGY_EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type AgyReasoningEffort = (typeof AGY_EFFORT_ORDER)[number];

const AGY_EFFORT_LABELS: Readonly<Record<AgyReasoningEffort, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
};

const AGY_EFFORT_SUFFIX_RE = /^(.+)-(low|medium|high|xhigh|max)$/i;
const AGY_EFFORT_NAME_SUFFIX_RE = /^(.+?)\s*\((Low|Medium|High|XHigh|Max)\)$/i;

export function normalizeAgyReasoningEffort(value: unknown): AgyReasoningEffort | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return (AGY_EFFORT_ORDER as readonly string[]).includes(normalized)
    ? (normalized as AgyReasoningEffort)
    : null;
}

export function hasAgyEffortSuffix(modelId: string): boolean {
  return AGY_EFFORT_SUFFIX_RE.test(modelId.trim());
}

type RawCliProbedModel = Readonly<{
  id: string;
  name: string;
  description?: string;
}>;

type GroupedAgyModel = Readonly<{
  id: string;
  name: string;
  description?: string;
  modelOptions?: ReadonlyArray<Readonly<{
    id: 'reasoning_effort';
    name: 'Thinking';
    type: 'select';
    currentValue: AgyReasoningEffort;
    options: ReadonlyArray<Readonly<{ value: AgyReasoningEffort; name: string }>>;
  }>>;
}>;

type EffortVariantEntry = Readonly<{
  baseId: string;
  baseName: string;
  effort: AgyReasoningEffort;
  raw: RawCliProbedModel;
}>;

function parseEffortVariant(entry: RawCliProbedModel): EffortVariantEntry | null {
  const idMatch = entry.id.match(AGY_EFFORT_SUFFIX_RE);
  const nameMatch = entry.name.match(AGY_EFFORT_NAME_SUFFIX_RE);
  if (!idMatch || !nameMatch) return null;
  const idEffort = normalizeAgyReasoningEffort(idMatch[2]);
  const nameEffort = normalizeAgyReasoningEffort(nameMatch[2]);
  if (!idEffort || idEffort !== nameEffort) return null;
  const baseId = idMatch[1]?.trim() ?? '';
  const baseName = nameMatch[1]?.trim() ?? '';
  if (!baseId || !baseName) return null;
  return { baseId, baseName, effort: idEffort, raw: entry };
}

function buildDescription(id: string, name: string, existing?: string): string | undefined {
  const trimmedExisting = existing?.trim();
  if (trimmedExisting) return trimmedExisting;
  return id !== name ? id : undefined;
}

/**
 * Groups `agy models` rows that differ only by effort tier (e.g. `gemini-4-neon-high` /
 * `Gemini 4 Neon (High)`) into a single model card with a `Thinking` (`reasoning_effort`)
 * option, matching Claude and Codex pickers.
 *
 * Non-effort variants (e.g. `Orchestrator (Neon)`) and single-effort models (e.g.
 * `GPT-OSS 120B (Medium)`) remain standalone cards without a 1-item Thinking bar.
 */
export function groupAgyProbedModels(models: ReadonlyArray<RawCliProbedModel>): ReadonlyArray<GroupedAgyModel> {
  type EffortGroup = {
    kind: 'group';
    baseId: string;
    baseName: string;
    variants: EffortVariantEntry[];
    seenEfforts: Set<AgyReasoningEffort>;
  };
  type StandaloneItem = {
    kind: 'standalone';
    raw: RawCliProbedModel;
  };

  const ordered: Array<EffortGroup | StandaloneItem> = [];
  const groupsByBaseId = new Map<string, EffortGroup>();

  for (const entry of models) {
    const id = entry.id.trim();
    const name = entry.name.trim();
    if (!id || !name || id === 'default') continue;

    const normalizedEntry: RawCliProbedModel = {
      id,
      name,
      ...(entry.description ? { description: entry.description } : {}),
    };

    const variant = parseEffortVariant(normalizedEntry);
    if (!variant) {
      ordered.push({ kind: 'standalone', raw: normalizedEntry });
      continue;
    }

    let group = groupsByBaseId.get(variant.baseId);
    if (!group) {
      group = {
        kind: 'group',
        baseId: variant.baseId,
        baseName: variant.baseName,
        variants: [],
        seenEfforts: new Set(),
      };
      groupsByBaseId.set(variant.baseId, group);
      ordered.push(group);
    }
    if (!group.seenEfforts.has(variant.effort)) {
      group.seenEfforts.add(variant.effort);
      group.variants.push(variant);
    }
  }

  const result: GroupedAgyModel[] = [];
  for (const item of ordered) {
    if (item.kind === 'standalone') {
      const description = buildDescription(item.raw.id, item.raw.name, item.raw.description);
      result.push({
        id: item.raw.id,
        name: item.raw.name,
        ...(description ? { description } : {}),
      });
      continue;
    }

    if (item.variants.length < 2) {
      const only = item.variants[0]!.raw;
      const description = buildDescription(only.id, only.name, only.description);
      result.push({
        id: only.id,
        name: only.name,
        ...(description ? { description } : {}),
      });
      continue;
    }

    const sortedEfforts = AGY_EFFORT_ORDER.filter((tier) => item.seenEfforts.has(tier));
    const currentValue = item.variants[0]!.effort;
    const description = buildDescription(item.baseId, item.baseName);
    result.push({
      id: item.baseId,
      name: item.baseName,
      ...(description ? { description } : {}),
      modelOptions: [
        {
          id: 'reasoning_effort',
          name: 'Thinking',
          type: 'select',
          currentValue,
          options: sortedEfforts.map((effort) => ({
            value: effort,
            name: AGY_EFFORT_LABELS[effort],
          })),
        },
      ],
    });
  }

  return result;
}
