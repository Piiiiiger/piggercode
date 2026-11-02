import type { AuthMethodModule } from "@/app/auth/methods/types";

import { keyChallengeAuthMethodModule } from "@/app/auth/methods/modules/keyChallengeAuthMethodModule";
import { mtlsAuthMethodModule } from "@/app/auth/methods/modules/mtlsAuthMethodModule";
import { passwordAuthMethodModule } from "@/app/auth/methods/modules/passwordAuthMethodModule";

const staticAuthMethodModules: readonly AuthMethodModule[] = Object.freeze([
    keyChallengeAuthMethodModule,
    passwordAuthMethodModule,
    mtlsAuthMethodModule,
]);

export function resolveAuthMethodRegistry(_env: NodeJS.ProcessEnv): readonly AuthMethodModule[] {
    // For now, methods are a static registry. Enterprise forks can extend this list safely.
    return staticAuthMethodModules;
}

