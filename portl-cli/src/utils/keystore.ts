import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import fs from 'fs-extra';
import forge from 'node-forge';

export interface KeystoreInfo {
  privateKey: forge.pki.rsa.PrivateKey;
  certificate: forge.pki.Certificate;
}

export interface KeystoreSigningConfig {
  alias: string;
  storePassword: string;
  keyPassword: string;
}

export const DEFAULT_KEYSTORE_PASSWORD = '';
export const DEFAULT_KEYSTORE_ALIAS = 'portl';
const KEYSTORE_PASSWORD = DEFAULT_KEYSTORE_PASSWORD;
const KEYSTORE_ALIAS = DEFAULT_KEYSTORE_ALIAS;

export function getDefaultKeystoreSigningConfig(): KeystoreSigningConfig {
  return {
    alias: KEYSTORE_ALIAS,
    storePassword: KEYSTORE_PASSWORD,
    keyPassword: KEYSTORE_PASSWORD,
  };
}

export async function ensureKeystore(portlDir: string): Promise<KeystoreInfo> {
  const keystorePath = path.join(portlDir, 'keystore', 'release.p12');
  if (await fs.pathExists(keystorePath)) {
    const keystoreBuffer = await fs.readFile(keystorePath);
    return parseKeystore(keystoreBuffer);
  }

  await fs.ensureDir(path.dirname(keystorePath));
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `${Date.now()}`;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 25 * 365 * 24 * 60 * 60 * 1000);

  const attributes = [
    { name: 'commonName', value: 'Portl App' },
    { name: 'organizationName', value: 'Portl' },
    { shortName: 'C', value: 'US' },
  ];
  cert.setSubject(attributes);
  cert.setIssuer(attributes);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [cert],
    KEYSTORE_PASSWORD,
    { friendlyName: KEYSTORE_ALIAS },
  );
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  await fs.writeFile(keystorePath, Buffer.from(p12Der, 'binary'));

  console.log('🔑 Keystore created → .portl/keystore/release.p12');
  console.log('⚠️  Back this file up. Losing it means you cannot update your app on devices.');

  return { privateKey: keys.privateKey, certificate: cert };
}

export async function signApk(apkBuffer: Buffer, keystoreInfo: KeystoreInfo): Promise<Buffer> {
  const zip = new AdmZip(apkBuffer);
  clearExistingMetaInf(zip);

  const fileDigests: Array<{ name: string; digest: string }> = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) {
      continue;
    }
    const name = entry.entryName;
    if (name.startsWith('META-INF/')) {
      continue;
    }
    const digest = crypto.createHash('sha256').update(entry.getData()).digest('base64');
    fileDigests.push({ name, digest });
  }

  fileDigests.sort((a, b) => a.name.localeCompare(b.name));
  const manifest = buildManifest(fileDigests);
  const signatureFile = buildSignatureFile(manifest);
  const signatureBlock = createPkcs7Signature(signatureFile, keystoreInfo);

  zip.addFile('META-INF/MANIFEST.MF', Buffer.from(manifest, 'utf8'));
  zip.addFile('META-INF/PORTL.SF', Buffer.from(signatureFile, 'utf8'));
  zip.addFile('META-INF/PORTL.RSA', signatureBlock);

  // TODO: Add APK Signature Scheme v2/v3 for Android 11+ optimization. V1 is sufficient for sideloading.
  return zip.toBuffer();
}

function parseKeystore(keystoreBuffer: Buffer): KeystoreInfo {
  const p12Der = forge.util.createBuffer(keystoreBuffer.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, KEYSTORE_PASSWORD);

  const keyBags = p12.getBags({
    bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
    friendlyName: KEYSTORE_ALIAS,
  })[forge.pki.oids.pkcs8ShroudedKeyBag];
  const certBags = p12.getBags({
    bagType: forge.pki.oids.certBag,
    friendlyName: KEYSTORE_ALIAS,
  })[forge.pki.oids.certBag];

  const privateKey = keyBags?.[0]?.key;
  const certificate = certBags?.[0]?.cert;
  if (!privateKey || !certificate) {
    throw new Error('Invalid keystore: missing key or certificate');
  }
  return { privateKey, certificate };
}

function clearExistingMetaInf(zip: AdmZip): void {
  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    if (
      name.startsWith('META-INF/') &&
      (name.endsWith('.SF') ||
        name.endsWith('.RSA') ||
        name.endsWith('.DSA') ||
        name.endsWith('MANIFEST.MF'))
    ) {
      zip.deleteFile(name);
    }
  }
}

function buildManifest(fileDigests: Array<{ name: string; digest: string }>): string {
  const header = 'Manifest-Version: 1.0\r\nCreated-By: Portl CLI\r\n\r\n';
  const sections = fileDigests
    .map((file) => `Name: ${file.name}\r\nSHA-256-Digest: ${file.digest}\r\n\r\n`)
    .join('');
  return `${header}${sections}`;
}

function buildSignatureFile(manifest: string): string {
  const manifestDigest = crypto
    .createHash('sha256')
    .update(Buffer.from(manifest, 'utf8'))
    .digest('base64');
  return [
    'Signature-Version: 1.0',
    'Created-By: Portl CLI',
    `SHA-256-Digest-Manifest: ${manifestDigest}`,
    '',
    '',
  ].join('\r\n');
}

function createPkcs7Signature(signatureFile: string, keystoreInfo: KeystoreInfo): Buffer {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(signatureFile, 'utf8');
  p7.addCertificate(keystoreInfo.certificate);
  p7.addSigner({
    key: keystoreInfo.privateKey,
    certificate: keystoreInfo.certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });

  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, 'binary');
}
