import { z } from 'zod';

/** How far the mouse wheel or trackpad scrolls a terminal: lines scrolled per line the hand moved. */
export const TERMINAL_WHEEL_SPEED_LINES = { slow: 0.5, normal: 1, fast: 2 } as const;

export const TerminalWheelSpeedIdSchema = z.enum(['slow', 'normal', 'fast']);
export type TerminalWheelSpeedId = z.infer<typeof TerminalWheelSpeedIdSchema>;

export const DEFAULT_TERMINAL_WHEEL_SPEED_ID: TerminalWheelSpeedId = 'normal';

export function isTerminalWheelSpeedId(value: string): value is TerminalWheelSpeedId {
    return TerminalWheelSpeedIdSchema.safeParse(value).success;
}
