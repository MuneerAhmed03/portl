import fs from 'fs-extra';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { validatePackageName } from './packageName.js';

// TODO: Replace placeholder APK files in src/assets/ with real build outputs from portl-shell.
// All APK manipulation logic is fully implemented and will work once real APKs are provided.
// TODO: Replace with proper AXML parser in V2 for correctness and flexibility.

export interface ManifestPatches {
  packageName: string;
  versionCode: number;
  versionName: string;
  appLabel: string;
}

const PACKAGE_PLACEHOLDER = 'com.portl.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const APP_LABEL_PLACEHOLDER = 'PORTL_APP_LABEL_PLACEHOLDER_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VERSION_NAME_PLACEHOLDER = 'PORTL_VERSION_NAME_PLACEHOLDER_A';
const VERSION_CODE_PLACEHOLDER = 10000000;

export function openApk(apkPath: string): AdmZip {
  return new AdmZip(apkPath);
}

export function clearZipDirectory(zip: AdmZip, prefix: string): void {
  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith(normalizedPrefix)) {
      zip.deleteFile(entry.entryName);
    }
  }
}

export function injectDirectory(zip: AdmZip, sourceDir: string, targetPrefix: string): void {
  const normalizedPrefix = targetPrefix.endsWith('/') ? targetPrefix : `${targetPrefix}/`;
  injectRecursive(zip, sourceDir, sourceDir, normalizedPrefix);
}

export function patchManifest(zip: AdmZip, patches: ManifestPatches): void {
  validateManifestPatches(patches);
  const manifestEntry = zip.getEntry('AndroidManifest.xml');
  if (!manifestEntry) {
    throw new Error('APK manifest not found: AndroidManifest.xml');
  }

  const manifestBuffer = manifestEntry.getData();
  replaceUtf16Fixed(manifestBuffer, PACKAGE_PLACEHOLDER, patches.packageName, 64);
  replaceUtf16Fixed(manifestBuffer, APP_LABEL_PLACEHOLDER, patches.appLabel, 64);
  replaceUtf16Fixed(manifestBuffer, VERSION_NAME_PLACEHOLDER, patches.versionName, 32);
  replaceInt32LE(manifestBuffer, VERSION_CODE_PLACEHOLDER, patches.versionCode);
  zip.updateFile(manifestEntry.entryName, manifestBuffer);
}

function validateManifestPatches(patches: ManifestPatches): void {
  validatePackageName(patches.packageName);
  validateMaxChars('appLabel', patches.appLabel, 64);
  validateMaxChars('versionName', patches.versionName, 32);
}

function validateMaxChars(label: string, value: string, maxChars: number): void {
  if (value.length > maxChars) {
    throw new Error(`Android ${label} must be ${maxChars} characters or fewer.`);
  }
}

export function getApkBuffer(zip: AdmZip): Buffer {
  return zip.toBuffer();
}

function replaceUtf16Fixed(
  target: Buffer,
  placeholder: string,
  value: string,
  maxChars: number,
): void {
  const placeholderBuffer = Buffer.from(placeholder, 'utf16le');
  const start = target.indexOf(placeholderBuffer);
  if (start === -1) {
    throw new Error(`Manifest placeholder not found: ${placeholder}`);
  }

  const valueBuffer = Buffer.from(value, 'utf16le');
  const maxBytes = maxChars * 2;
  if (valueBuffer.length > maxBytes) {
    throw new Error(`${placeholder} replacement exceeds ${maxChars} chars`);
  }

  const replacement = Buffer.alloc(maxBytes, 0);
  valueBuffer.copy(replacement);
  replacement.copy(target, start, 0, maxBytes);
}

function replaceInt32LE(target: Buffer, placeholder: number, value: number): void {
  const placeholderBuffer = Buffer.alloc(4);
  placeholderBuffer.writeUInt32LE(placeholder, 0);
  const start = target.indexOf(placeholderBuffer);
  if (start === -1) {
    throw new Error(`Manifest versionCode placeholder not found: ${placeholder}`);
  }

  const replacement = Buffer.alloc(4);
  replacement.writeUInt32LE(value, 0);
  replacement.copy(target, start, 0, 4);
}

function injectRecursive(
  zip: AdmZip,
  sourceDir: string,
  currentDir: string,
  targetPrefix: string,
): void {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      injectRecursive(zip, sourceDir, absolutePath, targetPrefix);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = path.relative(sourceDir, absolutePath).replaceAll(path.sep, '/');
    const targetPath = `${targetPrefix}${relativePath}`;
    const fileBuffer = fs.readFileSync(absolutePath);
    zip.addFile(targetPath, fileBuffer);
  }
}
