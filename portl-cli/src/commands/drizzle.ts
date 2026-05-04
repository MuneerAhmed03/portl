import chalk from 'chalk';
import { bundleDrizzleMigrations } from '../utils/drizzleMigrations.js';

interface DrizzleBundleOptions {
  migrations?: string;
  out?: string;
  check?: boolean;
}

export async function drizzleBundleCommand(options: DrizzleBundleOptions): Promise<void> {
  try {
    const result = await bundleDrizzleMigrations(process.cwd(), {
      migrationsDir: options.migrations,
      out: options.out,
      check: options.check,
    });

    if (result.status === 'skipped') {
      console.log(chalk.gray(result.reason ?? 'No Drizzle migrations to bundle.'));
      return;
    }

    const target = result.outPath ? ` -> ${result.outPath}` : '';
    console.log(
      chalk.green(
        `Drizzle migrations ${result.status}: ${result.migrations} migration${result.migrations === 1 ? '' : 's'}${target}`,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(message));
    process.exitCode = 1;
  }
}
