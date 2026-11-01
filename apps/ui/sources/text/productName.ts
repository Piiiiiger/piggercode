import Constants from 'expo-constants';

/** The app name the translations are written with. */
const UPSTREAM_PRODUCT_NAME = 'Happier';

// "Happier Coder" is the app's long name. Happier's own hosted and native offerings keep their
// real names, and lowercase `happier` (commands, paths, domains) is never the product name.
const LONG_NAME = /Happier[ -]Coder(?![A-Za-z0-9])/g;
const PRODUCT_NAME = /(^|[^A-Za-z0-9])Happier(?![A-Za-z0-9])(?![ -](?:Voice|Cloud|Desktop)(?![A-Za-z0-9]))/g;

/** The product name of this build (`extra.app.productName` from app.config.js). */
export function resolveConfiguredProductName(): string {
    const app = (Constants.expoConfig?.extra as { app?: { productName?: unknown } } | undefined)?.app;
    const configured = typeof app?.productName === 'string' ? app.productName.trim() : '';
    return configured || UPSTREAM_PRODUCT_NAME;
}

/** Shows `productName` wherever translated text names the app itself. */
export function applyProductName(text: string, productName: string): string {
    if (productName === UPSTREAM_PRODUCT_NAME || !text.includes(UPSTREAM_PRODUCT_NAME)) return text;
    return text
        .replace(LONG_NAME, () => productName)
        .replace(PRODUCT_NAME, (_match, before: string) => `${before}${productName}`);
}
