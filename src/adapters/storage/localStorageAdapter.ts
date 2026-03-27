import type { MediaStorageAdapter, StorageUploadInput, StorageUploadResult } from './types';

export class LocalStorageAdapter implements MediaStorageAdapter {
  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    return {
      provider: 'local',
      internalRef: `local://${input.path}`
    };
  }
}
