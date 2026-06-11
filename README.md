# tamiz

tamiz is a schema-driven filtering engine for data pipeline records. Field rules live in a YAML file or a plain object. The engine evaluates each record against those rules and returns a structured pass, fail, or exemption result.

## Install

```bash
npm install tamiz
```

Requires Node.js 18+.

## Quick Start

```ts
import { loadSchemaFromObject, FilterEngine } from 'tamiz';

const schema = loadSchemaFromObject({
  tamiz: {
    fields: {
      email: { type: 'string', nullable: false, minLength: 5 },
      age:   { type: 'number', min: 0, max: 120 },
    },
    exemptions: [],
    advancedFilter: false,
  }
});

const engine = new FilterEngine({ schema });

const result = await engine.evaluate({ email: 'hi@example.com', age: 30 });
// { ok: true, reason: 'passed' }

const bad = await engine.evaluate({ email: '', age: 30 });
// { ok: false, error: { field: 'email', rule: 'nullable', message: '...' } }
```

## Loading a Schema

**From a YAML file:**

```ts
import { loadSchemaFromFile, FilterEngine } from 'tamiz';

const schema = loadSchemaFromFile('./rules.yml');
const engine = new FilterEngine({ schema });
```

```yaml
# rules.yml
tamiz:
  fields:
    status:
      type: string
      allowedValues: [active, pending]
    score:
      type: number
      min: 0
      max: 100
  exemptions: []
  advancedFilter: false
```

**From a plain object:**

```ts
const schema = loadSchemaFromObject({
  tamiz: {
    fields: { ... },
    exemptions: [],
    advancedFilter: false,
  }
});
```

The argument must be a plain `object`. Passing an untyped or `unknown` value will produce a TypeScript error.

## Field Rules

Each field has a `type` and optional constraints.

### `string`
| Rule | Type | Description |
|------|------|-------------|
| `nullable` | `false` | Fails if the value is null, undefined, or empty string |
| `minLength` | `number` | Minimum character length |
| `maxLength` | `number` | Maximum character length |
| `allowedValues` | `string[]` | Value must be one of these |
| `blockedValues` | `string[]` | Value must not be one of these |
| `caseSensitive` | `boolean` | Controls case sensitivity for `allowedValues` and `blockedValues` (default: `true`) |

### `number`
| Rule | Type | Description |
|------|------|-------------|
| `nullable` | `false` | Fails if the value is null or undefined |
| `min` | `number` | Must be >= this value |
| `max` | `number` | Must be <= this value |
| `allowedValues` | `number[]` | Value must be one of these |
| `blockedValues` | `number[]` | Value must not be one of these |

### `boolean`
| Rule | Type | Description |
|------|------|-------------|
| `nullable` | `false` | Fails if the value is null or undefined |
| `mustBe` | `boolean` | Value must be exactly `true` or `false` |

### `date`
| Rule | Type | Description |
|------|------|-------------|
| `nullable` | `false` | Fails if the value is null or undefined |
| `after` | `string` | Must be after this ISO date string (exclusive) |
| `before` | `string` | Must be before this ISO date string (exclusive) |
| `maxAgeDays` | `number` | Must not be older than N days from now |
| `mustBeFuture` | `boolean` | Must be in the future |
| `mustBePast` | `boolean` | Must be in the past |

## Batch Evaluation

```ts
const results = await engine.evaluateBatch([
  { email: 'a@b.com', age: 25 },
  { email: '',        age: 25 },
]);
// returns FilterResult[] in the same order
```

The default concurrency is `1` (sequential). Set a higher value only when advanced filters are safe to run in parallel against shared resources such as a DB connection pool or a rate-limited API.

```ts
const results = await engine.evaluateBatch(records, { concurrency: 4 });
```

## Exemptions

A record that matches an exemption rule skips all field checks entirely:

```ts
const schema = loadSchemaFromObject({
  tamiz: {
    fields: { status: { type: 'string', allowedValues: ['active'] } },
    exemptions: [{ field: 'role', values: ['admin', 'superuser'] }],
    advancedFilter: false,
  }
});

await engine.evaluate({ status: 'banned', role: 'admin' });
// { ok: true, reason: 'exempted' }
```

## Advanced Filters

For logic beyond per-field rules, such as database lookups, cross-field validation, or external API calls, set `advancedFilter: true` in the schema and register custom filter functions via `FilterRegistry`.

Advanced filters run after all field rules pass. If a filter returns `{ ok: false }`, evaluation stops immediately and that error is returned.

> Note: if `advancedFilter: true` is set in the schema but no `filterRegistry` is provided to the engine, advanced filters are silently skipped. Make sure to pass the registry to the constructor.

```ts
import { FilterRegistry, FilterEngine, loadSchemaFromObject } from 'tamiz';

const registry = new FilterRegistry();

registry.register(function noSelfReferral(record) {
  if (record.userId === record.referredBy) {
    return {
      ok: false,
      error: { field: 'referredBy', rule: 'noSelfReferral', message: 'Cannot refer yourself.' },
    };
  }
  return { ok: true };
});

const engine = new FilterEngine({
  schema: loadSchemaFromObject({
    tamiz: { fields: { ... }, exemptions: [], advancedFilter: true }
  }),
  filterRegistry: registry,
});
```

`register()` returns `this`, so calls can be chained:

```ts
registry
  .register(filterA)
  .register(filterB)
  .register(filterC);
```

To remove all registered filters at runtime:

```ts
registry.clear();
```

### Filter naming

The engine uses the function's `.name` property in event messages, for example `Running advanced filter #0 (noSelfReferral)`. Use named function expressions to get meaningful output. Arrow functions and anonymous functions produce unnamed events:

```ts
// named: engine emits "Running advanced filter #0 (checkUser)"
registry.register(async function checkUser(record, onEvent) { ... });

// anonymous: engine emits "Running advanced filter #0"
registry.register(async (record, onEvent) => { ... });
```

### Async filters and IO

Advanced filters support `async` and are suitable for database queries, HTTP calls, or any other IO:

```ts
registry.register(async function checkUser(record, onEvent) {
  onEvent?.({ kind: 'info', message: 'Fetching user from DB...' });

  const user = await db.findUser(record.userId);
  if (!user) {
    return {
      ok: false,
      error: { field: 'userId', rule: 'exists', message: 'User not found.' },
    };
  }

  onEvent?.({ kind: 'info', message: `User found: ${user.id}` });
  return { ok: true };
});
```

Each filter receives the record as its first argument and the `onEvent` handler as its second. This is the same handler resolved for the current evaluation call, either from `options.onEvent` or the constructor-level handler, and may be `undefined` if no handler was set.

The `now` option passed to `evaluate()` applies to field-level date rules only. Advanced filters receive the raw record and are responsible for their own time logic if needed.

## Events

The engine exposes an `onEvent` callback for observability. It can be set at the constructor level to apply globally, or passed per call to override it for that call only.

```ts
// Global handler
const engine = new FilterEngine({
  schema,
  onEvent: (event) => console.log(`[${event.kind}] ${event.message}`),
});

// Per-call handler
const result = await engine.evaluate(record, {
  onEvent: (event) => console.log(`[${event.kind}] ${event.message}`),
});
```

### Event kinds

| Kind | When |
|------|------|
| `info` | A record was exempted; an advanced filter started or rejected a record |
| `warning` | A field in the record is not declared in the schema |

Advanced filters receive the same `onEvent` handler as their second argument and can use it to emit their own events during execution.

## Error Handling

`evaluate()` and `evaluateBatch()` return a structured `FilterResult` for validation failures. Certain conditions cause the engine to throw instead:

- A record is missing a field that is declared in the schema
- The `now` option is not a valid `Date`
- An advanced filter throws an unexpected error

When an advanced filter throws, the engine wraps the error in an `AdvancedFilterError`, which includes the filter index and name for easier debugging:

```ts
import { AdvancedFilterError } from 'tamiz';

try {
  const result = await engine.evaluate(record);
} catch (err) {
  if (err instanceof AdvancedFilterError) {
    console.error(`Filter #${err.filterIndex} (${err.filterName}) failed:`, err.message);
  }
}
```

## Overriding `now` for Date Rules

Pass a custom `now` date to control what "current time" means for `mustBeFuture`, `mustBePast`, and `maxAgeDays`. This is useful in tests:

```ts
const result = await engine.evaluate(record, {
  now: new Date('2024-01-01T00:00:00Z'),
});
```

## FilterResult Shape

```ts
// Pass
{ ok: true, reason: 'passed' | 'exempted' }

// Fail
{ ok: false, error: { field: string, rule: string, message: string } }
```

## License

MIT