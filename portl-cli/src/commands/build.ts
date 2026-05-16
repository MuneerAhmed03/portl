import path from 'node:path';
import chalk from 'chalk';
import { execa } from 'execa';
import fs from 'fs-extra';
import ora, { type Ora } from 'ora';
import {
  BUILDER_INPUT_CONTAINER_DIR,
  BUILDER_METADATA_FILE,
  BUILDER_OUTPUT_CONTAINER_DIR,
  DEFAULT_BUILDER_IMAGE,
} from '../utils/builderConfig.js';
import { bundleDrizzleMigrations } from '../utils/drizzleMigrations.js';
import { ensureKeystore, getDefaultKeystoreSigningConfig } from '../utils/keystore.js';
import { loadOrCreateConfig, saveConfig, type PortlConfig } from '../utils/portlConfig.js';
import { getVersionInfo } from '../utils/versioning.js';

interface CliOptions {
  verbose?: boolean;
  builderImage?: string;
  noPull?: boolean;
  pull?: boolean;
}

interface ProjectPackageJson {
  name?: string;
  version?: string;
  scripts?: {
    build?: string;
  };
}

interface BuilderMetadata {
  packageName: string;
  appLabel: string;
  versionCode: number;
  versionName: string;
  keystore: {
    path: string;
    alias: string;
    storePassword: string;
    keyPassword: string;
  };
}

interface BuilderIO {
  inputDir: string;
  outputDir: string;
}

const CONTAINER_BUILD_DIR = path.join('.portl', 'container-build');
const DEFAULT_KEYSTORE_RELATIVE_PATH = path.join('.portl', 'keystore', 'release.p12').replaceAll('\\', '/');

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
    const builderImage = options.builderImage?.trim() || DEFAULT_BUILDER_IMAGE;

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

    spinner = ora('Building web app...').start();
    await runWebBuild(cwd, packageJson);
    spinner.succeed('Web app build complete');

    const webDistDir = path.join(cwd, 'dist');
    await fs.remove(path.join(webDistDir, 'app.apk'));
    await fs.remove(path.join(webDistDir, 'app-dev.apk'));

    const versionInfo = getVersionInfo(packageJson, config);
    const keystorePath = await resolveKeystorePath(cwd, config);
    const io = await prepareBuilderInput({
      cwd,
      webDistDir,
      packageName: config.packageName,
      appLabel: packageJson.name ?? 'portl-app',
      versionCode: versionInfo.versionCode,
      versionName: versionInfo.versionName,
      keystorePath,
    });

    if (options.pull !== false) {
      spinner = ora(`Pulling builder image (${builderImage})...`).start();
      await pullBuilderImage(builderImage);
      spinner.succeed('Builder image ready');
    }

    spinner = ora('Building APK in container...').start();
    await runBuilderContainer(builderImage, io);
    spinner.succeed('Container build complete');

    const builtApkPath = path.join(io.outputDir, 'app.apk');
    if (!(await fs.pathExists(builtApkPath))) {
      throw new Error('Builder container did not produce app.apk');
    }

    await fs.copyFile(builtApkPath, path.join(webDistDir, 'app.apk'));

    config.versionCode += 1;
    await saveConfig(cwd, config);

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

async function ensureDockerReady(): Promise<void> {
  try {
    await execa('docker', ['--version'], { stdio: 'pipe' });
  } catch {
    throw new Error(
      'Docker is required for portl build. Install Docker Desktop/Engine and ensure "docker" is available in PATH.',
    );
  }

  try {
    await execa('docker', ['info'], { stdio: 'pipe' });
  } catch {
    throw new Error('Docker daemon is not reachable. Start Docker and try again.');
  }
}

async function pullBuilderImage(image: string): Promise<void> {
  try {
    await execa('docker', ['pull', image], { stdio: 'pipe' });
  } catch (error) {
    if (isExecaError(error)) {
      if (error.stdout) {
        console.error(error.stdout);
      }
      if (error.stderr) {
        console.error(error.stderr);
      }
    }
    throw new Error(`Failed to pull builder image: ${image}`);
  }
}

async function runBuilderContainer(image: string, io: BuilderIO): Promise<void> {
  const dockerArgs = [
    'run',
    '--rm',
    '--volume',
    `${io.inputDir}:${BUILDER_INPUT_CONTAINER_DIR}:ro`,
    '--volume',
    `${io.outputDir}:${BUILDER_OUTPUT_CONTAINER_DIR}`,
  ];

  dockerArgs.push(image);

  try {
    await execa('docker', dockerArgs, { stdio: 'pipe' });
  } catch (error) {
    if (isExecaError(error)) {
      if (error.stdout) {
        console.error(error.stdout);
      }
      if (error.stderr) {
        console.error(error.stderr);
      }
    }
    throw new Error('Container APK build failed. See logs above.');
  }
}

async function prepareBuilderInput(params: {
  cwd: string;
  webDistDir: string;
  packageName: string;
  appLabel: string;
  versionCode: number;
  versionName: string;
  keystorePath: string;
}): Promise<BuilderIO> {
  const rootDir = path.join(params.cwd, CONTAINER_BUILD_DIR);
  const inputDir = path.join(rootDir, 'input');
  const outputDir = path.join(rootDir, 'output');
  const inputDistDir = path.join(inputDir, 'dist');
  const inputKeystoreDir = path.join(inputDir, 'keystore');

  await fs.remove(rootDir);
  await fs.ensureDir(inputDistDir);
  await fs.ensureDir(inputKeystoreDir);
  await fs.ensureDir(outputDir);

  await fs.copy(params.webDistDir, inputDistDir);

  const copiedKeystoreName = path.basename(params.keystorePath);
  const copiedKeystorePath = path.join(inputKeystoreDir, copiedKeystoreName);
  await fs.copyFile(params.keystorePath, copiedKeystorePath);

  const signing = getDefaultKeystoreSigningConfig();
  const metadata: BuilderMetadata = {
    packageName: params.packageName,
    appLabel: params.appLabel,
    versionCode: params.versionCode,
    versionName: params.versionName,
    keystore: {
      path: path.posix.join('keystore', copiedKeystoreName),
      alias: signing.alias,
      storePassword: signing.storePassword,
      keyPassword: signing.keyPassword,
    },
  };

  const metadataPath = path.join(inputDir, BUILDER_METADATA_FILE);
  await fs.writeJSON(metadataPath, metadata, { spaces: 2 });

  if (process.platform !== 'win32') {
    await fs.chmod(outputDir, 0o777).catch(() => undefined);
  }

  return { inputDir, outputDir };
}

async function resolveKeystorePath(cwd: string, config: PortlConfig): Promise<string> {
  const configuredPath = path.resolve(cwd, config.keystorePath);
  if (await fs.pathExists(configuredPath)) {
    return configuredPath;
  }

  const normalizedConfigPath = config.keystorePath.replaceAll('\\', '/');
  if (normalizedConfigPath !== DEFAULT_KEYSTORE_RELATIVE_PATH) {
    throw new Error(`Configured keystore not found: ${config.keystorePath}`);
  }

  await ensureKeystore(path.join(cwd, '.portl'));
  if (!(await fs.pathExists(configuredPath))) {
    throw new Error(`Keystore could not be created at ${config.keystorePath}`);
  }
  return configuredPath;
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

function isExecaError(error: unknown): error is { stdout?: string; stderr?: string } {
  return typeof error === 'object' && error !== null;
}
