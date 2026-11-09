import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { TextInput } from '@/components/ui/text/Text';
import { t } from '@/text';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useSettingMutable } from '@/sync/domains/state/storage';
import { ProviderUsageGaugeSettingsGroup } from '@/components/settings/connectedServices/ProviderUsageGaugeSettingsGroup';
import { Icon } from '@/components/ui/icons/Icon';

const SUBAGENT_LIMIT_CHOICES = [1, 2, 3, 5] as const;

export const SessionProviderLimitsSettingsView = React.memo(function SessionProviderLimitsSettingsView() {
    const { theme } = useUnistyles();
    const popoverBoundaryRef = React.useRef<any>(null);
    const [subagentLimit, setSubagentLimit] = useSettingMutable('sessionSubagentLimit');
    const [openSubagentLimitMenu, setOpenSubagentLimitMenu] = React.useState(false);
    const subagentLimitCounts = Array.from(new Set<number>([
        ...SUBAGENT_LIMIT_CHOICES,
        // A limit set elsewhere stays selectable.
        ...(typeof subagentLimit === 'number' && subagentLimit > 0 ? [subagentLimit] : []),
    ])).sort((left, right) => left - right);
    const subagentLimitOptions = [
        {
            id: 'unlimited',
            title: t('settingsSession.subagentLimit.unlimitedTitle'),
            subtitle: t('settingsSession.subagentLimit.unlimitedSubtitle'),
        },
        {
            id: '0',
            title: t('settingsSession.subagentLimit.offTitle'),
            subtitle: t('settingsSession.subagentLimit.offSubtitle'),
        },
        ...subagentLimitCounts.map((count) => ({
            id: String(count),
            title: t('settingsSession.subagentLimit.countTitle', { count }),
        })),
    ];
    const subagentLimitSelectedId = typeof subagentLimit === 'number' ? String(subagentLimit) : 'unlimited';
    const usageLimitRecoveryEnabled = useFeatureEnabled('sessions.usageLimitRecovery');
    const [usageLimitRecoverySettingsV1, setUsageLimitRecoverySettingsV1] = useSettingMutable('usageLimitRecoverySettingsV1');
    const [openUsageLimitRecoveryMenu, setOpenUsageLimitRecoveryMenu] = React.useState(false);
    const [openUsageLimitRecoveryResumePromptMenu, setOpenUsageLimitRecoveryResumePromptMenu] = React.useState(false);
    const usageLimitRecoveryMode = usageLimitRecoverySettingsV1?.mode === 'auto_wait' ? 'auto_wait' : 'ask';
    const usageLimitRecoveryResumePromptMode =
        usageLimitRecoverySettingsV1?.resumePromptMode === 'off' || usageLimitRecoverySettingsV1?.resumePromptMode === 'custom'
            ? usageLimitRecoverySettingsV1.resumePromptMode
            : 'standard';
    const usageLimitRecoveryCustomResumePrompt = usageLimitRecoverySettingsV1?.customResumePrompt ?? '';
    const [customResumePromptDraft, setCustomResumePromptDraft] = React.useState(usageLimitRecoveryCustomResumePrompt);
    React.useEffect(() => {
        setCustomResumePromptDraft(usageLimitRecoveryCustomResumePrompt);
    }, [usageLimitRecoveryCustomResumePrompt]);
    const usageLimitRecoveryModeRef = React.useRef<'ask' | 'auto_wait'>(usageLimitRecoveryMode);
    const usageLimitRecoveryResumePromptModeRef = React.useRef<'standard' | 'off' | 'custom'>(usageLimitRecoveryResumePromptMode);
    const usageLimitRecoveryCustomResumePromptRef = React.useRef(usageLimitRecoveryCustomResumePrompt);
    usageLimitRecoveryModeRef.current = usageLimitRecoveryMode;
    usageLimitRecoveryResumePromptModeRef.current = usageLimitRecoveryResumePromptMode;
    usageLimitRecoveryCustomResumePromptRef.current = usageLimitRecoveryCustomResumePrompt;
    const writeUsageLimitRecoverySettings = React.useCallback((next: Readonly<{
        mode: 'ask' | 'auto_wait';
        resumePromptMode: 'standard' | 'off' | 'custom';
        customResumePrompt: string;
    }>) => {
        const customResumePrompt = next.customResumePrompt.trim().slice(0, 2000);
        setUsageLimitRecoverySettingsV1({
            v: 1,
            mode: next.mode,
            promptMode: 'standard',
            resumePromptMode: next.resumePromptMode,
            ...(customResumePrompt.length > 0 ? { customResumePrompt } : {}),
        });
    }, [setUsageLimitRecoverySettingsV1]);
    const commitCustomResumePromptDraft = React.useCallback((draft: string) => {
        writeUsageLimitRecoverySettings({
            mode: usageLimitRecoveryModeRef.current,
            resumePromptMode: usageLimitRecoveryResumePromptModeRef.current,
            customResumePrompt: draft,
        });
    }, [writeUsageLimitRecoverySettings]);
    const usageLimitRecoveryOptions = [
        { id: 'ask', title: t('settingsSession.usageLimitRecovery.askTitle'), subtitle: t('settingsSession.usageLimitRecovery.askSubtitle') },
        { id: 'auto_wait', title: t('settingsSession.usageLimitRecovery.autoWaitTitle'), subtitle: t('settingsSession.usageLimitRecovery.autoWaitSubtitle') },
    ];
    const resumePromptOptions = [
        { id: 'standard', title: t('settingsSession.usageLimitRecovery.resumePromptStandardTitle'), subtitle: t('settingsSession.usageLimitRecovery.resumePromptStandardSubtitle') },
        { id: 'custom', title: t('settingsSession.usageLimitRecovery.resumePromptCustomTitle'), subtitle: t('settingsSession.usageLimitRecovery.resumePromptCustomSubtitle') },
        { id: 'off', title: t('settingsSession.usageLimitRecovery.resumePromptOffTitle'), subtitle: t('settingsSession.usageLimitRecovery.resumePromptOffSubtitle') },
    ];
    return (
        <ItemList ref={popoverBoundaryRef} style={{ paddingTop: 0 }}>
            <ItemGroup title={t('settingsSession.subagentLimit.title')} footer={t('settingsSession.subagentLimit.footer')}>
                <DropdownMenu
                    open={openSubagentLimitMenu}
                    onOpenChange={setOpenSubagentLimitMenu}
                    variant="selectable"
                    search={false}
                    selectedId={subagentLimitSelectedId}
                    showCategoryTitles={false}
                    matchTriggerWidth={true}
                    connectToTrigger={true}
                    rowKind="item"
                    popoverBoundaryRef={popoverBoundaryRef}
                    itemTrigger={{
                        title: t('settingsSession.subagentLimit.limitTitle'),
                        icon: <Icon name="robot" size={29} color={theme.colors.accent.indigo} />,
                        itemProps: { testID: 'settings-session-subagentLimit-trigger' },
                    }}
                    items={subagentLimitOptions}
                    onSelect={(id) => {
                        if (id === 'unlimited') {
                            setSubagentLimit(null);
                        } else {
                            const count = Number(id);
                            if (!Number.isInteger(count) || count < 0) return;
                            setSubagentLimit(count);
                        }
                        setOpenSubagentLimitMenu(false);
                    }}
                />
            </ItemGroup>

            {usageLimitRecoveryEnabled ? (
                <ItemGroup title={t('settingsSession.usageLimitRecovery.title')} footer={t('settingsSession.usageLimitRecovery.footer')}>
                    <DropdownMenu
                        open={openUsageLimitRecoveryMenu}
                        onOpenChange={setOpenUsageLimitRecoveryMenu}
                        variant="selectable"
                        search={false}
                        selectedId={usageLimitRecoveryMode}
                        showCategoryTitles={false}
                        matchTriggerWidth={true}
                        connectToTrigger={true}
                        rowKind="item"
                        popoverBoundaryRef={popoverBoundaryRef}
                        itemTrigger={{
                            title: t('settingsSession.usageLimitRecovery.modeTitle'),
                            subtitle: usageLimitRecoveryMode === 'auto_wait'
                                ? t('settingsSession.usageLimitRecovery.autoWaitSelectedSubtitle')
                                : t('settingsSession.usageLimitRecovery.askSelectedSubtitle'),
                            icon: <Icon name="timer" size={29} color={theme.colors.accent.indigo} />,
                            showSelectedSubtitle: false,
                            itemProps: { testID: 'settings-session-usageLimitRecovery-trigger' },
                        }}
                        items={usageLimitRecoveryOptions}
                        onSelect={(id) => {
                            if (id !== 'ask' && id !== 'auto_wait') return;
                            usageLimitRecoveryModeRef.current = id;
                            writeUsageLimitRecoverySettings({
                                mode: id,
                                resumePromptMode: usageLimitRecoveryResumePromptModeRef.current,
                                customResumePrompt: usageLimitRecoveryCustomResumePromptRef.current,
                            });
                            setOpenUsageLimitRecoveryMenu(false);
                        }}
                    />
                    <DropdownMenu
                        open={openUsageLimitRecoveryResumePromptMenu}
                        onOpenChange={setOpenUsageLimitRecoveryResumePromptMenu}
                        variant="selectable"
                        search={false}
                        selectedId={usageLimitRecoveryResumePromptMode}
                        showCategoryTitles={false}
                        matchTriggerWidth={true}
                        connectToTrigger={true}
                        rowKind="item"
                        popoverBoundaryRef={popoverBoundaryRef}
                        itemTrigger={{
                            title: t('settingsSession.usageLimitRecovery.resumePromptTitle'),
                            subtitle: usageLimitRecoveryResumePromptMode === 'off'
                                ? t('settingsSession.usageLimitRecovery.resumePromptOffSelectedSubtitle')
                                : usageLimitRecoveryResumePromptMode === 'custom'
                                    ? t('settingsSession.usageLimitRecovery.resumePromptCustomSelectedSubtitle')
                                    : t('settingsSession.usageLimitRecovery.resumePromptStandardSelectedSubtitle'),
                            icon: <Icon name="chat-circle-dots" size={29} color={theme.colors.accent.indigo} />,
                            showSelectedSubtitle: false,
                            itemProps: { testID: 'settings-session-usageLimitRecovery-resumePrompt-trigger' },
                        }}
                        items={resumePromptOptions}
                        onSelect={(id) => {
                            if (id !== 'standard' && id !== 'off' && id !== 'custom') return;
                            usageLimitRecoveryResumePromptModeRef.current = id;
                            writeUsageLimitRecoverySettings({
                                mode: usageLimitRecoveryModeRef.current,
                                resumePromptMode: id,
                                customResumePrompt: usageLimitRecoveryCustomResumePromptRef.current,
                            });
                            setOpenUsageLimitRecoveryResumePromptMenu(false);
                        }}
                    />
                    {usageLimitRecoveryResumePromptMode === 'custom' ? (
                        <Item
                            testID="settings-session-usageLimitRecovery-customResumePrompt"
                            title={t('settingsSession.usageLimitRecovery.customResumePromptTitle')}
                            subtitle={(
                                <TextInput
                                    testID="settings-session-usageLimitRecovery-customResumePrompt-input"
                                    value={customResumePromptDraft}
                                    onChangeText={setCustomResumePromptDraft}
                                    onBlur={() => commitCustomResumePromptDraft(customResumePromptDraft)}
                                    onSubmitEditing={() => commitCustomResumePromptDraft(customResumePromptDraft)}
                                    placeholder={t('settingsSession.usageLimitRecovery.customResumePromptPlaceholder')}
                                    placeholderTextColor={theme.colors.input.placeholder}
                                    maxLength={2000}
                                    style={{ color: theme.colors.input.text }}
                                />
                            )}
                            subtitleLines={0}
                            icon={<Icon name="pencil-simple" size={29} color={theme.colors.accent.indigo} />}
                            mode="info"
                            showChevron={false}
                        />
                    ) : null}
                </ItemGroup>
            ) : null}

            <ProviderUsageGaugeSettingsGroup />
        </ItemList>
    );
});

export default SessionProviderLimitsSettingsView;
