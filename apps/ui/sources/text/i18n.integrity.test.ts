import { describe, expect, it } from 'vitest';

import { en } from './translations/en';
import { zhHans } from './translations/zh-Hans';

import {
    auditTranslations,
    flattenTranslationLeaves,
} from '../../tools/i18n/translationAudit';

const IGNORED_UNTRANSLATED_KEYS = new Set([
    // Operating system names, shared across locales.
    'settingsAttachments.sharedFolder.mountGuide.platformLinux',
    'settingsAttachments.sharedFolder.mountGuide.platformMacos',
    'promptLibrary.supportingFilePathPlaceholder',
    'files.sourceControlOperations.update.remotes.namePlaceholder',
    'settingsSession.handoff.includeIgnoredMode.globsPlaceholder',
    'connectedServices.detail.prompts.accessTokenPlaceholder',
    'connectedServices.serviceNames.github',
    // Provider product name, shared across locales.
    'deps.installable.githubCli.title',
    // Product name, shared across locales.
    'deps.installable.difftastic.title',
    'newSession.githubCliBanner.title',
    'files.markdown',
    'settingsSession.sessionCreation.modalModeSimpleTitle',
    'settingsSession.sessionCreation.wizardPresentationAutoTitle',
    'settingsSession.promptPersonalization.title',
    'settingsSession.promptPersonalization.footer',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsTitle',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsNeverTitle',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsNeverSubtitle',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsInitialTitle',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsInitialSubtitle',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsOngoingTitle',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsOngoingSubtitle',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsInitialSelectedSubtitle',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsOngoingSelectedSubtitle',
    'settingsSession.promptPersonalization.askAgentToRenameSessionsDisabledSubtitle',
    'settingsSession.promptPersonalization.askAgentToSuggestReplyOptionsTitle',
    'settingsSession.promptPersonalization.askAgentToSuggestReplyOptionsEnabledSubtitle',
    'settingsSession.promptPersonalization.askAgentToSuggestReplyOptionsDisabledSubtitle',
    'newSession.worktree.backToRoot',
    'welcome.welcomeFooterRelay',
    'settingsSession.sessionList.narrowWorkingIndicatorSpinnerTitle',
    'settingsSession.sessionList.workingIndicatorSpinnerTitle',
    'settingsSession.sessionList.identityDisplayAvatarTitle',
    'settingsSession.transcript.messageActions.template.placeholder',
    // Release channel names, the installer's own `--channel` vocabulary (R11/RV-9). Stable is
    // translated where the language has a word for it; Preview and Dev read as channel names.
    'machine.thisComputer.cliChannelPreview',
    'machine.thisComputer.cliChannelDev',
    // The product name of Happier's own command line (R13 (e) Updates rows).
    'updates.happierCliTitle',
    // Literal terminal multiplexer executable names.
    'settingsProviders.plugins.claude.fields.claudeUnifiedTerminalHost.options.tmux.title',
    'settingsProviders.plugins.claude.fields.claudeUnifiedTerminalHost.options.zellij.title',
]);
const IGNORED_UNTRANSLATED_KEYS_BY_LOCALE: Readonly<Record<string, ReadonlySet<string>>> = {};
const IGNORED_UNTRANSLATED_KEY_PREFIXES = [
    'settingsAppearance.themeProfiles.',
    'settingsKeyboard.',
    'settingsSession.sessionCreation.',
    'settingsSession.promptPersonalization.',
    'commandPalette.commands.',
    'releaseNotes.onboardingShowcase.',
    'sessionsList.',
];
const UNTRANSLATED_PREFIX_BASELINE_COUNTS: Record<string, Record<string, number>> = {
    'zh-Hans': {
        'settingsAppearance.themeProfiles.': 106,
        'settingsKeyboard.': 21,
        'settingsSession.sessionCreation.': 1,
        'settingsSession.promptPersonalization.': 15,
        'commandPalette.commands.': 35,
        'releaseNotes.onboardingShowcase.': 0,
        'sessionsList.': 22,
    },
};

// This test is a drift-stopper: it fails if we introduce any *new* untranslated English strings outside
// of explicitly allowlisted scopes in `apps/ui/tools/i18n/translationAudit.ts`.
const MAX_UNTRANSLATED_STRINGS = 0;

const FUNCTION_SAMPLE_ARGS_BY_KEY = new Map<string, unknown[]>([
    ['transcript.selection.selectedCount', [{ count: 1 }, { count: 2 }]],
    ['transcript.selection.copyA11y', [{ count: 1 }, { count: 2 }]],
    ['transcript.selection.sendA11y', [{ count: 1 }, { count: 2 }]],
    ['connectedServices.detail.groups.memberQuotaExhaustedUntil', [{ time: '12:00' }]],
    ['connectedServices.detail.groups.memberRateLimitedUntil', [{ time: '12:00' }]],
    ['connectedServices.detail.groups.memberCapacityLimitedUntil', [{ time: '12:00' }]],
    ['connectedServices.detail.groups.memberAuthInvalidUntil', [{ time: '12:00' }]],
    ['connectedServices.detail.groups.memberPlanUnavailableUntil', [{ time: '12:00' }]],
    ['connectedServices.detail.groups.memberValidationBlockedUntil', [{ time: '12:00' }]],
    ['memorySearchSettings.indexContents.subtitle', [{ sessions: 2, lightShards: 3, deepChunks: 4 }]],
    ['memorySearchSettings.queue.subtitle', [{ selected: 1, queued: 2, indexing: 3, indexed: 4, empty: 5, failed: 6, waiting: 7 }]],
    ['memorySearchSettings.queue.workerPhase', [{ phase: 'backfill' }]],
    ['memorySearchSettings.lastRun.subtitle', [{ considered: 2, processed: 3, semanticRows: 4, failures: 5 }]],
]);

const IGNORED_IDENTICAL_STRING_KEYS = new Set([
    'settingsSession.transcript.messageActions.template.placeholder',
]);
const STRING_KEYS_REQUIRING_LOCALIZATION = new Set([
    'transcript.selection.sendTo.searchPlaceholder',
    'transcript.selection.sendTo.addNotePlaceholder',
]);

type SampledTranslationFunction = (arg: unknown) => unknown;

function evaluateTranslationFunction(fn: SampledTranslationFunction, arg: unknown): string | null {
    const value = fn(arg);
    return typeof value === 'string' ? value : null;
}

describe('i18n integrity', () => {
    it('does not increase the number of untranslated English strings', () => {
        const locales = [
            { code: 'zh-Hans', root: zhHans },
        ];
        const report = auditTranslations({
            en,
            locales,
        });

        const allUntranslated = Object.entries(report)
            .flatMap(([locale, r]) => r.untranslatedStrings.map((u) => ({ ...u, locale })));
        const baselineIncreases = Object.entries(UNTRANSLATED_PREFIX_BASELINE_COUNTS)
            .flatMap(([locale, counts]) => Object.entries(counts).map(([prefix, max]) => {
                const count = allUntranslated.filter((entry) => entry.locale === locale && entry.key.startsWith(prefix)).length;
                return { locale, prefix, count, max };
            }))
            .filter((entry) => entry.count > entry.max);
        if (baselineIncreases.length > 0) {
            throw new Error(
                [
                    'Found new untranslated strings inside prefix-scoped i18n baselines.',
                    'Translate the new keys or intentionally update the fixed baseline count.',
                    '',
                    ...baselineIncreases.map((entry) => `${entry.locale}: ${entry.prefix} ${entry.count}/${entry.max}`),
                ].join('\n')
            );
        }

        const untranslated = allUntranslated
            .filter((entry) => {
                if (IGNORED_UNTRANSLATED_KEYS.has(entry.key)) return false;
                if (IGNORED_UNTRANSLATED_KEYS_BY_LOCALE[entry.locale]?.has(entry.key)) return false;
                return !IGNORED_UNTRANSLATED_KEY_PREFIXES.some((prefix) => entry.key.startsWith(prefix));
            });

        if (untranslated.length > MAX_UNTRANSLATED_STRINGS) {
            const sample = untranslated
                .slice(0, 40)
                .map((u) => `${u.locale}: ${u.key} = ${JSON.stringify(u.value)}`)
                .join('\n');
            throw new Error(
                [
                    `Found ${untranslated.length} untranslated strings identical to English.`,
                    `Expected ${MAX_UNTRANSLATED_STRINGS}; translate strings or add explicit allowlist entries for intentional fallbacks.`,
                    'Translate these strings in the locale files under sources/text/translations/.',
                    '',
                    'Sample:',
                    sample,
                ].join('\n')
            );
        }

        expect(untranslated.length).toBeLessThanOrEqual(MAX_UNTRANSLATED_STRINGS);

        const enLeaves = new Map(flattenTranslationLeaves(en).map((leaf) => [leaf.key, leaf]));
        const missingFunctionOutputs = locales.flatMap((locale) => {
            const localeLeaves = new Map(flattenTranslationLeaves(locale.root).map((leaf) => [leaf.key, leaf]));
            return Array.from(FUNCTION_SAMPLE_ARGS_BY_KEY.keys()).flatMap((key) => {
                const enLeaf = enLeaves.get(key);
                if (enLeaf?.kind !== 'function') return [];
                const localeLeaf = localeLeaves.get(key);
                if (localeLeaf?.kind === 'function') return [];
                return [{
                    locale: locale.code,
                    key,
                    actualKind: localeLeaf?.kind ?? 'missing',
                }];
            });
        });

        if (missingFunctionOutputs.length > 0) {
            const sample = missingFunctionOutputs
                .slice(0, 40)
                .map((entry) => `${entry.locale}: ${entry.key} (${entry.actualKind})`)
                .join('\n');
            throw new Error(
                [
                    `Found ${missingFunctionOutputs.length} missing sampled translation function keys.`,
                    'Add locale functions for these guarded keys so runtime fallback does not return English.',
                    '',
                    'Sample:',
                    sample,
                ].join('\n')
            );
        }

        const untranslatedFunctionOutputs = locales.flatMap((locale) => {
            const localeLeaves = new Map(flattenTranslationLeaves(locale.root).map((leaf) => [leaf.key, leaf]));
            return Array.from(FUNCTION_SAMPLE_ARGS_BY_KEY.entries()).flatMap(([key, sampleArgs]) => {
                const enLeaf = enLeaves.get(key);
                const localeLeaf = localeLeaves.get(key);
                if (enLeaf?.kind !== 'function' || localeLeaf?.kind !== 'function') return [];

                return sampleArgs.flatMap((sampleArg, sampleIndex) => {
                    const enValue = evaluateTranslationFunction(enLeaf.value as SampledTranslationFunction, sampleArg);
                    const localeValue = evaluateTranslationFunction(localeLeaf.value as SampledTranslationFunction, sampleArg);
                    if (!enValue || !localeValue || localeValue !== enValue) return [];
                    return [{
                        locale: locale.code,
                        key,
                        sampleIndex,
                        value: localeValue,
                    }];
                });
            });
        });

        if (untranslatedFunctionOutputs.length > 0) {
            const sample = untranslatedFunctionOutputs
                .slice(0, 40)
                .map((entry) => `${entry.locale}: ${entry.key}[${entry.sampleIndex}] = ${JSON.stringify(entry.value)}`)
                .join('\n');
            throw new Error(
                [
                    `Found ${untranslatedFunctionOutputs.length} untranslated function outputs identical to English.`,
                    'Translate these function-returned strings in sources/text/translations/.',
                    '',
                    'Sample:',
                    sample,
                ].join('\n')
            );
        }

        const enStringLeaves = new Map(
            flattenTranslationLeaves(en)
                .filter((leaf) => leaf.kind === 'string')
                .map((leaf) => [leaf.key, leaf.value])
        );
        const identicalStringValues = locales.flatMap((locale) => {
            return flattenTranslationLeaves(locale.root).flatMap((leaf) => {
                if (leaf.kind !== 'string') return [];
                if (IGNORED_IDENTICAL_STRING_KEYS.has(leaf.key)) return [];
                if (!STRING_KEYS_REQUIRING_LOCALIZATION.has(leaf.key)) return [];
                const enValue = enStringLeaves.get(leaf.key);
                if (!enValue || leaf.value !== enValue) return [];
                return [{ locale: locale.code, key: leaf.key, value: leaf.value }];
            });
        });

        if (identicalStringValues.length > 0) {
            const sample = identicalStringValues
                .slice(0, 40)
                .map((entry) => `${entry.locale}: ${entry.key} = ${JSON.stringify(entry.value)}`)
                .join('\n');
            throw new Error(
                [
                    `Found ${identicalStringValues.length} string values identical to English.`,
                    'Translate the values or add a narrow intentional fallback allowlist entry.',
                    '',
                    'Sample:',
                    sample,
                ].join('\n')
            );
        }
    });
});
