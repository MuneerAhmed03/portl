import fs from 'fs-extra';
import path from 'node:path';
import { derivePackageName, validatePackageName } from './packageName.js';

export interface PortlConfig {
  packageName: string;
  versionCode: number;
  keystorePath: string;
}

interface ProjectPackageJson {
  name?: string;
}

const PORTL_DIR = '.portl';
const CONFIG_RELATIVE_PATH = path.join(PORTL_DIR, 'config.json');
const KEYSTORE_RELATIVE_PATH = path.join(PORTL_DIR, 'keystore', 'release.p12');

export function getConfigPath(cwd: string): string {
  return path.join(cwd, CONFIG_RELATIVE_PATH);
}

export async function loadOrCreateConfig(cwd: string): Promise<PortlConfig> {
  const configPath = getConfigPath(cwd);
  if (await fs.pathExists(configPath)) {
    const config = (await fs.readJSON(configPath)) as PortlConfig;
    validatePackageName(config.packageName);
    return config;
  }

  const packageJsonPath = path.join(cwd, 'package.json');
  if (!(await fs.pathExists(packageJsonPath))) {
    throw new Error('No package.json found. Run portl from your project root.');
  }

  const packageJson = (await fs.readJSON(packageJsonPath)) as ProjectPackageJson;
  const packageName = derivePackageName(packageJson.name ?? '');
  const config: PortlConfig = {
    packageName,
    versionCode: 1,
    keystorePath: KEYSTORE_RELATIVE_PATH.replaceAll('\\', '/'),
  };
  validatePackageName(config.packageName);

  await fs.ensureDir(path.join(cwd, PORTL_DIR));
  await saveConfig(cwd, config);
  await ensureKeystoreInGitignore(cwd);
  console.log('✨ Portl initialized → .portl/config.json');
  return config;
}

export async function saveConfig(cwd: string, config: PortlConfig): Promise<void> {
  const configPath = getConfigPath(cwd);
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeJSON(configPath, config, { spaces: 2 });
}

async function ensureKeystoreInGitignore(cwd: string): Promise<void> {
  const gitignorePath = path.join(cwd, '.gitignore');
  const entry = '.portl/keystore/';

  if (!(await fs.pathExists(gitignorePath))) {
    await fs.writeFile(gitignorePath, `${entry}\n`, 'utf8');
    return;
  }

  const current = await fs.readFile(gitignorePath, 'utf8');
  const lines = current.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(entry)) {
    return;
  }

  const separator = current.endsWith('\n') || current.length === 0 ? '' : '\n';
  await fs.appendFile(gitignorePath, `${separator}${entry}\n`, 'utf8');
}
