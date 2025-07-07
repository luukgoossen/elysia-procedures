// import dependencies
import { describe, test, expect, mock } from 'bun:test'
import { Type } from '@sinclair/typebox'
import { createProcedure } from '@/procedure'

describe('Action Builder', () => {
	test('should create action with name', () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure.createAction('Test Action').build(() => { })

		expect(action).toBeDefined()
		expect(action.name).toBe('Test Action')
	})

	test('should set action details', () => {
		const procedure = createProcedure('Test Procedure').build()
		const details = { description: 'Test action description' }
		const action = procedure.createAction('Test Action', details).build(() => { })

		expect(action.details).toEqual(details)
	})

	test('should create action with OpenAPI documentation', () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure.createAction('Test Action', {
			description: 'Test action description'
		}).build(() => { })

		const docs = action.docs
		expect(docs).toBeDefined()
		expect(docs.detail?.summary).toBe('Test Action')
		expect(docs.detail?.description).toBe('Test action description')
	})
})

describe('Action Schema Configuration', () => {
	test('should define params schema on action', () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure
			.createAction('Test Action')
			.params(Type.Object({ id: Type.String() }))
			.build(() => { })

		expect(action.params).toBeDefined()
		expect(action.params.properties.id.type).toBe('string')
		expect(action.docs.params).toBeDefined()
		expect(action.docs.params.properties.id.type).toBe('string')
	})

	test('should inherit params from procedure', () => {
		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.String() }))
			.build()

		const action = procedure
			.createAction('Test Action')
			.build(() => { })

		expect(action.params).toBeDefined()
		expect(action.params.properties.id.type).toBe('string')
	})

	test('should merge params from procedure with action params', () => {
		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.String() }))
			.build()

		const action = procedure
			.createAction('Test Action')
			.params(Type.Object({ name: Type.String() }))
			.build(() => { })

		expect(action.params.properties.id.type).toBe('string')
		expect(action.params.properties.name.type).toBe('string')
	})

	test('should define query schema on action', () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure
			.createAction('Test Action')
			.query(Type.Object({ sort: Type.String() }))
			.build(() => { })

		expect(action.query).toBeDefined()
		expect(action.query.properties.sort.type).toBe('string')
		expect(action.docs.query).toBeDefined()
	})

	test('should define body schema on action', () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure
			.createAction('Test Action')
			.body(Type.Object({ payload: Type.Object({ data: Type.String() }) }))
			.build(() => { })

		expect(action.body).toBeDefined()
		expect(action.body.properties.payload.type).toBe('object')
		expect(action.body.properties.payload.properties.data.type).toBe('string')
		expect(action.docs.body).toBeDefined()
	})

	test('should define output schema on action', () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure
			.createAction('Test Action')
			.output(Type.Object({ result: Type.Boolean() }))
			.build(() => ({ result: true }))

		expect(action.output).toBeDefined()
		expect(action.output.properties.result.type).toBe('boolean')
		expect(action.docs.response).toBeDefined()
	})

	test('should not allow action schema to redefine procedure schema properties', () => {
		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.String() }))
			.build()

		const action = procedure
			.createAction('Test Action')
			// @ts-expect-error we want this test to cause a type error
			.params(Type.Object({ id: Type.Number() }))
			.build(() => { })

		// @ts-expect-error we want this test to cause a type error
		expect(action.params.properties.id.type).toBe('string')
		expect(action.docs.params.properties.id.type).toBe('string')
	})

	test('should chain multiple schema definitions', () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure
			.createAction('Test Action')
			.params(Type.Object({ id: Type.String() }))
			.query(Type.Object({ sort: Type.String() }))
			.body(Type.Object({ data: Type.String() }))
			.output(Type.Object({ result: Type.Boolean() }))
			.build(() => ({ result: true }))

		expect(action.params).toBeDefined()
		expect(action.query).toBeDefined()
		expect(action.body).toBeDefined()
		expect(action.output).toBeDefined()
	})

	test('should handle undefined schemas', () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure.createAction('Test Action').build(() => { })

		expect(action.params).toBeUndefined()
		expect(action.query).toBeUndefined()
		expect(action.body).toBeUndefined()
		expect(action.output).toBeUndefined()
	})
})

describe('Action Execution', () => {
	test('should handle action execution with handler', async () => {
		const mockHandler = mock(({ params }) => ({ result: params.id }))

		const procedure = createProcedure('Test Procedure').build()
		const action = procedure
			.createAction('Test Action')
			.params(Type.Object({ id: Type.String() }))
			.build(mockHandler)

		const result = await action.handle({
			request: new Request('https://example.com'),
			cookie: {},
			params: { id: '123' },
			query: undefined,
			body: undefined
		})

		expect(mockHandler).toHaveBeenCalledTimes(1)
		expect(result).toEqual({ result: '123' })
	})

	test('should run middlewares before handler', async () => {
		const middleware = mock(({ params }) => ({ user: { id: params.id } }))
		const handler = mock(({ ctx }) => ({ result: ctx.user.id }))

		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.String() }))
			.build(middleware)

		const action = procedure
			.createAction('Test Action')
			.build(handler)

		const result = await action.handle({
			request: new Request('https://example.com'),
			cookie: {},
			params: { id: '123' },
			query: undefined,
			body: undefined
		})

		expect(middleware).toHaveBeenCalledTimes(1)
		expect(handler).toHaveBeenCalledTimes(1)
		expect(result).toEqual({ result: '123' })
	})
})

describe('Input and Output Validation', () => {
	test('should validate input parameters', async () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure
			.createAction('Test Action')
			.params(Type.Object({
				id: Type.String(),
				count: Type.Number()
			}))
			.build(({ params }) => ({ result: `${params.id}-${params.count}` }))

		const input = {
			params: {
				id: '123',
				count: 42
			},
			query: undefined,
			body: undefined
		}

		const result = await action.run({
			request: new Request('https://example.com'),
			cookie: {}
		}, input)
		expect(result).toEqual({ result: '123-42' })

		// invalid parameter should throw
		const invalidInput = {
			params: {
				id: '123',
				count: 'not-a-number' // should be a number
			},
			query: undefined,
			body: undefined
		}

		await expect(action.run({
			request: new Request('https://example.com'),
			cookie: {}
		// @ts-expect-error we want this test to cause a type error
		}, invalidInput))
			.rejects.toThrow()
	})

	test('should validate and clean output', async () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure
			.createAction('Test Action')
			.output(Type.Object({
				result: Type.Boolean(),
				count: Type.Number()
			}))
			.build(() => ({
				result: true,
				count: 42,
				// this field should be removed by the output validation
				extraField: 'should be removed'
			}))

		const result = await action.run({
			request: new Request('https://example.com'),
			cookie: {}
		}, {
			params: undefined,
			query: undefined,
			body: undefined
		})

		expect(result).toEqual({ result: true, count: 42 })
		expect(result).not.toHaveProperty('extraField')
	})

	test('should throw when output validation fails', async () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure
			.createAction('Test Action')
			.output(Type.Object({
				result: Type.Boolean(),
				count: Type.Number()
			}))
			.build(() => ({
				// @ts-expect-error we want this test to cause a type error
				result: 'not a boolean',
				count: 42
			}))

		await expect(action.run({
			request: new Request('https://example.com'),
			cookie: {}
		}, {
			params: undefined,
			query: undefined,
			body: undefined
		})).rejects.toThrow()
	})
})

describe('Action with complex schemas', () => {
	test('should handle complex nested schemas', async () => {
		const userSchema = Type.Object({
			id: Type.String(),
			profile: Type.Object({
				name: Type.String(),
				age: Type.Number(),
				active: Type.Boolean()
			})
		})

		const procedure = createProcedure('Test Procedure').build()
		const action = procedure
			.createAction('Test Action')
			.body(userSchema)
			.output(Type.Object({
				success: Type.Boolean(),
				user: userSchema
			}))
			.build(({ body }) => ({
				success: true,
				user: body
			}))

		const userData = {
			id: 'user123',
			profile: {
				name: 'John Doe',
				age: 30,
				active: true
			}
		}

		const result = await action.run({
			request: new Request('https://example.com'),
			cookie: {}
		}, {
			params: {},
			query: {},
			body: userData
		})

		expect(result).toEqual({
			success: true,
			user: userData
		})
	})
})

describe('Action documentation', () => {
	test('should generate documentation with all schemas', () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure
			.createAction('Complex Action', { description: 'A complex action with many schemas' })
			.params(Type.Object({ id: Type.String() }))
			.query(Type.Object({ filter: Type.String() }))
			.body(Type.Object({ data: Type.Object({ name: Type.String() }) }))
			.output(Type.Object({ result: Type.Boolean() }))
			.build(() => ({ result: true }))

		const docs = action.docs

		expect(docs.params).toBeDefined()
		expect(docs.query).toBeDefined()
		expect(docs.body).toBeDefined()
		expect(docs.response).toBeDefined()
		expect(docs.detail).toBeDefined()
		expect(docs.detail?.summary).toBe('Complex Action')
		expect(docs.detail?.description).toBe('A complex action with many schemas')
	})
})