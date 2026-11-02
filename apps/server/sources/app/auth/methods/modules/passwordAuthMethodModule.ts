import type { AuthMethodModule } from "@/app/auth/methods/types";

import { registerPasswordAuthRoutes } from "@/app/api/routes/auth/registerPasswordAuthRoutes";
import { readAuthFeatureEnv } from "@/app/features/catalog/readFeatureEnv";

/**
 * Username + password login. It is a keyed method: a successful password check hands back the
 * wrapped account secret, and the token still comes from the key challenge. Accounts are created
 * through the key-challenge provision action, then given a password from a signed-in client.
 */
export const passwordAuthMethodModule: AuthMethodModule = Object.freeze({
    id: "password",
    resolveAuthMethod: ({ env }) => {
        const featureEnv = readAuthFeatureEnv(env);
        const loginEnabled = featureEnv.loginPasswordEnabled && featureEnv.loginKeyChallengeEnabled;
        return {
            id: "password",
            actions: [{ id: "login", enabled: loginEnabled, mode: "keyed" }],
            ui: { displayName: "Username and password", iconHint: null },
        };
    },
    isViable: () => false,
    registerRoutes: (app) => {
        const featureEnv = readAuthFeatureEnv(process.env);
        if (!featureEnv.loginPasswordEnabled || !featureEnv.loginKeyChallengeEnabled) return;
        registerPasswordAuthRoutes(app);
    },
});
