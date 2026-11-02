import { mapSaplingScmErrorCode, type ScmOperationErrorCode } from '@piggercode/protocol';

export function mapSaplingErrorCode(stderr: string): ScmOperationErrorCode {
    return mapSaplingScmErrorCode(stderr);
}
