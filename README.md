# Elysia Procedures

A type-safe, composable procedure builder for [Elysia](https://elysiajs.com/) applications. Build robust API endpoints with middleware support, input validation, and full TypeScript support. Inspired by tRPC's procedure pattern for end-to-end type safety.

## Features

- 🔒 **Type-safe** - Full TypeScript support with inferred types
- ✅ **Validation** - Built-in schema validation using TypeBox
- 🧩 **Composable** - Create reusable procedures and middleware
- 📚 **Documentation** - Co-locate your OpenAPI documentation with the handlers
- 🔗 **tRPC-style** - Familiar procedure-based patterns for type-safe APIs

## Installation

```bash
# Using npm
npm install elysia-procedures

# Using yarn
yarn add elysia-procedures

# Using pnpm
pnpm add elysia-procedures

# Using bun
bun add elysia-procedures
```

## Quick Start

```typescript
import { Elysia } from 'elysia';
import { createProcedure } from 'elysia-procedures';
import { Type } from '@sinclair/typebox';

// Create an authentication middleware procedure
const authProcedure = createProcedure('Ensure Auth')
  .build(async ({ ctx }) => {
    // Check auth header
    const authHeader = ctx.request.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Unauthorized');
    }
    
    // Return user data to be added to context
    return {
      user: {
        id: '123',
        name: 'John Doe',
        role: 'admin'
      }
    };
  });

// Create a procedure that requires authentication
const userProcedure = createProcedure('With User Profile', authProcedure)
  .params(Type.Object({
    userId: Type.String()
  }))
  .query(Type.Object({
    include: Type.Optional(Type.String())
  }))
  .build(({ ctx, params, query }) => {
    // ctx.user is available because of the auth middleware
    console.log(`User ${ctx.user.name} is accessing profile ${params.userId}`);
    
    return {
      success: true
    };
  });

// Create an API endpoint action with our procedure
const getUserAction = userProcedure.createAction('Get User')
  .output(Type.Object({
    id: Type.String(),
    name: Type.String(),
    email: Type.String(),
    role: Type.String()
  }))
  .build(({ ctx, params }) => {
    // Fetch user data based on params.userId
    return {
      id: params.userId,
      name: 'Jane Doe',
      email: 'jane@example.com',
      role: 'user'
    };
  });

// Use with Elysia
const app = new Elysia()
  .get('/users/:userId', ({ request, params, query }) => {
    return getUserAction.handle({ request, params, query, body: undefined });
  }, getUserAction.docs)
  .listen(3000);

console.log('Server running on http://localhost:3000');
```

## Usage

### Creating a Basic Procedure

A procedure is a reusable foundation for your API endpoints. It can define common parameters, validation schemas, and middleware.

```typescript
import { createProcedure } from 'elysia-procedures';
import { Type } from '@sinclair/typebox';

// Create a basic procedure
const baseProcedure = createProcedure('Basic Procedure')
  .build(({ ctx }) => {
    console.log('Request received:', ctx.request.url);
    return { requestTime: new Date() };
  });
```

### Adding Schema Validation

You can add TypeBox schemas to validate parameters, query strings, and request bodies:

```typescript
const productProcedure = createProcedure('Ensure Product', baseProcedure)
  .params(Type.Object({
    productId: Type.String()
  }))
  .query(Type.Object({
    currency: Type.Optional(Type.String({ default: 'USD' })),
    format: Type.Optional(Type.Enum({ json: 'json', xml: 'xml' }))
  }))
  .body(Type.Object({
    includeDetails: Type.Boolean()
  }))
  .build(({ params, query, body, ctx }) => {
    // All inputs are validated and typed
    console.log(`Fetching product ${params.productId} in ${query.currency} format`);
    
    return {
      productDetails: true
    };
  });
```

### Creating Actions

Actions represent the actual API endpoints built from procedures:

```typescript
const getProductAction = productProcedure.createAction('Get Product')
  .output(Type.Object({
    id: Type.String(),
    name: Type.String(),
    price: Type.Number(),
    details: Type.Optional(Type.Object({
      description: Type.String(),
      specifications: Type.Array(Type.String())
    }))
  }))
  .build(({ params, query, body, ctx }) => {
    // Fetch product from database
    return {
      id: params.productId,
      name: 'Amazing Product',
      price: 99.99,
      details: body.includeDetails ? {
        description: 'This is an amazing product',
        specifications: ['Spec 1', 'Spec 2']
      } : undefined
    };
  });
```

### Integrating with Elysia

```typescript
import { Elysia } from 'elysia';

const app = new Elysia()
  .get('/products/:productId', getProductAction.handle, { ...getProductAction.docs, tags: ['Product'] })
  .post('/products/:productId/update', updateProductAction.handle, { ...updateProductAction.docs, tags: ['Product'] })
  .listen(3000);
```

## Acknowledgments

- [Elysia](https://elysiajs.com/) - The fast, and friendly Bun web framework
- [TypeBox](https://github.com/sinclairzx81/typebox) - JSON Schema Type Builder with Static Type Resolution
- [tRPC](https://trpc.io/) - End-to-end typesafe APIs made easy, inspiration for the procedure patterns
- [ZSA](https://github.com/fabian-hiller/zsa) - Validation library that inspired aspects of the middleware approach
