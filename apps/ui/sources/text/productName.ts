import Constants from 'expo-constants';

/** The app name the translations are written with. */
const UPSTREAM_PRODUCT_NAME = 'Happier';
/** The command the translations tell people to type. */
const UPSTREAM_CLI_COMMAND_NAME = 'happier';

// "Happier Coder" is the app's long name. Happier's own hosted and native offerings keep their
// real names, and lowercase `happier` (commands, paths, domains) is never the product name.
const LONG_NAME = /Happier[ -]Coder(?![A-Za-z0-9])/g;
const PRODUCT_NAME = /(^|[^A-Za-z0-9])Happier(?![A-Za-z0-9])(?![ -](?:Voice|Cloud|Desktop)(?![A-Za-z0-9]))/g;
// Lowercase `happier` used as a command. Paths (`~/.happier`, `.happier/uploads`), links
// (`happier://`), packages (`@happier-dev/cli`) and domains (`happier.dev`) keep their names.
const CLI_COMMAND_NAME = /(^|[^A-Za-z0-9_./@~-])happier(?![A-Za-z0-9_/:-])(?!\.[A-Za-z0-9])/g;

function readAppExtra(): { productName?: unknown; cliCommandName?: unknown } | undefined {
    return (Constants.expoConfig?.extra as { app?: { productName?: unknown; cliCommandName?: unknown } } | undefined)?.app;
}

/** The product name of this build (`extra.app.productName` from app.config.js). */
export function resolveConfiguredProductName(): string {
    const configured = readAppExtra()?.productName;
    return typeof configured === 'string' && configured.trim() ? configured.trim() : UPSTREAM_PRODUCT_NAME;
}

/** The command this build tells people to type (`extra.app.cliCommandName` from app.config.js). */
export function resolveConfiguredCliCommandName(): string {
    const configured = readAppExtra()?.cliCommandName;
    return typeof configured === 'string' && configured.trim() ? configured.trim() : UPSTREAM_CLI_COMMAND_NAME;
}

/** Shows `productName` wherever translated text names the app itself, and `cliCommandName` for its command. */
export function applyProductName(text: string, productName: string, cliCommandName: string = UPSTREAM_CLI_COMMAND_NAME): string {
    let result = text;
    if (productName !== UPSTREAM_PRODUCT_NAME && result.includes(UPSTREAM_PRODUCT_NAME)) {
        result = result
            .replace(LONG_NAME, () => productName)
            .replace(PRODUCT_NAME, (_match, before: string) => `${before}${productName}`);
    }
    if (cliCommandName !== UPSTREAM_CLI_COMMAND_NAME && result.includes(UPSTREAM_CLI_COMMAND_NAME)) {
        result = result.replace(CLI_COMMAND_NAME, (_match, before: string) => `${before}${cliCommandName}`);
    }
    return result;
}
