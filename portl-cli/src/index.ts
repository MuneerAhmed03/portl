#!/usr/bin/env node
import { Command } from 'commander';
import { buildCommand } from './commands/build.js';
import { devCommand } from './commands/dev.js';
import { devBuildCommand } from './commands/dev-build.js';

const program = new Command();

program
  .name('portl')
  .description('Turn your web app into an Android app')
  .version('0.1.0');

program
  .command('build')
  .description('Build a production APK')
  .option('--verbose', 'Show full error stack traces')
  .action(buildCommand);

program
  .command('dev')
  .description('Start Vite dev server with browser fallbacks')
  .action(devCommand);

program
  .command('dev-build')
  .description('Build a dev APK that loads from your local dev server')
  .option('--verbose', 'Show full error stack traces')
  .action(devBuildCommand);

program.parse();
