import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { execa } from 'execa';
import fs from 'fs-extra';
import ora, { type Ora } from 'ora';
import {
  clearZipDirectory,
  getApkBuffer,
  injectDirectory,
  openApk,
  patchManifest,
} from '../utils/apk.js';
import { ensureKeystore, signApk } from '../utils/keystore.js';
import { loadOrCreateConfig, saveConfig } from '../utils/portlConfig.js';
import { getVersionInfo } from '../utils/versioning.js';

interface CliOptions {
  verbose?: boolean;
}

interface ProjectPackageJson {
  name?: string;
  version?: string;
  scripts?: {
    build?: string;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function buildCommand(options: CliOptions): Promise<void> {
  const cwd = process.cwd();
  let spinner: Ora | null = null;

  try {
    const packageJsonPath = path.join(cwd, 'package.json');
    if (!(await fs.pathExists(packageJsonPath))) {
      throw new Error('Run portl from your project root.');
    }

    const packageJson = (await fs.readJSON(packageJsonPath)) as ProjectPackageJson;
    const config = await loadOrCreateConfig(cwd);

    spinner = ora('Building web app...').start();
    await runWebBuild(cwd, packageJson);
    spinner.succeed('Web app build complete');

    const webDistDir = path.join(cwd, 'dist');
    await fs.remove(path.join(webDistDir, 'app.apk'));
    await fs.remove(path.join(webDistDir, 'app-dev.apk'));
    const usesPortlApi = await detectPortlUsage(webDistDir);
    // TODO: Use detection result to select minimal shell variant in V2.
    void usesPortlApi;

    spinner = ora('Packaging APK...').start();
    const versionInfo = getVersionInfo(packageJson, config);
    const assetsDir = path.resolve(__dirname, '../assets');
    const fullShellApkPath = path.join(assetsDir, 'portl-shell-full.apk');
    const zip = openApk(fullShellApkPath);
    clearZipDirectory(zip, 'assets/www/');
    injectDirectory(zip, webDistDir, 'assets/www/');
    patchManifest(zip, {
      packageName: config.packageName,
      appLabel: packageJson.name ?? 'portl-app',
      versionCode: versionInfo.versionCode,
      versionName: versionInfo.versionName,
    });
    spinner.succeed('Packaging complete');

    config.versionCode += 1;
    await saveConfig(cwd, config);

    spinner = ora('Signing APK...').start();
    const keystoreInfo = await ensureKeystore(path.join(cwd, '.portl'));
    const signedApk = await signApk(getApkBuffer(zip), keystoreInfo);
    const outputPath = path.join(cwd, 'dist', 'app.apk');
    await fs.writeFile(outputPath, signedApk);
    spinner.succeed('Signing complete');

    console.log(
      chalk.green(
        `✅ Build complete → ./dist/app.apk  (v${versionInfo.versionName}, build ${versionInfo.versionCode})`,
      ),
    );
    console.log('');
    console.log('First install:');
    console.log('  adb install ./dist/app.apk');
    console.log('');
    console.log('Update (preserves all app data):');
    console.log('  adb install -r ./dist/app.apk');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (spinner) {
      spinner.fail(message);
    }

    if (options.verbose && error instanceof Error) {
      console.error(chalk.red(error.stack ?? error.message));
    } else {
      console.error(chalk.red(message));
    }
    process.exitCode = 1;
  }
}

async function runWebBuild(cwd: string, packageJson: ProjectPackageJson): Promise<void> {
  try {
    if (packageJson.scripts?.build) {
      await execa('npm', ['run', 'build'], { cwd, stdio: 'pipe' });
      return;
    }

    const vitePath = path.join(cwd, 'node_modules', '.bin', 'vite');
    await execa(vitePath, ['build'], { cwd, stdio: 'pipe' });
  } catch (error) {
    if (isExecaError(error)) {
      if (error.stdout) {
        console.error(error.stdout);
      }
      if (error.stderr) {
        console.error(error.stderr);
      }
    }
    throw new Error('Web build failed. Fix the errors above and try again.');
  }
}

async function detectPortlUsage(distDir: string): Promise<boolean> {
  if (!(await fs.pathExists(distDir))) {
    throw new Error('Web build output directory not found: dist/');
  }

  const files = await listFilesRecursively(distDir);
  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    if (content.includes('window.AndroidBridge') || content.includes('portl')) {
      return true;
    }
  }

  return false;
}

async function listFilesRecursively(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursively(fullPath)));
      continue;
    }

    if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

function isExecaError(error: unknown): error is { stdout?: string; stderr?: string } {
  return typeof error === 'object' && error !== null;
}
