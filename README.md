# Elysia Procedures

A type-safe, composable procedure builder for [Elysia](https://elysiajs.com) with [TypeBox](https://github.com/sinclairzx81/typebox) validation. Build robust API endpoints with reusable middleware, input validation, and full TypeScript support. Inspired by tRPC's procedure pattern for end-to-end type safety.

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
  - [The `problems()` plugin](#the-problems-plugin)
  - [Wire contract](#wire-contract)
  - [OpenAPI](#openapi)
- [Telemetry](#telemetry)
- [Type-checking performance](#type-checking-performance)
- [Acknowledgments](#acknowledgments)

## Features

- 🥇 **Elysia** - First class integration with the Elysia framework
- 🔒 **Type-safe** - Full TypeScript support with inferred types
- ✅ **Validation** - Built-in schema validation using TypeBox
- 🧩 **Composable** - Create reusable procedures and middleware
- 📚 **Documentation** - Co-locate your OpenAPI documentation with the handlers
- 💾 **Caching** - Dependency-based request-level caching
- 🚨 **Errors** - Typed error tables, RFC 9457 `application/problem+json` responses and a safe Sentry policy
- 🔗 **tRPC-style** - Familiar procedure-based patterns for type-safe APIs

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
const authProcedure = createProcedure("Ensure Auth").build(async ({ ctx }) => {
  // Check auth header
  const authHeader = ctx.request.headers.get("Authorization");
  if (!authHeader) {
    throw new Error("Unauthorized");
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

A procedure is a reusable foundation for your API endpoints. It can define common parameters, validation schemas, and middleware.

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

You can add TypeBox schemas to validate parameters, query strings, and request bodies:

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

Actions represent the actual API endpoints built from procedures:

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

This library has first class support for integrating with the Elysia framework through the action.handle function, which expects an Elysia context, and action.docs which returns Elysia-formatted documentation defining the input and output schemas in a type-safe way.

It also hooks into Elysia's OpenTelemetry plugin to add tracing to procedure and action runs, providing step by step information about the executed chain.

```typescript
import { Elysia } from "elysia";

const app = new Elysia()
  .get("/products/:productId", getProductAction.handle, getProductAction.docs)
  .post(
    "/products/:productId/update",
    updateProductAction.handle,
    updateProductAction.docs,
  )
  .listen(3000);
```

## Caching

This library supports request-level caching to ensure that procedures are executed only once per http request. To enable caching for a procedure, you can supply an array of dependencies to the procedure builder.

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

Any array will enable caching for the procedure, but if input variables might change between different calls to the same procedure for the same request, it is important to include their keys in the array.

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

Errors are a first-class part of a procedure chain. You declare an **error table** once, throw errors through the typed `onError` factory injected into every handler, and let the `problems()` plugin turn everything that escapes a route into an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` response.

The package has no opinion on reason names, status mapping or metadata shape; it only provides the mechanics.

### Declaring errors

Errors live in the `config` of `createProcedure` (and in the `details` of `createAction`). Tables are merged **by key** down the chain: the child wins, and the `type` function is inherited when the child does not set one.

```typescript
import { createProcedure } from "@luukgoossen/elysia-procedures";
import { Type } from "@sinclair/typebox";

const baseProcedure = createProcedure("Base", undefined, {
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

Each entry has a `status`, an optional TypeBox `metadata` schema (required when calling `onError` if present), and an optional `title` / `detail` that is either a string or a function of the validated metadata. Inside a plain object literal the metadata parameter of those functions must be annotated; wrap the entry in `defineError(...)` to have it inferred from the schema:

```typescript
import { defineError } from "@luukgoossen/elysia-procedures";

NOT_FOUND: defineError({
  status: 404,
  metadata: Type.Object({ entity: Type.String() }),
  title: (m) => `${m.entity} not found`, // m is { entity: string }
}),
```

Four entries are always present, callable from every handler, and can be overridden by key but not removed: `INTERNAL` (500), `INVALID_INPUT` (422), `MALFORMED_REQUEST` (400) and `NOT_FOUND` (404). The plugin uses them for failures that are not `ApiError`s.

Keep `status` values literal (inline object literals or `defineError`) so the documented response statuses stay typed; a table stored in a variable without `as const` widens them to `number`.

### Throwing errors

Every handler and middleware receives `onError` as its **second argument**. It is typed from the effective table: unknown reasons do not compile, and metadata is required exactly when the entry declares a schema.

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

`onError(reason, metadata?, options?)` returns an `ApiError` with public `status`, `reason`, `metadata`, `title`, `detail`, `type` and `cause`; you throw it. Copy is resolved as `options` → entry function or string → fallback (`title` is the reason in Title Case, no `detail`). Passing metadata that does not match the schema throws a plain `TypeError`, since that is a programming error rather than an API error.

### The `problems()` plugin

Mount the plugin **once, on the root app, before any sub-apps**. It registers the `Problem` and `ValidationProblem` models that `action.docs` reference and a global `onError` hook that serializes every failure. Elysia applies global hooks to every route registered after them, at any nesting depth, so sub-apps need nothing; a sub-app `.use()`d *before* the plugin is not covered.

```typescript
import { Elysia } from "elysia";
import { problems } from "@luukgoossen/elysia-procedures";

const app = new Elysia()
  .use(
    problems({
      // report 4xx ApiErrors to Sentry as messages: "off" (default) | "warn" | "all"
      captureClientErrors: "off",
      // same shape as the procedure config; used for the problems the plugin builds itself
      errors: { type: (reason) => `https://example.com/docs/errors/${reason}` },
      // max characters of a field's `received` value echoed back; default 200
      receivedMaxLength: 200,
      // override logging; default console.warn for 4xx and console.error for 5xx
      log: (level, fields) => logger[level](fields),
    }),
  )
  .get("/videos/:id", getVideo.handle, getVideo.docs)
  .listen(3000);
```

| thrown                                         | status     | Sentry                                             | body                                           |
| ---------------------------------------------- | ---------- | -------------------------------------------------- | ---------------------------------------------- |
| `ApiError` < 500                               | its status | none unless `captureClientErrors` is on            | the error's problem                            |
| `ApiError` >= 500                              | its status | `captureException` (the `cause` chain is reported) | the error's problem with a `reference`         |
| Elysia validation error                        | 422        | none                                               | `INVALID_INPUT` with per-field `errors`        |
| Elysia parse error or invalid cookie signature | 400        | none                                               | `MALFORMED_REQUEST`                            |
| Elysia invalid file type                       | 422        | none                                               | `INVALID_INPUT` with one field error           |
| unknown route                                  | 404        | none                                               | `NOT_FOUND`                                    |
| redirects, thrown `Response`s, `status(...)`   | as is      | none                                               | untouched                                      |
| anything else                                  | 500        | `captureException`                                 | `INTERNAL` with default copy and a `reference` |

Sentry is loaded through a dynamic import of `@sentry/bun` and skipped when it is not installed. Every branch logs a structured line `{ status, reason, instance, method, reference?, message? }`; the raw `message` only ever appears in the log.

Without the plugin nothing fails loudly, but you lose the contract: a thrown `ApiError` becomes a plain-text response with the right status, an unexpected `Error` is answered with its raw message (Elysia's default), validation failures use Elysia's own JSON shape, and the OpenAPI spec references `Problem` schemas that are never emitted. The `.get(path, action.handle, action.docs)` pattern above assumes the plugin is mounted.

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
  "reference": "8c1f4d2e…" // Sentry event id, only when captured
}
```

Validation failures (422) are a `ValidationProblem`: the same members plus a required `errors` array with one entry per invalid value. `in` uses the OpenAPI location vocabulary (`body`, `path`, `query`, `header`, `cookie`) and `pointer` is a JSON pointer fragment within that location, so clients never need to parse strings:

```jsonc
{
  "type": "about:blank",
  "title": "Invalid input",
  "status": 422,
  "detail": "2 fields are invalid: body.name, body.tags[1]",
  "instance": "/videos",
  "reason": "INVALID_INPUT",
  "errors": [
    { "in": "body", "pointer": "#/name", "detail": "Expected string length greater or equal to 3", "received": "\"\"" },
    { "in": "body", "pointer": "#/tags/1", "detail": "Expected string", "received": "1" }
  ]
}
```

`title` and `detail` never contain raw exception messages for unexpected errors, `cause` never serializes, and `received` is omitted when any segment of the pointer matches `/password|secret|token|key/i` or the value has no JSON form (missing properties, files), and truncated to `receivedMaxLength` characters otherwise. A response that fails the action's output schema is a server bug, not a client error: it is reported and answered with a 500 `INTERNAL` problem rather than a 422.

### OpenAPI

`action.docs.response` is keyed by status: `200` holds the output schema when one is defined, `422` references the `ValidationProblem` model, and every other status in the effective table (plus 500) references the shared `Problem` model. With `@elysiajs/openapi` this yields `components.schemas.Problem`, `components.schemas.ValidationProblem` and a `$ref` per documented status. `ApiError`, `Problem` and `ValidationProblem` are exported if you need to map problems onto other transports.

## Telemetry

This package supports telemetry tracing. Both `@sentry/bun` and `@elysiajs/opentelemetry` are defined as optional peer dependencies. If either one is installed, telemetry traces will be made available. If both are installed, `@sentry/bun` takes priority over `@elysiajs/opentelemetry`.

## Type-checking performance

The builder chain is designed to keep the type checker's work per action small: schema constraints are checked structurally instead of against `TObject` (which would evaluate every schema's static type twice), schemas are only re-wrapped when there is something to merge, and `onError` is a single generic signature resolved per call instead of one overload per table entry. With ~250 actions the library itself accounts for well under half a million type instantiations.

The dominant cost in a large server is Elysia's own route typing, which grows faster than linearly with the number of routes registered on **one** instance. When `tsc`, ESLint or the editor become slow, split the registrations into sub-apps and mount them on the main app. Each sub-app needs `problems()` as well so the `Problem` response models resolve; the plugin is named, so Elysia deduplicates it and every error is still handled exactly once:

```typescript
const products = new Elysia({ prefix: "/products" })
  .use(problems())
  .get("/:productId", getProductAction.handle, getProductAction.docs)
  .post("/:productId/update", updateProductAction.handle, updateProductAction.docs);

const orders = new Elysia({ prefix: "/orders" })
  .use(problems())
  .get("/", listOrdersAction.handle, listOrdersAction.docs);

const app = new Elysia().use(problems()).use(products).use(orders).listen(3000);
```

In a benchmark with 500 actions registered with `.handle` and `.docs`, moving from one chain to sub-apps of 25 routes cut the checker from 6.6M to 3.6M type instantiations and peak memory from 1.1GB to 0.8GB. Splitting the sub-apps over several files additionally lets the editor re-check only the file being edited.

## Acknowledgments

- [Elysia](https://elysiajs.com/) - The fast, and friendly Bun web framework
- [TypeBox](https://github.com/sinclairzx81/typebox) - JSON Schema Type Builder with Static Type Resolution
- [tRPC](https://trpc.io/) - End-to-end typesafe APIs made easy, inspiration for the procedure patterns
- [ZSA](https://zsa.vercel.app/) - Validation library that inspired aspects of the middleware approach
