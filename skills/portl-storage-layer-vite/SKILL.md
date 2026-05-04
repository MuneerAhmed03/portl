---
name: portl-storage-layer-vite
description: Build a production-ready storage layer for any Vite app using Portl, including architecture, bootstrapping, repository design, and implementation with either raw SQL (portl DB.query) or Drizzle (portl/drizzle). Use this skill whenever the user asks to set up local persistence, offline data, SQLite schema/migrations, key-value storage, or data access patterns in a Portl + Vite app, even if they do not explicitly mention this skill.
---

# Portl storage layer for Vite apps

Use this skill to implement a durable, maintainable data layer in Vite apps that run in browser and Android via Portl.

Read these references as needed:
- `references/design-principles.md` for architecture and rules
- `references/raw-setup.md` for raw SQL implementation
- `references/drizzle-setup.md` for Drizzle implementation

## What this skill should produce

Produce a clean storage layer with:
1. A single bootstrap path that initializes data once.
2. Repository-style data access (no SQL in UI components).
3. Clear separation between key-value preferences (`Storage`) and relational app data (`DB` or Drizzle).
4. Idempotent schema/migration setup.
5. Parameterized queries only.

## Intake and clarification

Before coding, ask targeted questions when unknown:
1. Which mode: `raw`, `drizzle`, or `hybrid`?
2. What entities/tables are required first?
3. Is migration history needed now (recommended) or can schema be bootstrap-only initially?
4. Any naming conventions for folders and modules?
5. Any data lifecycle constraints (retention, wipe/reset, user-scoped data)?

If the user does not care, choose:
- `drizzle` for medium/large apps
- `raw` for tiny/simple apps

## Standard implementation workflow

1. Inspect existing Vite app and current data files.
2. Create or align to this structure:
   - `src/data/bootstrap.ts`
   - `src/data/storage/*.ts` (key-value wrappers)
   - `src/data/db/*` (SQL/Drizzle setup)
   - `src/data/repositories/*` (business data access)
3. Wire app startup to call bootstrap once before first data usage.
4. Implement one end-to-end feature repository as the pattern reference.
5. Add/update tests for repository behavior and bootstrap idempotency.
6. Keep framework UI (React/Vue/Svelte) unaware of SQL details.

## Mode selection

Choose one path:
- For **raw SQL**: follow `references/raw-setup.md`
- For **Drizzle**: follow `references/drizzle-setup.md`
- For **hybrid**: use Drizzle for relational data and `Storage` wrappers for settings/cache keys

## Guardrails

Always enforce:
- No direct `DB.query`/Drizzle calls from components.
- No string interpolation for SQL values (use bound params).
- Centralized table names and schema ownership.
- Typed decode/encode boundaries for stored JSON.
- Explicit error messages; do not silently swallow database failures.

## Output format

When finishing an implementation, report:
1. Files created/changed and purpose.
2. Startup wiring location.
3. Chosen mode (`raw`/`drizzle`/`hybrid`) and why.
4. Exact install/run commands the project now expects.
5. Any assumptions or follow-up tasks that remain.

