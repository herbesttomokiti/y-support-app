import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";
import fs from "fs";
import path from "path";

// ── ローカルストレージ（R2未設定時のフォールバック）─────────────────────────

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function isR2Configured(): boolean {
  return !!(ENV.r2AccountId && ENV.r2AccessKeyId && ENV.r2SecretAccessKey && ENV.r2Bucket);
}

// ── R2クライアント ─────────────────────────────────────────────────────────

function getR2Client() {
  if (!isR2Configured()) {
    throw new Error(
      "Storage config missing: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET",
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${ENV.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: ENV.r2AccessKeyId,
      secretAccessKey: ENV.r2SecretAccessKey,
    },
  });
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

// ── パブリックAPI ──────────────────────────────────────────────────────────

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);

  if (!isR2Configured()) {
    // ローカルディスクに保存
    ensureUploadsDir();
    const filePath = path.join(UPLOADS_DIR, key.replace(/\//g, "_"));
    fs.writeFileSync(filePath, body);
    const fileName = path.basename(filePath);
    return { key, url: `/uploads/${fileName}` };
  }

  // R2に保存
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: ENV.r2Bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  return { key, url: `/storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  if (!isR2Configured()) {
    // ローカルの場合はそのままパスを返す
    const key = normalizeKey(relKey);
    const fileName = key.replace(/\//g, "_");
    return `/uploads/${fileName}`;
  }

  if (ENV.r2PublicUrl) {
    const key = normalizeKey(relKey);
    return `${ENV.r2PublicUrl.replace(/\/$/, "")}/${key}`;
  }

  const client = getR2Client();
  const key = normalizeKey(relKey);
  const command = new GetObjectCommand({ Bucket: ENV.r2Bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}
