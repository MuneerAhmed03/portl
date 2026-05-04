# Raw SQL setup (`portl` + `DB.query`)

Use this path for simple apps or when you want full SQL control.

## Install

```bash
npm install portl
```

## Recommended file layout

```text
src/data/
  bootstrap.ts
  db/raw.ts
  repositories/noteRepository.ts
  storage/preferences.ts
```

## Bootstrap pattern

```ts
// src/data/bootstrap.ts
import { DB } from 'portl'

let bootstrapPromise: Promise<void> | null = null

export function bootstrapDataLayer(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await DB.query(`
        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `)

      await DB.query(
        'CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at)'
      )
    })()
  }
  return bootstrapPromise
}
```

## Repository pattern

```ts
// src/data/repositories/noteRepository.ts
import { DB } from 'portl'
import { bootstrapDataLayer } from '../bootstrap'

export interface Note {
  id: number
  title: string
  body: string
  createdAt: number
}

type NoteRow = {
  id: number
  title: string
  body: string
  created_at: number
}

function mapRow(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at
  }
}

export async function listNotes(): Promise<Note[]> {
  await bootstrapDataLayer()
  const rows = await DB.query<NoteRow[]>(
    'SELECT id, title, body, created_at FROM notes ORDER BY created_at DESC'
  )
  return rows.map(mapRow)
}

export async function createNote(input: { title: string; body: string }): Promise<void> {
  await bootstrapDataLayer()
  await DB.query(
    'INSERT INTO notes (title, body, created_at) VALUES (?, ?, ?)',
    [input.title, input.body, Date.now()]
  )
}
```

## Key-value wrappers (`Storage`)

```ts
// src/data/storage/preferences.ts
import { Storage } from 'portl'

const THEME_KEY = 'app:preferences:theme'

export async function setTheme(value: 'light' | 'dark'): Promise<void> {
  await Storage.set(THEME_KEY, value)
}

export async function getTheme(): Promise<'light' | 'dark'> {
  const value = await Storage.get<string>(THEME_KEY)
  return value === 'dark' ? 'dark' : 'light'
}
```

## Wiring in app startup

Call `bootstrapDataLayer()` once before first data operation (or in app initialization).

## Raw-mode review checklist

1. All SQL with dynamic values uses `?` placeholders.
2. No component imports `DB` directly.
3. Table creation is idempotent.
4. Row mapping is explicit.
5. Storage keys are namespaced (`app:feature:key`).

