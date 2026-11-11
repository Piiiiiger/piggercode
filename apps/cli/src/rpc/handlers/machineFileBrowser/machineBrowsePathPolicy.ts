import { realpath } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

import type { MachineFileBrowserRoot } from '@piggercode/protocol'

type MachineBrowsePathValidationResult =
  | Readonly<{ valid: true; resolvedPath: string }>
  | Readonly<{ valid: false; error: string }>

type ValidateMachineBrowsePathInput = Readonly<{
  targetPath: string
  roots: readonly MachineFileBrowserRoot[]
  platform?: NodeJS.Platform
}>

async function isWithinRoot(rootPath: string, targetPath: string, platform: NodeJS.Platform): Promise<boolean> {
  if (platform === 'win32') {
    const normalizedRoot = await resolvePathForComparison(rootPath, platform)
    const normalizedTarget = await resolvePathForComparison(targetPath, platform)
    const relativePath = win32.relative(normalizedRoot.toLowerCase(), normalizedTarget.toLowerCase())
    return relativePath === '' || (!relativePath.startsWith('..\\') && relativePath !== '..' && !win32.isAbsolute(relativePath))
  }

  const normalizedRoot = await resolvePathForComparison(rootPath, platform)
  const normalizedTarget = await resolvePathForComparison(targetPath, platform)
  const relativePath = posix.relative(normalizedRoot, normalizedTarget)
  return relativePath === '' || (!relativePath.startsWith('../') && relativePath !== '..' && !posix.isAbsolute(relativePath))
}

async function resolvePathForComparison(path: string, platform: NodeJS.Platform): Promise<string> {
  const resolved = platform === 'win32' ? win32.resolve(path) : posix.resolve(path)
  if (platform !== process.platform) {
    return resolved
  }
  try {
    return await realpath(resolved)
  } catch {
    return resolved
  }
}

export async function validateMachineBrowsePath(
  input: ValidateMachineBrowsePathInput,
): Promise<MachineBrowsePathValidationResult> {
  const platform = input.platform ?? process.platform
  const rawPath = String(input.targetPath ?? '').trim()
  if (!rawPath) {
    return { valid: false, error: 'Path is required' }
  }
  if (platform === 'win32' ? !win32.isAbsolute(rawPath) : !posix.isAbsolute(rawPath)) {
    return { valid: false, error: 'Path must be absolute' }
  }

  const resolvedPath = await resolvePathForComparison(rawPath, platform)
  const allowed = (await Promise.all(input.roots.map((root) => isWithinRoot(root.path, resolvedPath, platform))))
    .some(Boolean)
  if (!allowed) {
    return { valid: false, error: 'Path is outside the allowed machine browse roots' }
  }

  return { valid: true, resolvedPath }
}
