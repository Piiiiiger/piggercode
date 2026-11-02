import type { AgentId } from '../types.js';
import { parseBooleanEnv } from '@piggercode/protocol';

export type ProviderCliSourcePreference = 'system-first' | 'managed-first';
export type ProviderCliManualInstallKind = 'command' | 'vendor_recipe' | 'none';
export type ProviderCliInstallPlatform = 'darwin' | 'linux' | 'win32';

export type ProviderCliInstallCommand = Readonly<{
  cmd: string;
  args: ReadonlyArray<string>;
  requiresAdmin?: boolean;
  note?: string | null;
}>;

export type ProviderCliManualInstallRecipes =
  | Partial<Record<ProviderCliInstallPlatform, ReadonlyArray<ProviderCliInstallCommand>>>
  | null;

export type ProviderCliArchiveExtractionLimits = Readonly<{
  maxFileBytes: number;
  maxExpandedBytes: number;
}>;

export type ProviderCliManagedArchiveEntry = Readonly<{
  archivePath: string;
  destinationPath: string;
}>;

export type ProviderCliManagedAssetNameByPlatform = Readonly<
  Record<ProviderCliInstallPlatform, Readonly<Record<'arm64' | 'x64', string>>>
>;

export type ProviderCliManagedInstallSpec =
  | Readonly<{
      kind: 'github_release_binary';
      githubRepo: string;
      binaryName: string;
      assetNameByPlatform?: ProviderCliManagedAssetNameByPlatform;
      archiveEntriesByPlatform?: Readonly<
        Record<ProviderCliInstallPlatform, ReadonlyArray<ProviderCliManagedArchiveEntry>>
      >;
      archiveExtractionLimits?: ProviderCliArchiveExtractionLimits;
    }>
  | Readonly<{
      kind: 'managed_package';
      packageName: string;
      binaryName: string;
    }>;

export type ProviderCliKnownCommandCandidate =
  | Readonly<{
      kind: 'envBinDir';
      envVar: string;
      relativeDir: string;
    }>
  | Readonly<{
      kind: 'homeBinDir';
      relativeDir: string;
    }>
  | Readonly<{
      kind: 'homePath';
      relativePath: string;
    }>
  | Readonly<{
      kind: 'absolutePath';
      path: string;
    }>
  | Readonly<{
      kind: 'homeVersionedDir';
      relativeDir: string;
    }>;

export type ProviderCliAlternativeBinaryIdentityProbe = Readonly<{
  args: ReadonlyArray<string>;
  timeoutMs: number;
  stdoutJsonStringField: string;
}>;

/**
 * Who owns an installed agent CLI, derived from its resolved path. Only `managed`
 * and `native` (with a declared vendor updater) can be updated by Happier; the
 * package-manager sources are surfaced with a copyable command instead.
 */
export type ProviderCliInstallSource = 'managed' | 'native' | 'npm' | 'pnpm' | 'bun' | 'brew' | 'other';

/**
 * The vendor's own updater, verified from vendor documentation or source. It runs
 * against the resolved executable only when that executable lives under one of
 * `installPaths` (home-relative, `/`-separated; the resolved path or its real
 * path must equal or sit under an entry), so Happier never asks a vendor updater
 * to replace an install that a package manager owns.
 */
export type ProviderCliNativeUpdateSpec = Readonly<{
  args: ReadonlyArray<string>;
  installPaths: ReadonlyArray<string>;
}>;

export type ProviderCliLatestVersionSource =
  | Readonly<{ kind: 'npm'; packageName: string }>
  | Readonly<{ kind: 'github_release'; githubRepo: string }>;

export type ProviderCliRuntimeSpec = Readonly<{
  id: AgentId;
  title: string;
  binaryName: string;
  alternativeBinaryNames?: ReadonlyArray<string>;
  alternativeBinaryFallbackEnabledEnvVar?: string | null;
  alternativeBinaryIdentityProbe?: ProviderCliAlternativeBinaryIdentityProbe | null;
  knownCommandCandidates?: ReadonlyArray<ProviderCliKnownCommandCandidate> | null;
  sourcePreferenceDefault: ProviderCliSourcePreference;
  managedInstall: ProviderCliManagedInstallSpec | null;
  manualInstallKind: ProviderCliManualInstallKind;
  manualInstallRecipes: ProviderCliManualInstallRecipes;
  acceptsJavaScriptFileOverride: boolean;
  installGuideUrl?: string | null;
  docsUrl?: string | null;
  /** The vendor's npm package, when the CLI is also published to npm and it is not already the managed package. */
  npmPackageName?: string | null;
  nativeUpdate?: ProviderCliNativeUpdateSpec | null;
}>;

function bashCurlPipe(url: string): ProviderCliInstallCommand {
  return { cmd: 'bash', args: ['-lc', `curl -fsSL ${url} | bash`] };
}

function powershellInstall(command: string): ProviderCliInstallCommand {
  return {
    cmd: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
  };
}

export const PROVIDER_CLI_RUNTIME_SPECS: Readonly<Record<AgentId, ProviderCliRuntimeSpec>> = {
  claude: {
    id: 'claude',
    title: 'Claude Code CLI',
    binaryName: 'claude',
    knownCommandCandidates: [
      { kind: 'homeBinDir', relativeDir: '.local/bin' },
      { kind: 'homeVersionedDir', relativeDir: '.local/share/claude/versions' },
      { kind: 'homePath', relativePath: '.claude/local/cli.js' },
      { kind: 'absolutePath', path: '/opt/homebrew/bin/claude' },
      { kind: 'absolutePath', path: '/usr/local/bin/claude' },
      { kind: 'absolutePath', path: '/home/linuxbrew/.linuxbrew/bin/claude' },
      { kind: 'homePath', relativePath: '.bun/bin/claude' },
      { kind: 'homePath', relativePath: 'AppData/Local/Claude/claude.exe' },
      { kind: 'homeVersionedDir', relativeDir: 'AppData/Local/Claude/versions' },
      { kind: 'homePath', relativePath: '.claude/claude.exe' },
      { kind: 'homeVersionedDir', relativeDir: '.claude/versions' },
      { kind: 'homePath', relativePath: '.local/bin/claude.exe' },
    ],
    sourcePreferenceDefault: 'system-first',
    managedInstall: null,
    manualInstallKind: 'vendor_recipe',
    manualInstallRecipes: {
      darwin: [bashCurlPipe('https://claude.ai/install.sh')],
      linux: [bashCurlPipe('https://claude.ai/install.sh')],
      win32: [powershellInstall('irm https://claude.ai/install.ps1 | iex')],
    },
    acceptsJavaScriptFileOverride: true,
    installGuideUrl: 'https://code.claude.com/docs/en/setup',
    docsUrl: 'https://claude.ai',
    npmPackageName: '@anthropic-ai/claude-code',
    // https://code.claude.com/docs/en/setup ("Update manually": `claude update`). The native
    // installer links ~/.local/bin/claude into ~/.local/share/claude/versions/ and, on Windows,
    // installs %USERPROFILE%\.local\bin\claude.exe beside ~/.local/share/claude.
    nativeUpdate: {
      args: ['update'],
      installPaths: ['.local/share/claude', '.local/bin/claude.exe'],
    },
  },
  codex: {
    id: 'codex',
    title: 'OpenAI Codex CLI',
    binaryName: 'codex',
    knownCommandCandidates: null,
    sourcePreferenceDefault: 'system-first',
    managedInstall: {
      kind: 'github_release_binary',
      githubRepo: 'openai/codex',
      binaryName: 'codex',
      assetNameByPlatform: {
        darwin: {
          arm64: 'codex-package-aarch64-apple-darwin.tar.gz',
          x64: 'codex-package-x86_64-apple-darwin.tar.gz',
        },
        linux: {
          arm64: 'codex-package-aarch64-unknown-linux-musl.tar.gz',
          x64: 'codex-package-x86_64-unknown-linux-musl.tar.gz',
        },
        win32: {
          arm64: 'codex-package-aarch64-pc-windows-msvc.tar.gz',
          x64: 'codex-package-x86_64-pc-windows-msvc.tar.gz',
        },
      },
      // OpenAI Codex rust-v0.147.0's canonical package layout. Keep this an
      // explicit runtime allowlist: package metadata, rg, and other bundled
      // files are not part of Happier's managed provider installation.
      archiveEntriesByPlatform: {
        darwin: [
          { archivePath: 'bin/codex', destinationPath: 'bin/codex' },
          { archivePath: 'bin/codex-code-mode-host', destinationPath: 'bin/codex-code-mode-host' },
        ],
        linux: [
          { archivePath: 'bin/codex', destinationPath: 'bin/codex' },
          { archivePath: 'bin/codex-code-mode-host', destinationPath: 'bin/codex-code-mode-host' },
        ],
        win32: [
          { archivePath: 'bin/codex.exe', destinationPath: 'bin/codex.exe' },
          { archivePath: 'bin/codex-code-mode-host.exe', destinationPath: 'bin/codex-code-mode-host.exe' },
          {
            archivePath: 'codex-resources/codex-command-runner.exe',
            destinationPath: 'codex-resources/codex-command-runner.exe',
          },
          {
            archivePath: 'codex-resources/codex-windows-sandbox-setup.exe',
            destinationPath: 'codex-resources/codex-windows-sandbox-setup.exe',
          },
        ],
      },
      // Digest-verified rust-v0.163.0 Windows x64 expands to 465,689,987 bytes;
      // its largest file is 341,270,320 bytes. Reuse the 0.3 Agent manifest's
      // 512 MiB total budget while retaining the existing per-file budget and
      // shared archive, entry-count, path and compression-ratio protections.
      archiveExtractionLimits: {
        maxFileBytes: 384 * 1024 * 1024,
        maxExpandedBytes: 512 * 1024 * 1024,
      },
    },
    manualInstallKind: 'command',
    manualInstallRecipes: null,
    acceptsJavaScriptFileOverride: false,
    installGuideUrl: null,
    docsUrl: 'https://github.com/openai/codex',
    npmPackageName: '@openai/codex',
    // openai/codex `codex-rs/cli/src/main.rs` declares the `update` subcommand; the standalone
    // installer (`scripts/install/install.sh`) keeps its payload in $CODEX_HOME/packages/standalone
    // (default ~/.codex). A custom CODEX_HOME is not attributed and stays a manual update.
    nativeUpdate: {
      args: ['update'],
      installPaths: ['.codex/packages/standalone'],
    },
  },
} as const;

export function getProviderCliRuntimeSpec(id: AgentId): ProviderCliRuntimeSpec {
  return PROVIDER_CLI_RUNTIME_SPECS[id];
}

export function resolveProviderCliNpmPackageName(spec: ProviderCliRuntimeSpec): string | null {
  if (spec.managedInstall?.kind === 'managed_package') return spec.managedInstall.packageName;
  return spec.npmPackageName ?? null;
}

/**
 * Where "latest" comes from: the source the managed install owner would install
 * from, else the vendor's npm package. `null` means no verified latest source.
 */
export function resolveProviderCliLatestVersionSource(spec: ProviderCliRuntimeSpec): ProviderCliLatestVersionSource | null {
  if (spec.managedInstall?.kind === 'github_release_binary') {
    return { kind: 'github_release', githubRepo: spec.managedInstall.githubRepo };
  }
  const packageName = resolveProviderCliNpmPackageName(spec);
  return packageName ? { kind: 'npm', packageName } : null;
}

export function getProviderCliBinaryNames(
  id: AgentId,
  processEnv: NodeJS.ProcessEnv = process.env,
): ReadonlyArray<string> {
  const runtimeSpec = getProviderCliRuntimeSpec(id);
  const fallbackEnabled = runtimeSpec.alternativeBinaryFallbackEnabledEnvVar
    ? parseBooleanEnv(processEnv[runtimeSpec.alternativeBinaryFallbackEnabledEnvVar], true)
    : true;
  return [
    runtimeSpec.binaryName,
    ...(fallbackEnabled ? (runtimeSpec.alternativeBinaryNames ?? []) : []),
  ];
}
