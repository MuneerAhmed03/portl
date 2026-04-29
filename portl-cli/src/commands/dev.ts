import path from 'node:path';
import chalk from 'chalk';
import { execa } from 'execa';
import fs from 'fs-extra';

export async function devCommand(): Promise<void> {
  const cwd = process.cwd();

  try {
    const packageJsonPath = path.join(cwd, 'package.json');
    if (!(await fs.pathExists(packageJsonPath))) {
      throw new Error('Run portl from your project root.');
    }

    const vitePath = path.join(cwd, 'node_modules', '.bin', 'vite');
    if (!(await fs.pathExists(vitePath))) {
      throw new Error('Vite not found. Run: npm install vite');
    }

    await execa(vitePath, [], { cwd, stdio: 'inherit' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(message));
    process.exitCode = 1;
  }
}
