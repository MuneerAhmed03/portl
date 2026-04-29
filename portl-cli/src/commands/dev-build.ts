import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import fs from 'fs-extra';
import ora, { type Ora } from 'ora';
import { getApkBuffer, openApk, patchManifest } from '../utils/apk.js';
import { ensureKeystore, signApk } from '../utils/keystore.js';
import { getLocalIP } from '../utils/network.js';
import { loadOrCreateConfig } from '../utils/portlConfig.js';
import { getVersionInfo } from '../utils/versioning.js';

interface CliOptions {
  verbose?: boolean;
}

interface ProjectPackageJson {
  name?: string;
  version?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function devBuildCommand(options: CliOptions): Promise<void> {
  const cwd = process.cwd();
  let spinner: Ora | null = null;

  try {
    const packageJsonPath = path.join(cwd, 'package.json');
    if (!(await fs.pathExists(packageJsonPath))) {
      throw new Error('Run portl from your project root.');
    }

    const packageJson = (await fs.readJSON(packageJsonPath)) as ProjectPackageJson;
    const config = await loadOrCreateConfig(cwd);
    const localIP = getLocalIP();
    const devUrl = `http://${localIP}:5173`;
    const versionInfo = getVersionInfo(packageJson, config);

    spinner = ora('Packaging APK...').start();
    const assetsDir = path.resolve(__dirname, '../assets');
    const devShellApkPath = path.join(assetsDir, 'portl-shell-dev.apk');
    const zip = openApk(devShellApkPath);
    zip.addFile(
      'assets/www/portl-config.json',
      Buffer.from(JSON.stringify({ devUrl }), 'utf8'),
    );
    patchManifest(zip, {
      packageName: config.packageName,
      appLabel: packageJson.name ?? 'portl-app',
      versionCode: versionInfo.versionCode,
      versionName: versionInfo.versionName,
    });
    spinner.succeed('Packaging complete');

    spinner = ora('Signing APK...').start();
    const keystoreInfo = await ensureKeystore(path.join(cwd, '.portl'));
    const signedApk = await signApk(getApkBuffer(zip), keystoreInfo);
    const outputPath = path.join(cwd, 'dist', 'app-dev.apk');
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, signedApk);
    spinner.succeed('Signing complete');

    console.log(chalk.green('✅ Dev APK → ./dist/app-dev.apk'));
    console.log('');
    console.log('Install once on your Android device:');
    console.log('  adb install ./dist/app-dev.apk');
    console.log('');
    console.log('Then start developing:');
    console.log('  npx portl dev');
    console.log('');
    console.log('Your app will live-reload. Keep your phone on the same WiFi.');
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
