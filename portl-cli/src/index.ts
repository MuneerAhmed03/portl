#!/usr/bin/env node
import { Command } from 'commander';
import { buildCommand } from './commands/build.js';
import { devCommand } from './commands/dev.js';
import { devBuildCommand } from './commands/dev-build.js';
import { drizzleBundleCommand } from './commands/drizzle.js';

const program = new Command();

program
  .name('portl')
  .description('Turn your web app into an Android app')
  .version('0.1.0');

program
  .command('build')
  .description('Build a production APK')
  .option('--verbose', 'Show full error stack traces')
  .option('--builder-image <image>', 'Builder container image to use')
  .option('--no-pull', 'Skip docker pull and use the local builder image cache')
  .option('--webview-debug', 'Enable WebView remote debugging in the built APK')
  .action(buildCommand);

program
  .command('dev')
  .description('Start Vite dev server with browser fallbacks')
  .action(devCommand);

program
  .command('dev-build')
  .description('Build a dev APK that loads from your local dev server')
  .option('--verbose', 'Show full error stack traces')
  .option('--builder-image <image>', 'Builder container image to use')
  .option('--no-pull', 'Skip docker pull and use the local builder image cache')
  .option('--no-webview-debug', 'Disable WebView remote debugging in the dev APK')
  .action(devBuildCommand);

const drizzle = program.command('drizzle').description('Drizzle integration utilities');

drizzle
  .command('bundle')
  .description('Bundle Drizzle Kit migrations into a Portl runtime module')
  .option('--migrations <dir>', 'Drizzle migrations directory', 'drizzle')
  .option('--out <file>', 'Generated migrations module', 'src/data/db/migrations.generated.ts')
  .option('--check', 'Fail if the generated migrations module is stale')
  .action(drizzleBundleCommand);

program.parse();
