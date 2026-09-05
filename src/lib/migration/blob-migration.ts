import type { AtprotoClient } from "./atproto-client.ts";
import type { MigrationProgress } from "./types.ts";

export interface BlobMigrationResult {
  migrated: number;
  failed: string[];
  total: number;
  sourceUnreachable: boolean;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const safeProgress = (
  onProgress: (update: Partial<MigrationProgress>) => void,
  update: Partial<MigrationProgress>,
): void => {
  try {
    onProgress(update);
  } catch (e) {
    console.warn("[blob-migration] Progress callback failed:", e);
  }
};

interface MigrateBlobResult {
  cid: string;
  success: boolean;
  error?: string;
}

const migrateSingleBlob = async (
  cid: string,
  userDid: string,
  sourceClient: AtprotoClient,
  localClient: AtprotoClient,
  attempt = 0,
): Promise<MigrateBlobResult> => {
  try {
    console.log(
      `[blob-migration] Fetching blob ${cid} from source (attempt ${
        attempt + 1
      })`,
    );
    const { data: blobData, contentType } = await sourceClient
      .getBlobWithContentType(userDid, cid);
    console.log(
      `[blob-migration] Got blob ${cid}, size: ${blobData.byteLength}, type: ${contentType}`,
    );

    console.log(`[blob-migration] Uploading blob ${cid} to local PDS...`);
    const uploadResult = await localClient.uploadBlob(blobData, contentType);
    console.log(
      `[blob-migration] Upload response for ${cid}:`,
      JSON.stringify(uploadResult),
    );

    return { cid, success: true };
  } catch (e) {
    const errorMessage = (e as Error).message || String(e);
    console.error(
      `[blob-migration] Failed to migrate blob ${cid} (attempt ${
        attempt + 1
      }):`,
      errorMessage,
    );

    const isRetryable = attempt < MAX_RETRIES - 1 &&
      !errorMessage.includes("404") &&
      !errorMessage.includes("not found") &&
      !errorMessage.includes("BlobNotFound");

    if (isRetryable) {
      const delay = RETRY_DELAYS[attempt] ?? 4000;
      console.log(`[blob-migration] Retrying ${cid} in ${delay}ms...`);
      await sleep(delay);
      return migrateSingleBlob(
        cid,
        userDid,
        sourceClient,
        localClient,
        attempt + 1,
      );
    }

    return { cid, success: false, error: errorMessage };
  }
};

const collectMissingBlobs = async (
  localClient: AtprotoClient,
): Promise<string[]> => {
  const allBlobs: string[] = [];
  let cursor: string | undefined;

  do {
    const { blobs, cursor: nextCursor } = await localClient.listMissingBlobs(
      cursor,
      500,
    );
    console.log(
      `[blob-migration] listMissingBlobs returned ${blobs.length} blobs, cursor: ${nextCursor}`,
    );
    allBlobs.push(...blobs.map((blob) => blob.cid));
    cursor = nextCursor;
  } while (cursor);

  return allBlobs;
};

export async function migrateBlobs(
  localClient: AtprotoClient,
  sourceClient: AtprotoClient | null,
  userDid: string,
  onProgress: (update: Partial<MigrationProgress>) => void,
): Promise<BlobMigrationResult> {
  console.log("[blob-migration] Starting blob migration for", userDid);
  console.log(
    "[blob-migration] Source client:",
    sourceClient
      ? `available (baseUrl: ${sourceClient.getBaseUrl()})`
      : "NOT AVAILABLE",
  );
  console.log(
    "[blob-migration] Local client baseUrl:",
    localClient.getBaseUrl(),
  );
  console.log(
    "[blob-migration] Local client has access token:",
    localClient.getAccessToken() ? "yes" : "NO",
  );

  safeProgress(onProgress, {
    currentOperation: "Checking for missing blobs...",
  });

  const missingBlobs = await collectMissingBlobs(localClient);

  console.log("[blob-migration] Total missing blobs:", missingBlobs.length);
  safeProgress(onProgress, { blobsTotal: missingBlobs.length });

  if (missingBlobs.length === 0) {
    console.log("[blob-migration] No blobs to migrate");
    safeProgress(onProgress, { currentOperation: "No blobs to migrate" });
    return { migrated: 0, failed: [], total: 0, sourceUnreachable: false };
  }

  if (!sourceClient) {
    console.warn(
      "[blob-migration] No source client available, cannot fetch blobs",
    );
    safeProgress(onProgress, {
      currentOperation:
        `${missingBlobs.length} media files missing. No source PDS URL available - your old server may have shut down. Posts will work, but some images/media may be unavailable.`,
    });
    return {
      migrated: 0,
      failed: missingBlobs,
      total: missingBlobs.length,
      sourceUnreachable: true,
    };
  }

  safeProgress(onProgress, {
    currentOperation: `Migrating ${missingBlobs.length} blobs...`,
  });

  const results = await missingBlobs.reduce<
    Promise<{ migrated: number; failed: string[] }>
  >(
    async (accPromise, cid, index) => {
      const acc = await accPromise;

      safeProgress(onProgress, {
        currentOperation: `Migrating blob ${
          index + 1
        }/${missingBlobs.length}...`,
        blobsMigrated: acc.migrated,
      });

      const result = await migrateSingleBlob(
        cid,
        userDid,
        sourceClient,
        localClient,
      );

      return result.success
        ? { migrated: acc.migrated + 1, failed: acc.failed }
        : { migrated: acc.migrated, failed: [...acc.failed, cid] };
    },
    Promise.resolve({ migrated: 0, failed: [] as string[] }),
  );

  const { migrated, failed } = results;

  safeProgress(onProgress, { blobsMigrated: migrated });

  const statusMessage = migrated === missingBlobs.length
    ? `All ${migrated} blobs migrated successfully`
    : migrated > 0
    ? `${migrated}/${missingBlobs.length} blobs migrated. ${failed.length} failed.`
    : `Could not migrate blobs (${failed.length} missing)`;

  safeProgress(onProgress, { currentOperation: statusMessage });

  console.log(
    `[blob-migration] Complete: ${migrated} migrated, ${failed.length} failed`,
  );
  failed.length > 0 && console.log("[blob-migration] Failed CIDs:", failed);

  return {
    migrated,
    failed,
    total: missingBlobs.length,
    sourceUnreachable: false,
  };
}
