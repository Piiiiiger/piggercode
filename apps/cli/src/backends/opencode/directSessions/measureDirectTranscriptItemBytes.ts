import type { DirectTranscriptRawMessageV1 } from '@piggercode/protocol';

export function measureDirectTranscriptItemBytes(item: DirectTranscriptRawMessageV1): number {
  return Buffer.byteLength(JSON.stringify(item), 'utf8');
}
