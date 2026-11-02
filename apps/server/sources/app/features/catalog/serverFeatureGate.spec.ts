import { describe, expect, it } from "vitest";

import { createRouteTestBuilder } from "@/app/api/testkit/routeTestBuilder";
import { createServerFeatureGatedRouteApp, isServerFeatureEnabledForRequest } from "./serverFeatureGate";

describe("serverFeatureGate", () => {
    it("supports registering routes with the (path, handler) overload while still injecting a gate preHandler", async () => {
        const route = createRouteTestBuilder({
            method: "GET",
            path: "/v1/test",
            registerRoutes: (app) => {
                const gated = createServerFeatureGatedRouteApp(app, "bugReports", {
                    PIGGERCODE_FEATURE_BUG_REPORTS__ENABLED: "1",
                    PIGGERCODE_FEATURE_BUG_REPORTS__PROVIDER_URL: "https://reports.example.test",
                } as NodeJS.ProcessEnv);
                gated.get("/v1/test", async () => ({ ok: true }));
            },
        });

        const { response: out, reply } = await route.invoke();

        expect(out).toEqual({ ok: true });
        expect(reply.code).not.toHaveBeenCalledWith(404);
    });
});
