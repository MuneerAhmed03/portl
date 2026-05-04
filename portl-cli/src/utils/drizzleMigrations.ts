import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';

export type BundleStatus = 'created' | 'updated' | 'unchanged' | 'skipped';

export interface BundleDrizzleOptions {
  migrationsDir?: string;
  out?: string;
  check?: boolean;
}

export interface BundleDrizzleResult {
  status: BundleStatus;
  migrations: number;
  outPath?: string;
  reason?: string;
}

interface DrizzleJournal {
  dialect?: unknown;
  entries?: unknown;
}

interface DrizzleJournalEntry {
  idx: number;
  tag: string;
  when: number;
  breakpoints: boolean;
}

interface MigrationMeta {
  idx: number;
  tag: string;
  sql: string[];
  folderMillis: number;
  hash: string;
  bps: boolean;
}

interface InputStat {
  path: string;
  size: number;
  mtimeMs: number;
}

interface BundleState {
  version: 1;
  migrationsDir: string;
  outPath: string;
  inputFingerprint: string;
  outputHash: string;
  inputs: InputStat[];
  output?: InputStat;
}

const DEFAULT_MIGRATIONS_DIR = 'drizzle';
const DEFAULT_OUT_PATH = path.join('src', 'data', 'db', 'migrations.generated.ts');
const STATE_PATH = path.join('.portl', 'drizzle-bundle-state.json');
const STAT_MTIME_PRECISION = 3;

export async function bundleDrizzleMigrations(
  cwd: string,
  options: BundleDrizzleOptions = {},
): Promise<BundleDrizzleResult> {
  const migrationsDir = normalizeRelativePath(options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
  const outPath = normalizeRelativePath(options.out ?? DEFAULT_OUT_PATH);
  const absoluteMigrationsDir = path.resolve(cwd, migrationsDir);
  const absoluteOutPath = path.resolve(cwd, outPath);
  assertInsideProject(cwd, absoluteOutPath, 'Generated migrations output');

  const journalPath = path.join(absoluteMigrationsDir, 'meta', '_journal.json');
  if (!(await fs.pathExists(journalPath))) {
    return {
      status: 'skipped',
      migrations: 0,
      outPath,
      reason: `No Drizzle journal found at ${path.relative(cwd, journalPath)}`,
    };
  }

  const previousState = await readState(cwd);
  if (!options.check && previousState) {
    const fastPath = await canUseFastPath(cwd, previousState, migrationsDir, outPath);
    if (fastPath) {
      return { status: 'unchanged', migrations: previousState.inputs.length - 1, outPath };
    }
  }

  const journal = await readJournal(journalPath);
  const entries = parseJournalEntries(journal);
  validateSqliteDialect(journal);

  const migrations = await Promise.all(
    entries.map(async (entry) => {
      const sqlPath = await resolveSqlPath(absoluteMigrationsDir, entry.tag);
      const sqlContent = normalizeNewlines(await fs.readFile(sqlPath, 'utf8'));
      const sql = splitSqlStatements(sqlContent, entry.breakpoints);
      const hash = hashContent(sql.join('\n--> statement-breakpoint\n'));

      return {
        migration: {
          idx: entry.idx,
          tag: entry.tag,
          sql,
          folderMillis: entry.when,
          hash,
          bps: entry.breakpoints,
        },
        sqlPath,
      };
    }),
  );

  validateMigrations(migrations.map(({ migration }) => migration));

  const inputPaths = [journalPath, ...migrations.map(({ sqlPath }) => sqlPath)];
  const inputStats = await statInputs(cwd, inputPaths);
  const inputFingerprint = hashContent(
    inputStats.map((input) => `${input.path}:${input.size}:${input.mtimeMs}`).join('\n'),
  );
  const generatedContent = renderGeneratedMigrations(
    migrations.map(({ migration }) => migration),
  );
  const outputHash = hashContent(generatedContent);

  if (options.check) {
    const currentHash = (await fs.pathExists(absoluteOutPath))
      ? hashContent(await fs.readFile(absoluteOutPath, 'utf8'))
      : '';
    if (currentHash !== outputHash) {
      throw new Error(`${outPath} is stale. Run: portl drizzle bundle`);
    }
    await writeState(cwd, {
      version: 1,
      migrationsDir,
      outPath,
      inputFingerprint,
      outputHash,
      inputs: inputStats,
      output: await statOptionalOutput(cwd, absoluteOutPath),
    });
    return { status: 'unchanged', migrations: migrations.length, outPath };
  }

  let status: BundleStatus = 'updated';
  const outputExists = await fs.pathExists(absoluteOutPath);
  if (!outputExists) {
    await fs.outputFile(absoluteOutPath, generatedContent, 'utf8');
    status = 'created';
  } else if (previousState?.outPath === outPath && previousState.outputHash === outputHash) {
    status = 'unchanged';
  } else {
    await fs.writeFile(absoluteOutPath, generatedContent, 'utf8');
    status = 'updated';
  }

  await writeState(cwd, {
    version: 1,
    migrationsDir,
    outPath,
    inputFingerprint,
    outputHash,
    inputs: inputStats,
    output: await statOptionalOutput(cwd, absoluteOutPath),
  });

  return { status, migrations: migrations.length, outPath };
}

function normalizeRelativePath(value: string): string {
  const normalized = path.normalize(value);
  if (path.isAbsolute(normalized) || normalized.startsWith(`..${path.sep}`) || normalized === '..') {
    throw new Error(`Path must be inside the project: ${value}`);
  }
  return normalized;
}

function assertInsideProject(cwd: string, targetPath: string, label: string): void {
  const relative = path.relative(cwd, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must be inside the project.`);
  }
}

async function readState(cwd: string): Promise<BundleState | null> {
  const statePath = path.join(cwd, STATE_PATH);
  if (!(await fs.pathExists(statePath))) {
    return null;
  }

  try {
    const parsed = (await fs.readJSON(statePath)) as Partial<BundleState>;
    if (
      parsed.version !== 1 ||
      typeof parsed.migrationsDir !== 'string' ||
      typeof parsed.outPath !== 'string' ||
      typeof parsed.inputFingerprint !== 'string' ||
      typeof parsed.outputHash !== 'string' ||
      !Array.isArray(parsed.inputs)
    ) {
      return null;
    }
    return parsed as BundleState;
  } catch {
    return null;
  }
}

async function writeState(cwd: string, state: BundleState): Promise<void> {
  await ensureStateInGitignore(cwd);
  await fs.outputJSON(path.join(cwd, STATE_PATH), state, { spaces: 2 });
}

async function ensureStateInGitignore(cwd: string): Promise<void> {
  const gitignorePath = path.join(cwd, '.gitignore');
  const entry = STATE_PATH.replaceAll(path.sep, '/');

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

async function canUseFastPath(
  cwd: string,
  state: BundleState,
  migrationsDir: string,
  outPath: string,
): Promise<boolean> {
  if (state.migrationsDir !== migrationsDir || state.outPath !== outPath || !state.output) {
    return false;
  }

  const absoluteOutputPath = path.join(cwd, state.output.path);
  if (!(await fs.pathExists(absoluteOutputPath))) {
    return false;
  }

  const outputStat = await statFile(cwd, absoluteOutputPath);
  if (!sameStat(outputStat, state.output)) {
    return false;
  }

  for (const input of state.inputs) {
    const absoluteInputPath = path.join(cwd, input.path);
    if (!(await fs.pathExists(absoluteInputPath))) {
      return false;
    }
    const current = await statFile(cwd, absoluteInputPath);
    if (!sameStat(current, input)) {
      return false;
    }
  }

  return true;
}

async function readJournal(journalPath: string): Promise<DrizzleJournal> {
  try {
    return (await fs.readJSON(journalPath)) as DrizzleJournal;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read Drizzle journal: ${message}`);
  }
}

function validateSqliteDialect(journal: DrizzleJournal): void {
  if (typeof journal.dialect === 'string' && journal.dialect !== 'sqlite') {
    throw new Error(`Portl only supports SQLite Drizzle migrations. Found dialect: ${journal.dialect}`);
  }
}

function parseJournalEntries(journal: DrizzleJournal): DrizzleJournalEntry[] {
  if (!Array.isArray(journal.entries)) {
    throw new Error('Drizzle journal is missing entries.');
  }

  return journal.entries.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Invalid Drizzle journal entry at index ${index}.`);
    }

    const candidate = entry as Record<string, unknown>;
    const idx = typeof candidate.idx === 'number' ? candidate.idx : index;
    const tag = candidate.tag;
    const when = candidate.when;
    const breakpoints = candidate.breakpoints;

    if (typeof tag !== 'string' || tag.length === 0) {
      throw new Error(`Drizzle journal entry ${index} is missing a tag.`);
    }
    if (typeof when !== 'number') {
      throw new Error(`Drizzle journal entry ${tag} is missing a numeric timestamp.`);
    }

    return {
      idx,
      tag,
      when,
      breakpoints: typeof breakpoints === 'boolean' ? breakpoints : false,
    };
  });
}

async function resolveSqlPath(migrationsDir: string, tag: string): Promise<string> {
  const flatPath = path.join(migrationsDir, `${tag}.sql`);
  if (await fs.pathExists(flatPath)) {
    return flatPath;
  }

  const folderPath = path.join(migrationsDir, tag, 'migration.sql');
  if (await fs.pathExists(folderPath)) {
    return folderPath;
  }

  throw new Error(`Missing SQL file for Drizzle migration: ${tag}`);
}

function splitSqlStatements(sqlContent: string, breakpoints: boolean): string[] {
  const statements = breakpoints
    ? sqlContent.split(/^--> statement-breakpoint\s*$/gm)
    : [sqlContent];

  return statements.map((statement) => statement.trim()).filter((statement) => statement.length > 0);
}

function validateMigrations(migrations: MigrationMeta[]): void {
  const tags = new Set<string>();
  const hashes = new Set<string>();

  for (const migration of migrations) {
    if (migration.sql.length === 0) {
      throw new Error(`Drizzle migration ${migration.tag} does not contain SQL statements.`);
    }
    if (tags.has(migration.tag)) {
      throw new Error(`Duplicate Drizzle migration tag: ${migration.tag}`);
    }
    if (hashes.has(migration.hash)) {
      throw new Error(`Duplicate Drizzle migration hash: ${migration.hash}`);
    }
    tags.add(migration.tag);
    hashes.add(migration.hash);
  }
}

async function statInputs(cwd: string, inputPaths: string[]): Promise<InputStat[]> {
  return Promise.all(inputPaths.map((inputPath) => statFile(cwd, inputPath)));
}

async function statOptionalOutput(cwd: string, outputPath: string): Promise<InputStat | undefined> {
  if (!(await fs.pathExists(outputPath))) {
    return undefined;
  }
  return statFile(cwd, outputPath);
}

async function statFile(cwd: string, filePath: string): Promise<InputStat> {
  const stats = await fs.stat(filePath);
  return {
    path: path.relative(cwd, filePath).replaceAll(path.sep, '/'),
    size: stats.size,
    mtimeMs: Number(stats.mtimeMs.toFixed(STAT_MTIME_PRECISION)),
  };
}

function sameStat(left: InputStat, right: InputStat): boolean {
  return left.path === right.path && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function renderGeneratedMigrations(migrations: MigrationMeta[]): string {
  return `// Generated by Portl. Do not edit.\nimport type { MigrationMeta } from 'portl/drizzle';\n\nconst migrations = ${JSON.stringify(
    migrations,
    null,
    2,
  )} satisfies MigrationMeta[];\n\nexport default migrations;\n`;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function hashContent(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
