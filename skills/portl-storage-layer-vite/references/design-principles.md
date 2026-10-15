# Design principles for Portl storage layers

## 1. Split by responsibility

- Use `Storage` for small key-value data (settings, flags, lightweight cache metadata).
- Use `DB`/Drizzle for relational entities (notes, tasks, records, sync queues).
- Do not mix both for the same domain object unless there is a clear boundary.

## 2. Keep a data boundary

- UI should call repositories/services, not SQL builders directly.
- Repositories should return domain objects, not raw database row shapes.
- Keep decode/encode logic close to repository boundaries.

## 3. Bootstrap once, early

- Provide a single `bootstrapDataLayer()` call.
- Guard with a module-level promise so repeated calls are safe.
- Run bootstrap before first read/write in app startup.

## 4. Prefer explicit schemas and migrations

- Keep schema definitions in one place.
- Use idempotent creation/migration logic.
- For Drizzle, prefer `createPortlDrizzle({ schema, migrations })`; it runs migrations once before the first query.

## 5. Design for evolution

- Add migration discipline from day one if app data matters.
- Keep table/column names stable and readable.
- Use additive changes where possible to preserve existing installs.

## 6. Error handling rules

- Fail loudly with useful context.
- Avoid empty catch blocks in JS storage/data code.
- Wrap low-level errors into domain-level errors when helpful.

## 7. Testing strategy

- Test repository behavior, not ORM internals.
- Include bootstrap idempotency tests.
- Include read/write round-trip tests for key-value wrappers.
