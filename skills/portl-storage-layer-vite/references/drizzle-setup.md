# Drizzle setup (`portl/drizzle`)

Use this path for larger schemas and stronger type safety.

## Install

```bash
npm install portl drizzle-orm drizzle-kit
```

## Recommended file layout

```text
src/data/
  bootstrap.ts
  db/schema.ts
  db/client.ts
  db/migrations.generated.ts
  repositories/noteRepository.ts
  storage/preferences.ts
drizzle.config.ts
```

## Schema and DB client

```ts
// src/data/db/schema.ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const notes = sqliteTable('notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull()
})

export const schema = { notes }
```

```ts
// src/data/db/client.ts
import { createDB } from 'portl/drizzle'
import { schema } from './schema'

export const db = createDB(schema)
```

## Migrations and bootstrap

Generate Drizzle migrations first, then bundle them for Portl's browser/Android runtime:

```bash
npx drizzle-kit generate
npx portl drizzle bundle
```

The bundler writes `src/data/db/migrations.generated.ts` by default. It uses `.portl/drizzle-bundle-state.json` to skip parsing and writing when Drizzle inputs have not changed.

`portl/drizzle` accepts migration objects shaped like:
- `sql: string[]`
- `folderMillis: number`
- `hash: string`
- `bps: boolean`
- `idx?: number`
- `tag?: string`

Example bootstrap:

```ts
// src/data/bootstrap.ts
import { initDB } from 'portl/drizzle'
import migrations from './db/migrations.generated'

let bootstrapPromise: Promise<void> | null = null

export function bootstrapDataLayer(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = initDB({ migrations })
  }
  return bootstrapPromise
}
```

## Repository pattern (Drizzle path)

```ts
// src/data/repositories/noteRepository.ts
import { desc } from 'drizzle-orm'
import { db } from '../db/client'
import { notes } from '../db/schema'
import { bootstrapDataLayer } from '../bootstrap'

export async function listNotes() {
  await bootstrapDataLayer()
  return db.select().from(notes).orderBy(desc(notes.createdAt))
}

export async function createNote(input: { title: string; body: string }) {
  await bootstrapDataLayer()
  await db.insert(notes).values({
    title: input.title,
    body: input.body,
    createdAt: Date.now()
  })
}
```

## Key-value wrappers still use `Storage`

Use `Storage` for app preferences and lightweight keys, even when relational data uses Drizzle.

## Drizzle-mode review checklist

1. `bootstrapDataLayer()` is called before repositories run.
2. Migrations are committed and versioned with the app.
3. Repositories hide Drizzle specifics from UI components.
4. `Storage` wrappers are typed and namespaced.
5. No duplicated schema constants across files.
