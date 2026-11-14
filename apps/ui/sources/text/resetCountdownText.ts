import type { ResetCountdownFormatter } from '@/sync/domains/connectedServices/formatResetCountdown';
import { t } from '@/text';

/** The words of a countdown (`formatResetCountdown`): "3d 4h", "12m", "outdated", in the app's language. */
export const RESET_COUNTDOWN_TEXT: ResetCountdownFormatter = {
    durationNow: () => t('connectedServices.quota.duration.now'),
    durationOutdated: () => t('connectedServices.quota.duration.outdated'),
    durationDaysHours: ({ days, hours }) => t('connectedServices.quota.duration.daysHours', { days, hours }),
    durationHoursMinutes: ({ hours, minutes }) => t('connectedServices.quota.duration.hoursMinutes', { hours, minutes }),
    durationHours: ({ hours }) => t('connectedServices.quota.duration.hours', { hours }),
    durationMinutes: ({ minutes }) => t('connectedServices.quota.duration.minutes', { minutes }),
};
