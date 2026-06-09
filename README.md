# tamiz

A rules-configured filtering gate for data pipeline records. Define your field rules in a schema (YAML or plain object), then pass records through. Each one either passes, fails with a clear reason, or is exempted.

## Install

```bash
npm install tamiz
```

Requires Node.js 18+.

## Quick Start

```ts
import { loadSchemaFromObject, FilterEngine } from 'tamiz';

const schema = loadSchemaFromObject({
  fields: {
    email: { type: 'string', nullable: false, minLength: 5 },
    age:   { type: 'number', min: 0, max: 120 },
  },
  exemptions: [],
  advancedFilter: false,
});

const engine = new FilterEngine({ schema });

const result = engine.evaluate({ email: 'hi@example.com', age: 30 });
// { ok: true, reason: 'passed', warnings: [] }

const bad = engine.evaluate({ email: '', age: 30 });
// { ok: false, error: { field: 'email', rule: 'nullable', message: '...' }, warnings: [] }
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
const schema = loadSchemaFromObject({ fields: { ... }, exemptions: [], advancedFilter: false });
```

## Field Rules

Each field has a `type` and optional constraints.

### `string`
| Rule | Type | Description |
|------|------|-------------|
| `nullable` | `false` | Fail if value is null, undefined, or empty string |
| `minLength` | `number` | Minimum character length |
| `maxLength` | `number` | Maximum character length |
| `allowedValues` | `string[]` | Value must be one of these |
| `blockedValues` | `string[]` | Value must not be one of these |
| `caseSensitive` | `boolean` | Applies to `allowedValues`/`blockedValues` (default: `true`) |

### `number`
| Rule | Type | Description |
|------|------|-------------|
| `nullable` | `false` | Fail if value is null or undefined |
| `min` | `number` | Must be >= this value |
| `max` | `number` | Must be <= this value |
| `allowedValues` | `number[]` | Value must be one of these |
| `blockedValues` | `number[]` | Value must not be one of these |

### `boolean`
| Rule | Type | Description |
|------|------|-------------|
| `nullable` | `false` | Fail if value is null or undefined |
| `mustBe` | `boolean` | Value must be exactly `true` or `false` |

### `date`
| Rule | Type | Description |
|------|------|-------------|
| `nullable` | `false` | Fail if value is null or undefined |
| `after` | `string` | Must be after this ISO date string |
| `before` | `string` | Must be before this ISO date string |
| `maxAgeDays` | `number` | Must not be older than N days from now |
| `mustBeFuture` | `boolean` | Must be in the future |
| `mustBePast` | `boolean` | Must be in the past |

## Batch Evaluation

```ts
const results = engine.evaluateBatch([
  { email: 'a@b.com', age: 25 },
  { email: '',        age: 25 },
]);
// returns FilterResult[] in the same order
```

## Exemptions

Records matching an exemption rule bypass all field checks entirely:

```ts
const schema = loadSchemaFromObject({
  fields: { status: { type: 'string', allowedValues: ['active'] } },
  exemptions: [{ field: 'role', values: ['admin', 'superuser'] }],
  advancedFilter: false,
});

engine.evaluate({ status: 'banned', role: 'admin' });
// { ok: true, reason: 'exempted', warnings: [] }
```

## Advanced Filters

For logic that goes beyond per-field rules, enable `advancedFilter: true` in the schema and register custom filter functions:

```ts
import { FilterRegistry, FilterEngine, loadSchemaFromObject } from 'tamiz';

const registry = new FilterRegistry();

registry.register(function noSelfReferral(record) {
  if (record.userId === record.referredBy) {
    return { ok: false, error: { field: 'referredBy', rule: 'noSelfReferral', message: 'Cannot refer yourself.' } };
  }
  return { ok: true };
});

const engine = new FilterEngine({
  schema: loadSchemaFromObject({ fields: { ... }, exemptions: [], advancedFilter: true }),
  filterRegistry: registry,
});
```

Advanced filters run after all field rules pass. If any filter returns `{ ok: false }`, evaluation stops and that error is returned.

## Warnings

Use `warnUnknownFields` to surface fields present in a record but not declared in the schema:

```ts
const engine = new FilterEngine({ schema, warnUnknownFields: true });

engine.evaluate(
  { email: 'a@b.com', unknownField: 'oops' },
  { onWarning: (w) => console.warn(w.message) },
);
```

You can also pass `onWarning` at the constructor level to apply it globally.

## FilterResult Shape

```ts
// Pass
{ ok: true, reason: 'passed' | 'exempted', warnings: GateWarning[] }

// Fail
{ ok: false, error: { field: string, rule: string, message: string }, warnings: GateWarning[] }
```

## License

MIT