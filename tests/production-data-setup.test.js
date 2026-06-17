const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const envExample = read('.env.example');
const packageJson = JSON.parse(read('package.json'));
const envConfig = read('src/config/env.ts');
const storageIndex = read('src/adapters/storage/index.ts');
const s3Adapter = read('src/adapters/storage/s3CompatibleAdapter.ts');
const cloudReadinessScript = read('scripts/check-cloud-readiness.js');
const backupScript = read('scripts/run-production-data-backup.js');
const verifyStorageScript = read('scripts/verify-cloud-storage.js');
const objectStorageService = read('services/s3ObjectStorageService.js');
const aiFoundationExportService = read('services/aiFoundationExportService.js');
const adminRoute = read('routes/admin.js');
const setupDoc = read('docs/production-data-setup.md');

assert(
  envExample.includes('# local | supabase | s3_presigned | s3')
    && envExample.includes('S3_ENDPOINT=')
    && envExample.includes('S3_REGION=auto')
    && envExample.includes('S3_BUCKET=makaug-prod-media')
    && envExample.includes('DATA_BACKUP_BUCKET=makaug-db-backups')
    && envExample.includes('AI_EXPORT_BUCKET=makaug-admin-exports')
    && envExample.includes('REQUIRE_CLOUD_AI_EXPORTS=true'),
  'env example must document direct S3/R2 media, backup storage, and cloud AI exports'
);

assert(
  envConfig.includes("'s3_presigned' | 's3'")
    && envConfig.includes('s3Endpoint')
    && envConfig.includes('s3PublicBaseUrl'),
  'typed env config must expose the direct S3 provider and public base URL'
);

assert(
  storageIndex.includes("import { S3CompatibleAdapter } from './s3CompatibleAdapter'")
    && storageIndex.includes("if (env.mediaStorageProvider === 's3') return new S3CompatibleAdapter()"),
  'storage adapter factory must route MEDIA_STORAGE_PROVIDER=s3 to the direct S3 adapter'
);

assert(
  s3Adapter.includes('AWS4-HMAC-SHA256')
    && s3Adapter.includes('x-amz-content-sha256')
    && s3Adapter.includes("provider: 's3'")
    && s3Adapter.includes('S3 storage env vars are missing'),
  'direct S3 adapter must sign and upload objects without a presign side service'
);

assert(
  adminRoute.includes('media_storage')
    && adminRoute.includes('durableCloudConfigured')
    && adminRoute.includes('MEDIA_STORAGE_PROVIDER=s3')
    && adminRoute.includes('backupStorage')
    && adminRoute.includes("provider_test_backups")
    && adminRoute.includes("router.post('/setup-status/provider-test'"),
  'admin setup status must expose durable cloud media and backup storage readiness'
);

assert.strictEqual(
  packageJson.scripts['data:backup'],
  'node scripts/run-production-data-backup.js',
  'package.json must expose npm run data:backup'
);

assert.strictEqual(
  packageJson.scripts['cloud:verify-storage'],
  'node scripts/verify-cloud-storage.js',
  'package.json must expose npm run cloud:verify-storage'
);

assert(
  objectStorageService.includes('AWS4-HMAC-SHA256')
    && objectStorageService.includes('uploadBufferToS3')
    && objectStorageService.includes('internalRef: `s3://${bucket}/${objectKey}`'),
  'shared object storage service must upload buffers and return s3 refs'
);

assert(
  verifyStorageScript.includes('DATA_BACKUP_BUCKET')
    && verifyStorageScript.includes('S3_BUCKET')
    && verifyStorageScript.includes('backup_canary')
    && verifyStorageScript.includes('uploadBufferToS3'),
  'cloud storage verification script must write media and backup canaries'
);

assert(
  cloudReadinessScript.includes('REQUIRE_CLOUD_AI_EXPORTS')
    && cloudReadinessScript.includes('AI_EXPORT_BUCKET')
    && cloudReadinessScript.includes('DATA_BACKUP_BUCKET')
    && cloudReadinessScript.includes('S3_BUCKET')
    && cloudReadinessScript.includes('Missing AI export bucket')
    && cloudReadinessScript.includes('AI learning exports are configured to write to S3/R2'),
  'cloud readiness must check AI export cloud storage configuration with bucket fallback support'
);

assert(
  backupScript.includes("process.env.PG_DUMP_BIN || 'pg_dump'")
    && backupScript.includes("run('tar'")
    && backupScript.includes('DATA_BACKUP_LOCAL_PATHS')
    && backupScript.includes('manifest')
    && backupScript.includes('DATA_BACKUP_BUCKET'),
  'backup script must dump Postgres, archive local data, and upload a manifest'
);

assert(
  aiFoundationExportService.includes('AI_EXPORT_BUCKET')
    && aiFoundationExportService.includes('REQUIRE_CLOUD_AI_EXPORTS')
    && aiFoundationExportService.includes('cloud.jsonl')
    && aiFoundationExportService.includes('primaryOutputPath = cloud.jsonl?.internalRef || jsonlPath'),
  'AI foundation exports must upload training artifacts to cloud storage when configured'
);

assert(
  setupDoc.includes('makaug-prod-media')
    && setupDoc.includes('makaug-private-evidence')
    && setupDoc.includes('makaug-db-backups')
    && setupDoc.includes('npm run data:backup')
    && setupDoc.includes('npm run cloud:verify-storage')
    && setupDoc.includes('s3://')
    && setupDoc.includes('Restore Drill')
    && setupDoc.includes('The app server should never be the long-term home'),
  'production data setup doc must cover buckets, backup command, restore drill, and server disk rule'
);

console.log('production data setup surface ok');
