import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { AgentId } from '@happier-dev/agents';

import { AgentIcon } from '@/agents/registry/AgentIcon';
import { getAgentCore, isAgentId } from '@/agents/registry/registryCore';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

const stylesheet = StyleSheet.create((theme) => ({
    row: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 8,
    },
    pickerSlot: {
        flex: 1,
        minWidth: 0,
    },
    trigger: {
        height: 36,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 8,
        paddingHorizontal: 12,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.subtle,
        backgroundColor: theme.colors.surface.base,
    },
    pressed: {
        opacity: 0.78,
    },
    triggerLabel: {
        flex: 1,
        minWidth: 0,
        fontSize: 14,
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
    },
    count: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        fontVariant: ['tabular-nums' as const],
        ...Typography.default(),
    },
    browseButton: {
        width: 36,
        height: 36,
        borderRadius: 10,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    },
}));

export type SessionListAgentPickerProps = Readonly<{
    /** The agents (CLIs) to offer, in the order to show them. */
    options: ReadonlyArray<AgentId>;
    selected: AgentId | null;
    /** Sessions per agent, shown beside each agent. */
    counts: ReadonlyMap<AgentId, number>;
    onSelect: (agentId: AgentId) => void;
    /** Runs when the menu opens, so the machines' installed agents can be detected then. */
    onOpen?: () => void;
    /** Opens the provider sessions browser; null when direct sessions are off. */
    onBrowse: (() => void) | null;
}>;

/**
 * A select box above the session list that picks one agent (CLI): the list then shows that agent's
 * sessions, and + on a folder starts a session with it.
 */
export const SessionListAgentPicker = React.memo(function SessionListAgentPicker(props: SessionListAgentPickerProps) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const [open, setOpen] = React.useState(false);
    const iconColor = theme.colors.text.secondary;
    const selectedName = props.selected ? t(getAgentCore(props.selected).displayNameKey) : t('sessionsList.agentPickerPlaceholder');

    const items = React.useMemo<DropdownMenuItem[]>(() => props.options.map((agentId) => {
        const count = props.counts.get(agentId) ?? 0;
        return {
            id: agentId,
            testID: `session-list-agent-picker:${agentId}`,
            title: t(getAgentCore(agentId).displayNameKey),
            icon: <AgentIcon agentId={agentId} size={16} color={iconColor} />,
            rightElement: count > 0 ? <Text style={styles.count}>{count}</Text> : undefined,
        };
    }), [iconColor, props.counts, props.options, styles.count]);

    const { onOpen, onSelect } = props;
    const handleOpenChange = React.useCallback((next: boolean) => {
        setOpen(next);
        if (next) onOpen?.();
    }, [onOpen]);
    const handleSelect = React.useCallback((itemId: string) => {
        if (isAgentId(itemId)) onSelect(itemId);
    }, [onSelect]);

    return (
        <View style={styles.row}>
            <View style={styles.pickerSlot}>
                <DropdownMenu
                    open={open}
                    onOpenChange={handleOpenChange}
                    items={items}
                    selectedId={props.selected}
                    onSelect={handleSelect}
                    search={false}
                    emptyLabel={t('sessionsList.agentPickerEmpty')}
                    variant="slim"
                    placement="bottom"
                    gap={4}
                    trigger={({ toggle, open: menuOpen }) => (
                        <Pressable
                            testID="session-list-agent-picker"
                            onPress={toggle}
                            style={({ pressed }) => [styles.trigger, pressed ? styles.pressed : null]}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: menuOpen }}
                            aria-expanded={menuOpen}
                            accessibilityLabel={t('sessionsList.agentPickerA11y', { name: selectedName })}
                        >
                            <AgentIcon agentId={props.selected} size={16} color={theme.colors.text.primary} />
                            <Text style={styles.triggerLabel} numberOfLines={1}>{selectedName}</Text>
                            <Icon name={menuOpen ? 'caret-up' : 'caret-down'} size={14} color={iconColor} />
                        </Pressable>
                    )}
                />
            </View>
            {props.onBrowse ? (
                <Pressable
                    testID="session-list-browse-provider-sessions"
                    onPress={props.onBrowse}
                    style={({ pressed }) => [styles.browseButton, pressed ? styles.pressed : null]}
                    accessibilityRole="button"
                    accessibilityLabel={t('directSessions.browseOpenExisting')}
                    hitSlop={4}
                >
                    <Icon name="folder-open" size={18} color={iconColor} />
                </Pressable>
            ) : null}
        </View>
    );
});
