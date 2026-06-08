import path from 'node:path';
import chalk from 'chalk';
import fs from 'fs-extra';
import ora, { type Ora } from 'ora';
import { DEFAULT_BUILDER_IMAGE } from '../utils/builderConfig.js';
import { bundleDrizzleMigrations } from '../utils/drizzleMigrations.js';
import { getLocalIP } from '../utils/network.js';
import { loadOrCreateConfig } from '../utils/portlConfig.js';
import { getVersionInfo } from '../utils/versioning.js';
import {
  ensureDockerReady,
  prepareBuilderInput,
  pullBuilderImage,
  resolveKeystorePath,
  runBuilderContainer,
  type ProjectPackageJson,
} from './build.js';

interface CliOptions {
  verbose?: boolean;
  builderImage?: string;
  noPull?: boolean;
  pull?: boolean;
  webviewDebug?: boolean;
}

const DEV_WEB_DIST_DIR = path.join('.portl', 'dev-dist');

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
    const builderImage = options.builderImage?.trim() || DEFAULT_BUILDER_IMAGE;
    const localIP = getLocalIP();
    const devUrl = `http://${localIP}:5173`;
    const versionInfo = getVersionInfo(packageJson, config);

    spinner = ora('Checking Docker...').start();
    await ensureDockerReady();
    spinner.succeed('Docker is available');

    spinner = ora('Bundling Drizzle migrations...').start();
    const drizzleBundle = await bundleDrizzleMigrations(cwd);
    if (drizzleBundle.status === 'skipped') {
      spinner.succeed('No Drizzle migrations to bundle');
    } else {
      spinner.succeed(`Drizzle migrations ${drizzleBundle.status}`);
    }

    const webDistDir = await prepareDevWebDist(cwd);
    const keystorePath = await resolveKeystorePath(cwd, config);
    const io = await prepareBuilderInput({
      cwd,
      webDistDir,
      packageName: config.packageName,
      appLabel: packageJson.name ?? 'portl-app',
      versionCode: versionInfo.versionCode,
      versionName: versionInfo.versionName,
      webViewDebug: options.webviewDebug !== false,
      devUrl,
      keystorePath,
    });

    if (options.pull !== false) {
      spinner = ora(`Pulling builder image (${builderImage})...`).start();
      await pullBuilderImage(builderImage);
      spinner.succeed('Builder image ready');
    }

    spinner = ora('Building dev APK in container...').start();
    await runBuilderContainer(builderImage, io);
    spinner.succeed('Container build complete');

    const builtApkPath = path.join(io.outputDir, 'app.apk');
    if (!(await fs.pathExists(builtApkPath))) {
      throw new Error('Builder container did not produce app.apk');
    }

    const outputPath = path.join(cwd, 'dist', 'app-dev.apk');
    await fs.ensureDir(path.dirname(outputPath));
    await fs.copyFile(builtApkPath, outputPath);

    console.log(chalk.green('✅ Dev APK → ./dist/app-dev.apk'));
    console.log('');
    console.log('Install once on your Android device:');
    console.log('  adb install ./dist/app-dev.apk');
    console.log('');
    console.log('Then start developing:');
    console.log('  npx portl dev');
    console.log('');
    console.log(`Your app will load ${devUrl} and live-reload. Keep your phone on the same WiFi.`);
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

async function prepareDevWebDist(cwd: string): Promise<string> {
  const webDistDir = path.join(cwd, DEV_WEB_DIST_DIR);
  await fs.emptyDir(webDistDir);
  await fs.writeFile(
    path.join(webDistDir, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><title>Portl Dev</title></head><body></body></html>\n',
    'utf8',
  );
  return webDistDir;
}
