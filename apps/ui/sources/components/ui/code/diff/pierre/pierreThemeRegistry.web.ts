import { registerCustomTheme } from '@pierre/diffs';
import {
    getHappierTextMateThemeRegistration,
    PIGGERCODE_TEXTMATE_THEME_IDS,
    resolveHappierTextMateThemeId,
} from '@/components/ui/code/highlighting/shiki/happierTextMateTheme';

let registered = false;
const registeredThemeIds = new Set<string>();

export const PIGGERCODE_PIERRE_THEME_IDS = Object.freeze({
    light: PIGGERCODE_TEXTMATE_THEME_IDS.light,
    dark: PIGGERCODE_TEXTMATE_THEME_IDS.dark,
} as const);

export type HappierPierreThemeIds = Readonly<{
    light: string;
    dark: string;
}>;

export function ensureHappierPierreThemesRegistered(): void {
    if (registered) return;
    registered = true;

    registerCustomTheme(PIGGERCODE_PIERRE_THEME_IDS.light, async () => (
        getHappierTextMateThemeRegistration({ isDark: false })
    ));

    registerCustomTheme(PIGGERCODE_PIERRE_THEME_IDS.dark, async () => (
        getHappierTextMateThemeRegistration({ isDark: true })
    ));
    registeredThemeIds.add(PIGGERCODE_PIERRE_THEME_IDS.light);
    registeredThemeIds.add(PIGGERCODE_PIERRE_THEME_IDS.dark);
}

export function resolveHappierPierreThemeIds(params: Readonly<{ isDark: boolean; colors?: Record<string, unknown> | null }>): HappierPierreThemeIds {
    if (!params.colors) return PIGGERCODE_PIERRE_THEME_IDS;
    const dynamicId = resolveHappierTextMateThemeId({ isDark: params.isDark, colors: params.colors });
    return {
        light: params.isDark ? PIGGERCODE_PIERRE_THEME_IDS.light : dynamicId,
        dark: params.isDark ? dynamicId : PIGGERCODE_PIERRE_THEME_IDS.dark,
    };
}

export function ensureHappierPierreThemeRegistered(params: Readonly<{ isDark: boolean; colors?: Record<string, unknown> | null }>): void {
    ensureHappierPierreThemesRegistered();
    if (!params.colors) return;
    const id = resolveHappierTextMateThemeId({ isDark: params.isDark, colors: params.colors });
    if (registeredThemeIds.has(id)) return;
    registeredThemeIds.add(id);
    registerCustomTheme(id, async () => (
        getHappierTextMateThemeRegistration({ isDark: params.isDark, colors: params.colors })
    ));
}
