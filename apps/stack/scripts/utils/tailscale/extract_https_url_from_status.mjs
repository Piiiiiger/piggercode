import { extractTailscaleServeHttpsUrl } from '@piggercode/cli-common/tailscale';

export function extractTailscaleHttpsUrlFromStatusText(statusText) {
  return extractTailscaleServeHttpsUrl(String(statusText ?? ''));
}
