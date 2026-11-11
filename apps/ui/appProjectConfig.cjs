// Keep the Expo project identity dependency-free so trusted recovery jobs can
// submit already-built artifacts without installing the application workspace.
const EXPO_PROJECT_CONFIG = Object.freeze({
    owner: 'happier-dev',
    slug: 'happier',
    // Upstream's EAS project id is deliberately not shipped: with no project id expo-updates stays off.
    // Set EXPO_PUBLIC_EAS_PROJECT_ID to this fork's own Expo project to enable updates and Expo push tokens.
    easProjectId: '',
});

module.exports = { EXPO_PROJECT_CONFIG };
