// import dependencies
import { describe, test, expect, mock } from 'bun:test'
import { Type } from '@sinclair/typebox'
import { createProcedure } from '@/procedure'

describe('Basic Procedure Creation', () => {
	test('should create a procedure with name', () => {
		const procedure = createProcedure('Test Procedure').build()
		expect(procedure).toBeDefined()
		expect(procedure.middlewares).toHaveLength(0)
	})

	test('should add handler as middleware', () => {
		const procedure = createProcedure('Test Procedure')
			.build(() => ({ userId: '123' }))

		expect(procedure.middlewares).toHaveLength(1)
		expect(procedure.middlewares[0]?.name).toBe('Test Procedure')
		expect(procedure.middlewares[0]?.execute).toBeFunction()
	})
})

describe('Procedure Schema Configuration', () => {
	test('should define params schema', () => {
		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.String() }))
			.build()

		expect(procedure.params).toBeDefined()
		expect(procedure.params.properties.id.type).toBe('string')
	})

	test('should merge multiple params schemas', () => {
		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.String() }))
			.params(Type.Object({ name: Type.String() }))
			.build()

		expect(procedure.params.properties.id).toBeDefined()
		expect(procedure.params.properties.id.type).toBe('string')
		expect(procedure.params.properties.name).toBeDefined()
		expect(procedure.params.properties.name.type).toBe('string')
	})

	test('should define query schema', () => {
		const procedure = createProcedure('Test Procedure')
			.query(Type.Object({ page: Type.Number() }))
			.build()

		expect(procedure.query).toBeDefined()
		expect(procedure.query.properties.page.type).toBe('number')
	})

	test('should define body schema', () => {
		const procedure = createProcedure('Test Procedure')
			.body(Type.Object({ data: Type.String() }))
			.build()

		expect(procedure.body).toBeDefined()
		expect(procedure.body.properties.data.type).toBe('string')
	})

	test('should handle objects in body', () => {
		const procedure = createProcedure('Test Procedure')
			.body(Type.Object({ data: Type.Object({ name: Type.String() }) }))
			.build()

		expect(procedure.body).toBeDefined()
		expect(procedure.body.properties.data.type).toBe('object')
		expect(procedure.body.properties.data.properties.name.type).toBe('string')
	})

	test('should handle undefined schemas', () => {
		const procedure = createProcedure('Test Procedure')
			.build()

		expect(procedure.params).toBeUndefined()
		expect(procedure.query).toBeUndefined()
		expect(procedure.body).toBeUndefined()
	})
})

describe('Middleware Execution', () => {
	test('should execute middleware with correct arguments', async () => {
		const mockHandler = mock(() => ({ processed: true }))

		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.String() }))
			.build(mockHandler)

		const input = {
			ctx: { request: new Request('https://example.com') },
			params: { id: '123' },
			query: undefined,
			body: undefined
		}

		const result = await procedure.middlewares[0]?.execute(input)

		expect(mockHandler).toHaveBeenCalledTimes(1)
		expect(mockHandler).toHaveBeenCalledWith(input)
		expect(result).toEqual({ processed: true })
	})
})

describe('Chained Procedures', () => {
	test('should inherit schemas from base procedure', () => {
		const baseProcedure = createProcedure('Base Procedure')
			.params(Type.Object({ id: Type.String() }))
			.query(Type.Object({ sort: Type.String() }))
			.body(Type.Object({ title: Type.String() }))
			.build()

		const derivedProcedure = createProcedure('Derived Procedure', baseProcedure)
			.build()

		expect(derivedProcedure.params.properties.id.type).toBe('string')
		expect(derivedProcedure.query.properties.sort.type).toBe('string')
		expect(derivedProcedure.body.properties.title.type).toBe('string')
	})

	test('should merge schemas with base procedure', () => {
		const baseProcedure = createProcedure('Base Procedure')
			.params(Type.Object({ id: Type.String() }))
			.build()

		const derivedProcedure = createProcedure('Derived Procedure', baseProcedure)
			.params(Type.Object({ name: Type.String() }))
			.build()

		expect(derivedProcedure.params.properties.id.type).toBe('string')
		expect(derivedProcedure.params.properties.name.type).toBe('string')
	})

	test('should inherit middlewares from base procedure', () => {
		const baseProcedure = createProcedure('Base Procedure')
			.build(() => ({ user: { id: '123' } }))

		const derivedProcedure = createProcedure('Derived Procedure', baseProcedure)
			.build(() => ({ role: 'admin' }))

		expect(derivedProcedure.middlewares).toHaveLength(2)
		expect(derivedProcedure.middlewares[0]?.name).toBe('Base Procedure')
		expect(derivedProcedure.middlewares[1]?.name).toBe('Derived Procedure')
	})

	test('should chain multiple middleware executions', async () => {
		const baseHandler = mock(({ params }) => ({
			user: { id: params.id }
		}))

		const derivedHandler = mock(({ ctx }) => ({
			permissions: ['read', 'write'],
			count: ctx.user.id.length
		}))

		const baseProcedure = createProcedure('Base Procedure')
			.params(Type.Object({ id: Type.String() }))
			.build(baseHandler)

		const derivedProcedure = createProcedure('Derived Procedure', baseProcedure)
			.build(derivedHandler)

		// simulate middleware chain execution
		const input = {
			ctx: { request: new Request('https://example.com') },
			params: { id: '123' },
			query: undefined,
			body: undefined
		}

		// execute first middleware
		const firstResult = await derivedProcedure.middlewares[0]?.execute(input)
		expect(firstResult).toEqual({ user: { id: '123' } })

		// execute second middleware with updated context
		const secondInput = {
			...input,
			ctx: { ...input.ctx, ...firstResult }
		}

		const secondResult = await derivedProcedure.middlewares[1]?.execute(secondInput)

		expect(secondResult).toEqual({
			permissions: ['read', 'write'],
			count: 3
		})

		expect(baseHandler).toHaveBeenCalledTimes(1)
		expect(baseHandler).toHaveBeenCalledWith(input)
		expect(derivedHandler).toHaveBeenCalledTimes(1)
		expect(derivedHandler).toHaveBeenCalledWith(secondInput)
	})
})