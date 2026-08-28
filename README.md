# Elysia Procedures

A procedure builder for [Elysia](https://elysiajs.com) with [TypeBox](https://github.com/sinclairzx81/typebox) validation. You compose procedures into a chain of middleware, each adding validated input and typed context, and turn the chain into actions that plug into Elysia routes. The pattern is borrowed from tRPC.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage](#usage)
  - [Creating a Basic Procedure](#creating-a-basic-procedure)
  - [Adding Schema Validation](#adding-schema-validation)
  - [Creating Actions](#creating-actions)
- [Integrating with Elysia](#integrating-with-elysia)
- [Caching](#caching)
- [Errors](#errors)
  - [Declaring errors](#declaring-errors)
  - [Throwing errors](#throwing-errors)
  - [The `procedures()` plugin](#the-procedures-plugin)
  - [Wire contract](#wire-contract)
  - [OpenAPI](#openapi)
- [Named schemas](#named-schemas)
- [Tracing](#tracing)
- [Type-checking performance](#type-checking-performance)
- [Acknowledgments](#acknowledgments)

## Features

- **Elysia.** `action.handle` and `action.docs` drop straight into `.get()` / `.post()` calls.
- **Typed.** Params, query, body, context and errors are inferred down the chain. Wrong input does not compile.
- **Validation.** TypeBox schemas validate params, query, body and output.
- **Composable.** Procedures extend other procedures, and actions reuse them as middleware.
- **Documentation.** OpenAPI details live next to the handler and `action.docs` emits them.
- **Named schemas.** An `$id` on an output schema makes it a reusable OpenAPI model instead of a copy per route.
- **Caching.** A procedure runs once per request, keyed by the dependencies you name.
- **Errors.** Typed error tables, RFC 9457 `application/problem+json` responses and pluggable error reporting.
- **Tracing.** OpenTelemetry spans for every action, middleware and handler run.

## Installation

```bash
# Using npm
npm install @luukgoossen/elysia-procedures

# Using yarn
yarn add @luukgoossen/elysia-procedures

# Using pnpm
pnpm add @luukgoossen/elysia-procedures

# Using bun
bun add @luukgoossen/elysia-procedures
```

## Quick Start

```typescript
import { Elysia } from "elysia";
import { createProcedure } from "@luukgoossen/elysia-procedures";
import { Type } from "@sinclair/typebox";

// Create an authentication middleware procedure
const authProcedure = createProcedure("Ensure Auth", {
  errors: { table: { UNAUTHORIZED: { status: 401 } } },
}).build(async ({ ctx }, onError) => {
  // Check auth header
  const authHeader = ctx.request.headers.get("Authorization");
  if (!authHeader) {
    throw onError("UNAUTHORIZED");
  }

  // Return user data to be added to context
  return {
    user: {
      id: "123",
      name: "John Doe",
      role: "admin",
    },
  };
});

// Create a procedure that requires authentication
const userProcedure = createProcedure("With User Profile", authProcedure)
  .params(
    Type.Object({
      userId: Type.String(),
    }),
  )
  .query(
    Type.Object({
      include: Type.Optional(Type.String()),
    }),
  )
  .build(({ ctx, params, query }) => {
    // ctx.user is available because of the auth middleware
    console.log(`User ${ctx.user.name} is accessing profile ${params.userId}`);

    return {
      success: true,
    };
  });

// Create an API endpoint action with our procedure
const getUserAction = userProcedure
  .createAction("Get User")
  .output(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      email: Type.String(),
      role: Type.String(),
    }),
  )
  .build(({ ctx, params }) => {
    // Fetch user data based on params.userId
    return {
      id: params.userId,
      name: "Jane Doe",
      email: "jane@example.com",
      role: "user",
    };
  });

// Get the result of the action
const user = await getUserAction.run(context, { params, query, body });
```

## Usage

### Creating a Basic Procedure

A procedure is the reusable part of an endpoint. It declares the params, query and body it needs, runs a handler, and whatever that handler returns is merged into the context of everything built on top of it.

```typescript
import { createProcedure } from "@luukgoossen/elysia-procedures";
import { Type } from "@sinclair/typebox";

// Create a basic procedure
const baseProcedure = createProcedure("Basic Procedure").build(({ ctx }) => {
  console.log("Request received:", ctx.request.url);
  return { requestTime: new Date() };
});
```

### Adding Schema Validation

TypeBox schemas validate params, query strings and request bodies. A child procedure inherits its parent's schemas and can add properties, but not redeclare one the parent already has.

```typescript
const productProcedure = createProcedure("Ensure Product", baseProcedure)
  .params(
    Type.Object({
      productId: Type.String(),
    }),
  )
  .query(
    Type.Object({
      currency: Type.Optional(Type.String({ default: "USD" })),
      format: Type.Optional(Type.Enum({ json: "json", xml: "xml" })),
    }),
  )
  .body(
    Type.Object({
      includeDetails: Type.Boolean(),
    }),
  )
  .build(({ params, query, body, ctx }) => {
    // All inputs are validated and typed
    console.log(
      `Fetching product ${params.productId} in ${query.currency} format`,
    );

    return {
      productDetails: true,
    };
  });
```

### Creating Actions

An action is an endpoint built from a procedure. It adds an output schema and the handler that does the work:

```typescript
const getProductAction = productProcedure
  .createAction("Get Product")
  .output(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      price: Type.Number(),
      details: Type.Optional(
        Type.Object({
          description: Type.String(),
          specifications: Type.Array(Type.String()),
        }),
      ),
    }),
  )
  .build(({ params, query, body, ctx }) => {
    // Fetch product from database
    return {
      id: params.productId,
      name: "Amazing Product",
      price: 99.99,
      details: body.includeDetails
        ? {
            description: "This is an amazing product",
            specifications: ["Spec 1", "Spec 2"],
          }
        : undefined,
    };
  });
```

## Integrating with Elysia

`action.handle` is an Elysia route handler and `action.docs` is the matching route config: the params, query, body and response schemas, and the OpenAPI detail. Pass both to a route and Elysia validates the input and documents the endpoint.

Mount the `procedures()` plugin on the root app to get `application/problem+json` error responses (see [Errors](#errors)) and, when enabled, an OpenTelemetry span per step of the chain (see [Tracing](#tracing)).

```typescript
import { Elysia } from "elysia";
import { procedures } from "@luukgoossen/elysia-procedures";

const app = new Elysia()
  .use(procedures())
  .get("/products/:productId", getProductAction.handle, getProductAction.docs)
  .post(
    "/products/:productId/update",
    updateProductAction.handle,
    updateProductAction.docs,
  )
  .listen(3000);
```

## Caching

A procedure used by several actions, or by several middlewares in one chain, would run once per use. Caching makes it run once per request instead. Turn it on by giving the builder a function that returns the procedure's dependencies.

```typescript
import { createProcedure } from "@luukgoossen/elysia-procedures";
import { Type } from "@sinclair/typebox";

// Create a basic procedure
const baseProcedure = createProcedure("Basic Procedure")
  .cache(() => [])
  .build(async ({ ctx }) => {
    console.log("Request received:", ctx.request.url);

    // simulate a long-running process
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return { requestTime: new Date() };
  });
```

Any array turns caching on, even an empty one. If the same procedure can be called with different params, query or body within one request, return those values from the function so each combination gets its own cache entry. Caches are applied per-request.

```typescript
import { createProcedure } from "@luukgoossen/elysia-procedures";
import { Type } from "@sinclair/typebox";

// Create a basic procedure
const baseProcedure = createProcedure("Basic Procedure")
  .params(
    Type.Object({
      productId: Type.String(),
    }),
  )
  .cache(({ params }) => [params.productId])
  .build(async ({ ctx }) => {
    console.log("Request received:", ctx.request.url);

    // simulate a long-running process
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return { requestTime: new Date() };
  });
```

## Errors

You declare an error table once, throw errors through the typed `onError` factory every handler receives, and let the `procedures()` plugin turn everything that escapes a route into an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` response.

The package has no opinion on reason names, status codes or metadata shape. It only provides the mechanics.

### Declaring errors

Errors live in the `config` of `createProcedure`, passed as the second argument or as the third after a base procedure, and in the `details` of `createAction`. Tables merge by key down the chain. The child's entry wins, and the `type` function is inherited when the child does not set one.

```typescript
import { createProcedure } from "@luukgoossen/elysia-procedures";
import { Type } from "@sinclair/typebox";

const baseProcedure = createProcedure("Base", {
  errors: {
    // builds the RFC 9457 `type` URI for a reason; defaults to "about:blank"
    type: (reason) => `https://example.com/docs/errors/${reason}`,
    table: {
      NOT_FOUND: {
        status: 404,
        metadata: Type.Object({ entity: Type.String(), id: Type.String() }),
        title: (m: { entity: string; id: string }) => `${m.entity} not found`,
        detail:
          "The resource you requested does not exist or has been removed.",
      },
      FORBIDDEN: { status: 403, title: "You are not allowed to do that" },
      UPSTREAM_DOWN: { status: 502, title: "Upstream unavailable" },
    },
  },
}).build();

// child procedures and actions add or override entries
const adminProcedure = createProcedure("Admin", baseProcedure, {
  errors: { table: { FORBIDDEN: { status: 403, title: "Admins only" } } },
}).build();
```

Each entry has a `status`, an optional TypeBox `metadata` schema, and an optional `title` and `detail`. When an entry declares `metadata`, `onError` requires it. `title` and `detail` are either strings or functions of the validated metadata. Inside a plain object literal the metadata parameter of those functions has to be annotated by hand. Wrap the entry in `defineError(...)` and it is inferred from the schema:

```typescript
import { defineError } from "@luukgoossen/elysia-procedures";

NOT_FOUND: defineError({
  status: 404,
  metadata: Type.Object({ entity: Type.String() }),
  title: (m) => `${m.entity} not found`, // m is { entity: string }
}),
```

Four entries are always present and callable from every handler: `INTERNAL` (500), `INVALID_INPUT` (422), `MALFORMED_REQUEST` (400) and `NOT_FOUND` (404). You can override them by key but not remove them. The plugin uses them for failures that are not `ApiError`s.

Keep `status` values literal, either as inline object literals or through `defineError`. A table stored in a variable without `as const` widens them to `number`, and then `action.docs` can no longer type the response statuses.

### Throwing errors

Every handler and middleware receives `onError` as its second argument. It is typed from the effective table, so an unknown reason does not compile, and metadata is required exactly when the entry declares a schema.

```typescript
const getVideo = baseProcedure
  .createAction("Get Video")
  .params(Type.Object({ id: Type.String() }))
  .build(async ({ params }, onError) => {
    const video = await db.videos.find(params.id);
    if (!video) throw onError("NOT_FOUND", { entity: "Video", id: params.id });

    try {
      return await enrich(video);
    } catch (cause) {
      // wraps an unexpected failure as a 500 (or another >= 500 reason) without leaking it
      throw onError.unexpected(cause, { reason: "UPSTREAM_DOWN" });
    }
  });
```

`onError(reason, metadata?, options?)` returns an `ApiError` with public `status`, `reason`, `metadata`, `title`, `detail`, `type` and `cause`. You throw it. The `title` and `detail` come from `options` first, then from the entry's string or function, and finally from a fallback: the reason in Title Case for `title`, nothing for `detail`. Metadata that does not match the schema throws a plain `TypeError`, because that is a bug in the handler, not an API error.

### The `procedures()` plugin

`procedures()` is the Elysia plugin. Mount it once, on the root app, before any sub-apps. It registers the `Problem` and `ValidationProblem` models that `action.docs` reference and a global `onError` hook that serializes every failure. Elysia applies global hooks to every route registered after them, at any nesting depth, so sub-apps need nothing. A sub-app `.use()`d before the plugin is not covered.

```typescript
import { Elysia } from "elysia";
import { procedures, sentryReporter } from "@luukgoossen/elysia-procedures";
import * as Sentry from "@sentry/bun";

const app = new Elysia()
  .use(
    procedures({
      // same shape as the procedure config; used for the problems the plugin builds itself
      errors: {
        type: (reason) => `https://example.com/docs/errors/${reason}`,
        // max characters of a field's `received` value echoed back; default 200
        receivedMaxLength: 200,
      },
      // how handled failures are reported, logged and traced
      observability: {
        // reports failures and yields the `reference`; default: none
        errorReporting: sentryReporter(Sentry, { captureClientErrors: "warn" }),
        // default console.warn for 4xx and console.error for 5xx
        logging: (level, fields) => logger[level](fields),
        // OpenTelemetry spans for every run; default: off
        tracing: true,
      },
    }),
  )
  .get("/videos/:id", getVideo.handle, getVideo.docs)
  .listen(3000);
```

| thrown                                                        | status     | body                                    |
| ------------------------------------------------------------- | ---------- | --------------------------------------- |
| `ApiError`                                                    | its status | the error's problem                     |
| Elysia validation error                                       | 422        | `INVALID_INPUT` with per-field `errors` |
| Elysia parse error or invalid cookie signature                | 400        | `MALFORMED_REQUEST`                     |
| Elysia invalid file type                                      | 422        | `INVALID_INPUT` with one field error    |
| unknown route                                                 | 404        | `NOT_FOUND`                             |
| redirects, thrown `Response`s, `status(...)`                  | as is      | untouched                               |
| anything else, including a response failing the output schema | 500        | `INTERNAL` with default copy            |

Reporting is off by default. Nothing is captured and problems carry no `reference`. `sentryReporter(Sentry, options)` takes the Sentry SDK you initialized, meaning any `@sentry/*` package with `captureException` and `captureMessage`. It captures every 5xx problem as an exception, and Sentry follows the `cause` chain from there. With `captureClientErrors` it also captures 4xx `ApiError`s as messages. Any `(error, problem) => string | undefined` works as a reporter, so other trackers plug in the same way. Whatever the reporter returns becomes the problem's `reference`.

Every handled failure logs one structured line, `{ status, reason, instance, method, reference?, message? }`. The raw `message` only ever appears in the log, and only for 5xx.

Without the plugin nothing fails loudly, but you lose the contract. A thrown `ApiError` becomes a plain-text response with the right status. An unexpected `Error` is answered with its raw message, which is Elysia's default. Validation failures use Elysia's own JSON shape, and the OpenAPI spec references `Problem` schemas that are never emitted. The `.get(path, action.handle, action.docs)` pattern above assumes the plugin is mounted.

#### Bringing your own handler

`procedures()` is built from exported pieces. An app that already has its own `onError`, for HTML error pages, another error tracker or a different logging stack, can keep the wire contract and skip the rest:

- `procedureModels()` registers the `Problem` and `ValidationProblem` models that `action.docs` reference and `ApiError` as a known error. Mount it instead of `procedures()`.
- `resolveProblem(code, error, { instance?, errors?, receivedMaxLength? })` is the table above as a pure function. No reporting, no logging, never a raw message, and `undefined` for values that should pass through.
- `problemResponse(problem)` serializes a problem to an `application/problem+json` response.
- `sentryReporter(sentry, options)` is the Sentry reporter on its own.
- `configureTracing(options)` turns on tracing without the plugin, for example for actions run outside Elysia.

```typescript
import { Elysia } from "elysia";
import {
  procedureModels,
  resolveProblem,
  problemResponse,
} from "@luukgoossen/elysia-procedures";

const app = new Elysia()
  .use(procedureModels())
  .onError(async ({ code, error, request }) => {
    const problem = resolveProblem(code, error, {
      instance: new URL(request.url).pathname,
    });
    if (!problem) return; // redirect or early return, let Elysia handle it

    const reference =
      problem.status >= 500 ? await myTracker.capture(error) : undefined;
    return problemResponse({ ...problem, reference });
  });
```

### Wire contract

Every 4xx/5xx response produced by the plugin has `Content-Type: application/problem+json` and this shape:

```jsonc
{
  "type": "https://example.com/docs/errors/NOT_FOUND",
  "title": "Video not found",
  "status": 404,
  "detail": "The resource you requested does not exist or has been removed.",
  "instance": "/videos/abc",
  "reason": "NOT_FOUND", // stable key from the table
  "metadata": { "entity": "Video", "id": "abc" }, // validated by the entry's schema
  "reference": "8c1f4d2e…", // whatever the reporter returned, e.g. a Sentry event id; only when captured
}
```

Validation failures (422) are a `ValidationProblem`, which has the same members plus a required `errors` array with one entry per invalid value. `in` is the OpenAPI location (`body`, `path`, `query`, `header` or `cookie`) and `pointer` is a JSON pointer fragment within that location, so a client can map each error to a field without parsing strings:

```jsonc
{
  "type": "about:blank",
  "title": "Invalid input",
  "status": 422,
  "detail": "2 fields are invalid: body.name, body.tags[1]",
  "instance": "/videos",
  "reason": "INVALID_INPUT",
  "errors": [
    {
      "in": "body",
      "pointer": "#/name",
      "detail": "Expected string length greater or equal to 3",
      "received": "\"\"",
    },
    {
      "in": "body",
      "pointer": "#/tags/1",
      "detail": "Expected string",
      "received": "1",
    },
  ],
}
```

Some things never reach the client. `title` and `detail` never contain the raw message of an unexpected error, and `cause` never serializes. `received` is left out when any segment of the pointer matches `/password|secret|token|key/i` or when the value has no JSON form, such as a missing property or a file. When an error is reported on an object, properties matching that pattern at any depth are replaced with `"[redacted]"`. Otherwise it is cut off at `receivedMaxLength` characters.

A response that fails the action's output schema is a server bug, not a client error. It is reported and answered with a 500 `INTERNAL` problem, not a 422.

### OpenAPI

`action.docs.response` is keyed by status. `200` holds the output schema when one is defined, `422` references the `ValidationProblem` model, and every other status in the effective table, plus 500, references the shared `Problem` model. With `@elysiajs/openapi` this yields `components.schemas.Problem`, `components.schemas.ValidationProblem` and a `$ref` per documented status. `ApiError`, `Problem` and `ValidationProblem` are exported in case you need to map problems onto another transport. Output schemas become models too when you name them; see [Named schemas](#named-schemas).

## Named schemas

Without a name, an output schema is copied into the spec at every route that returns it: a schema used by ten routes is written out ten times, and a client generator gives each copy its own anonymous type. Give the schema an `$id` and it becomes one entry in `components.schemas`, referenced by `$ref` wherever it appears.

```typescript
import { Type } from "@sinclair/typebox";

const deviceType = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
  },
  { $id: "DeviceType" },
);

const device = Type.Object(
  {
    id: Type.String(),
    type: deviceType,
  },
  { $id: "Device" },
);

const getDevice = baseProcedure
  .createAction("Get Device")
  .params(Type.Object({ id: Type.String() }))
  .output(device)
  .build(({ params }) => findDevice(params.id));

const listDevices = baseProcedure
  .createAction("List Devices")
  .output(Type.Object({ devices: Type.Array(device) }))
  .build(() => ({ devices: findDevices() }));
```

The spec now holds `Device` and `DeviceType` once each. `getDevice` answers with `{ "$ref": "#/components/schemas/Device" }` and `listDevices` with an array of that reference, and `Device` points at `DeviceType` rather than repeating it. Your generated client gets a `Device` type you can import and pass around, instead of reaching into one response type per operation.

Naming is per schema and opt-in. A schema with no `$id` anywhere in it is documented exactly as it was before. A schema that has no `$id` of its own but holds ones that do is documented inline with those references in place, which is what `listDevices` does above.

Only outputs take part. Params, query and body stay inline: `@elysiajs/openapi` reads the properties of params and query to build the parameter list, and Elysia's coercion of string parameters into numbers and booleans does not reach through a reference. Members of a union stay inline as well, because a reference inside one costs Elysia the response normalizer for the whole route.

Registration happens in `.output()`, while the action is built. The models are complete by the time `procedures()` is mounted, as long as the modules defining the actions are imported first, which importing them at the top of the file that builds the app already does. For actions built later, behind a dynamic import, hand their schemas to the plugin: `procedures({ schemas: [device] })`. `registerSchema`, `registerSchemas` and `schemaModels` are exported for the same case.

Validation is unchanged. `action.run()` validates against the output schema itself, fully inlined, and Elysia resolves the references when it compiles a route's response validator. What it does not resolve is the normalizer that strips unknown properties, so properties nested inside a referenced schema are left in place rather than removed.

The registry is global and keyed by the `$id`. Registering two different schemas under one name throws while the module is loading, so reuse the one schema everywhere rather than cloning it: `CloneType(device, { description: "..." })` is a second schema carrying the same `$id`. Reusing the same object, including through `Type.Optional()`, is the ordinary case and does nothing. `Problem` and `ValidationProblem` are taken. Two apps booted in one process share the registry too, so each spec lists the other's models; `clearSchemas()` empties it between them, and between tests that register schemas of their own.

## Tracing

Tracing uses the [OpenTelemetry API](https://www.npmjs.com/package/@opentelemetry/api) and nothing else, so it works with whichever SDK registers the global tracer provider. That can be `@elysiajs/opentelemetry`, `@sentry/bun` (itself built on OpenTelemetry) or the OpenTelemetry Node SDK directly. Spans nest under the active span, so with Elysia's plugin every procedure run shows up inside its request span. Without a provider the API does nothing.

Tracing is off until you turn it on through the plugin:

```typescript
import { Elysia } from "elysia";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { trace } from "@opentelemetry/api";
import { procedures } from "@luukgoossen/elysia-procedures";

const app = new Elysia().use(opentelemetry()).use(
  procedures({
    observability: {
      // true for the defaults, or:
      tracing: {
        // a tracer of your own; default: the global provider's tracer for this package
        tracer: trace.getTracer("my-service"),
        // which span types to emit; all default to true
        spans: { input: false, output: false },
        // attributes added to every span
        attributes: { "service.layer": "api" },
      },
    },
  }),
);
```

One span per step of a run. Every span carries `procedure.type`, `procedure.name`, the `attributes` from the action's or procedure's `tracing` config, and `sentry.op` set to `procedure.<type>`, which Sentry reads as the operation and other backends ignore. The span name is the action's or procedure's `tracing.name`, falling back to its name.

| type         | wraps                                           | extra attributes                           |
| ------------ | ----------------------------------------------- | ------------------------------------------ |
| `action`     | one `action.handle()` or `action.run()` call    |                                            |
| `middleware` | one procedure handler run                       | `procedure.cache.hit` or `procedure.cache` |
| `handler`    | the action's own handler, after its middlewares |                                            |
| `input`      | input validation in `action.run()`              |                                            |
| `output`     | output validation in `action.run()`             |                                            |

Spans always end, also when the step throws. An unexpected error or a 5xx `ApiError` records the exception and sets the span status to error. A 4xx `ApiError` is an expected outcome and only sets `procedure.error.reason` and `procedure.error.status`.

`configureTracing(options | boolean)` is what the plugin calls. It is exported for running actions outside Elysia, in scripts or queue workers. It configures the package globally and the last call wins, which is one more reason to mount `procedures()` once.

## Type-checking performance

The builder chain keeps the type checker's work per action small. Schema constraints are checked structurally instead of against `TObject`, which would evaluate every schema's static type twice. Schemas are only re-wrapped when there is something to merge. `onError` is one generic signature resolved per call instead of one overload per table entry. With around 250 actions the library itself accounts for well under half a million type instantiations.

The dominant cost in a large server is Elysia's own route typing, which grows faster than linearly with the number of routes registered on one instance. When `tsc`, ESLint or the editor get slow, split the registrations into sub-apps and mount those on the main app. The sub-apps need nothing extra. `procedures()` on the root covers them at runtime, and `action.docs` typechecks on any instance.

```typescript
const products = new Elysia({ prefix: "/products" })
  .get("/:productId", getProductAction.handle, getProductAction.docs)
  .post(
    "/:productId/update",
    updateProductAction.handle,
    updateProductAction.docs,
  );

const orders = new Elysia({ prefix: "/orders" }).get(
  "/",
  listOrdersAction.handle,
  listOrdersAction.docs,
);

const app = new Elysia()
  .use(procedures())
  .use(products)
  .use(orders)
  .listen(3000);
```

In a benchmark with 500 actions registered with `.handle` and `.docs`, moving from one chain to sub-apps of 25 routes cut the checker from 6.6M to 3.6M type instantiations and peak memory from 1.1GB to 0.8GB. Put the sub-apps in separate files and the editor only re-checks the file you are editing.

## Acknowledgments

- [Elysia](https://elysiajs.com/) - The fast, and friendly Bun web framework
- [TypeBox](https://github.com/sinclairzx81/typebox) - JSON Schema Type Builder with Static Type Resolution
- [tRPC](https://trpc.io/) - End-to-end typesafe APIs made easy, inspiration for the procedure patterns
- [ZSA](https://zsa.vercel.app/) - Validation library that inspired aspects of the middleware approach
