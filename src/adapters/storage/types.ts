export interface StorageUploadInput {
  bytes: Buffer;
  mimeType: string;
  path: string;
  isPrivate?: boolean;
}

export interface StorageUploadResult {
  provider: string;
  internalRef: string;
  publicUrl?: string;
}

export interface MediaStorageAdapter {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
}
