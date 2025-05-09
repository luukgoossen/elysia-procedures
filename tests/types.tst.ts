// import dependencies
import { describe, test, expect } from 'tstyche'
import { Type } from '@sinclair/typebox'
import { createProcedure } from '../src/procedure'

// import types
import type { Procedure } from '../src/procedure'
import type { Action } from '../src/action'
import type { TObject, TString, TNumber } from '@sinclair/typebox'

describe('Basic Procedure Type Inference', () => {
	test('should infer a plain procedure', () => {
		const procedure = createProcedure('Test Procedure')
			.build(({ ctx, params, query, body }) => {
				expect(ctx).type.toBe<{ request: Request }>()
				expect(params).type.toBeUndefined()
				expect(query).type.toBeUndefined()
				expect(body).type.toBeUndefined()
			})

		expect(procedure).type.toBe<Procedure<{ request: Request }, undefined, undefined, undefined>>()
		expect(procedure.params).type.toBeUndefined()
		expect(procedure.query).type.toBeUndefined()
		expect(procedure.body).type.toBeUndefined()
	})

	test('should infer a procedure with params', () => {
		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.String() }))
			.build(({ ctx, params, query, body }) => {
				expect(ctx).type.toBe<{ request: Request }>()
				expect(params).type.toBe<{ id: string }>()
				expect(query).type.toBeUndefined()
				expect(body).type.toBeUndefined()
			})

		expect(procedure).type.toBe<Procedure<{ request: Request }, TObject<{ id: TString }>, undefined, undefined>>()
		expect(procedure.params).type.toBe<TObject<{ id: TString }>>()
		expect(procedure.query).type.toBeUndefined()
		expect(procedure.body).type.toBeUndefined()
	})

	test('should infer a procedure with query', () => {
		const procedure = createProcedure('Test Procedure')
			.query(Type.Object({ page: Type.Number() }))
			.build(({ ctx, params, query, body }) => {
				expect(ctx).type.toBe<{ request: Request }>()
				expect(params).type.toBeUndefined()
				expect(query).type.toBe<{ page: number }>()
				expect(body).type.toBeUndefined()
			})

		expect(procedure).type.toBe<Procedure<{ request: Request }, undefined, TObject<{ page: TNumber }>, undefined>>()
		expect(procedure.params).type.toBeUndefined()
		expect(procedure.query).type.toBe<TObject<{ page: TNumber }>>()
		expect(procedure.body).type.toBeUndefined()
	})

	test('should infer a procedure with body', () => {
		const procedure = createProcedure('Test Procedure')
			.body(Type.Object({ data: Type.String() }))
			.build(({ ctx, params, query, body }) => {
				expect(ctx).type.toBe<{ request: Request }>()
				expect(params).type.toBeUndefined()
				expect(query).type.toBeUndefined()
				expect(body).type.toBe<{ data: string }>()
			})

		expect(procedure).type.toBe<Procedure<{ request: Request }, undefined, undefined, TObject<{ data: TString }>>>()
		expect(procedure.params).type.toBeUndefined()
		expect(procedure.query).type.toBeUndefined()
		expect(procedure.body).type.toBe<TObject<{ data: TString }>>()
	})

	test('should infer a procedure with all schemas', () => {
		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.String() }))
			.query(Type.Object({ page: Type.Number() }))
			.body(Type.Object({ data: Type.String() }))
			.build(({ ctx, params, query, body }) => {
				expect(ctx).type.toBe<{ request: Request }>()
				expect(params).type.toBe<{ id: string }>()
				expect(query).type.toBe<{ page: number }>()
				expect(body).type.toBe<{ data: string }>()
			})

		expect(procedure).type.toBe<Procedure<{ request: Request }, TObject<{ id: TString }>, TObject<{ page: TNumber }>, TObject<{ data: TString }>>>()
		expect(procedure.params).type.toBe<TObject<{ id: TString }>>()
		expect(procedure.query).type.toBe<TObject<{ page: TNumber }>>()
		expect(procedure.body).type.toBe<TObject<{ data: TString }>>()
	})

	test('should infer a procedure with chained params', () => {
		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.String() }))
			.params(Type.Object({ name: Type.String() }))
			.build(({ ctx, params, query, body }) => {
				expect(ctx).type.toBe<{ request: Request }>()
				expect(params).type.toBe<{ id: string, name: string }>()
				expect(query).type.toBeUndefined()
				expect(body).type.toBeUndefined()
			})

		expect(procedure).type.toBe<Procedure<{ request: Request }, TObject<{ id: TString, name: TString }>, undefined, undefined>>()
		expect(procedure.params).type.toBe<TObject<{ id: TString, name: TString }>>()
		expect(procedure.query).type.toBeUndefined()
		expect(procedure.body).type.toBeUndefined()
	})

	test('should handle complex objects in body', () => {
		const procedure = createProcedure('Test Procedure')
			.body(Type.Object({ data: Type.Object({ id: Type.String(), name: Type.String(), count: Type.Number() }) }))
			.build(({ ctx, params, query, body }) => {
				expect(ctx).type.toBe<{ request: Request }>()
				expect(params).type.toBeUndefined()
				expect(query).type.toBeUndefined()
				expect(body).type.toBe<{ data: { id: string, name: string, count: number } }>()
			})
		expect(procedure).type.toBe<Procedure<{ request: Request }, undefined, undefined, TObject<{ data: TObject<{ id: TString, name: TString, count: TNumber }> }>>>()
		expect(procedure.params).type.toBeUndefined()
		expect(procedure.query).type.toBeUndefined()
		expect(procedure.body).type.toBe<TObject<{ data: TObject<{ id: TString, name: TString, count: TNumber }> }>>()
	})

	test('should infer procedure return types', () => {
		const procedure = createProcedure('Test Procedure')
			.build(() => ({ processed: true }))

		expect(procedure).type.toBe<Procedure<{ request: Request, processed: boolean }, undefined, undefined, undefined>>()
	})
})

describe('Chained Procedure Type Inference', () => {
	test('should infer schemas from base procedure', () => {
		const baseProcedure = createProcedure('Base Procedure')
			.params(Type.Object({ id: Type.Number() }))
			.query(Type.Object({ sort: Type.String() }))
			.body(Type.Object({ title: Type.String() }))
			.build(() => ({ processed: true }))

		const derivedProcedure = createProcedure('Derived Procedure', baseProcedure)
			.build(({ ctx, params, query, body }) => {
				expect(ctx).type.toBe<{ request: Request, processed: boolean }>()
				expect(params).type.toBe<{ id: number }>()
				expect(query).type.toBe<{ sort: string }>()
				expect(body).type.toBe<{ title: string }>()
			})

		expect(derivedProcedure).type.toBe<Procedure<{ request: Request, processed: boolean }, TObject<{ id: TNumber }>, TObject<{ sort: TString }>, TObject<{ title: TString }>>>()
		expect(derivedProcedure.params).type.toBe<TObject<{ id: TNumber }>>()
		expect(derivedProcedure.query).type.toBe<TObject<{ sort: TString }>>()
		expect(derivedProcedure.body).type.toBe<TObject<{ title: TString }>>()
	})

	test('should merge schemas from base procedure with additional params', () => {
		const baseProcedure = createProcedure('Base Procedure')
			.params(Type.Object({ id: Type.Number() }))
			.build(() => ({ processed: true }))

		const derivedProcedure = createProcedure('Derived Procedure', baseProcedure)
			.params(Type.Object({ name: Type.String() }))
			.build(({ ctx, params, query, body }) => {
				expect(ctx).type.toBe<{ request: Request, processed: boolean }>()
				expect(params).type.toBe<{ id: number, name: string }>()
				expect(query).type.toBeUndefined()
				expect(body).type.toBeUndefined()
			})

		expect(derivedProcedure).type.toBe<Procedure<{ request: Request, processed: boolean }, TObject<{ id: TNumber, name: TString }>, undefined, undefined>>()
		expect(derivedProcedure.params).type.toBe<TObject<{ id: TNumber, name: TString }>>()
		expect(derivedProcedure.query).type.toBeUndefined()
		expect(derivedProcedure.body).type.toBeUndefined()
	})

	test('should merge and override procedure context', () => {
		const baseProcedure = createProcedure('Base Procedure')
			.build(() => ({
				user: { id: '123', name: 'John Doe' },
				processed: true
			}))

		const derivedProcedure = createProcedure('Derived Procedure', baseProcedure)
			.query(Type.Object({ page: Type.Number() }))
			.build(({ query }) => ({
				page: query.page,
				processed: 12,
			}))

		expect(derivedProcedure).type.toBe<Procedure<{
			request: Request
			user: {
				id: string
				name: string
			}
			page: number
			processed: number
		}, undefined, TObject<{ page: TNumber }>, undefined>>()
		expect(derivedProcedure.params).type.toBeUndefined()
		expect(derivedProcedure.query).type.toBe<TObject<{ page: TNumber }>>()
		expect(derivedProcedure.body).type.toBeUndefined()
	})

	test('should not allow overriding base procedure input', () => {
		const baseProcedure = createProcedure('Base Procedure')
			.params(Type.Object({ id: Type.Number() }))
			.build()

		const derivedProcedure = createProcedure('Derived Procedure', baseProcedure)
			// @ts-expect-error we want to test that this throws
			.params(Type.Object({ id: Type.String() }))
			.build(({ params }) => {
				expect(params).type.toBeNever()
			})

		expect(derivedProcedure).type.toBe<Procedure<{ request: Request }, never, undefined, undefined>>()
		expect(derivedProcedure.params).type.toBeNever()
		expect(derivedProcedure.query).type.toBeUndefined()
		expect(derivedProcedure.body).type.toBeUndefined()
	})
})

describe('Action Inference', () => {
	test('should infer a plain action', () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure.createAction('Test Action')
			.build(({ ctx, params, query, body }) => {
				expect(ctx).type.toBe<{ request: Request }>()
				expect(params).type.toBeUndefined()
				expect(query).type.toBeUndefined()
				expect(body).type.toBeUndefined()
			})

		expect(action).type.toBe<Action<{ request: Request }, undefined, undefined, undefined, undefined, void>>()
		expect(action.params).type.toBeUndefined()
		expect(action.query).type.toBeUndefined()
		expect(action.body).type.toBeUndefined()
	})

	test('should infer schemas from a procedure', () => {
		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.Number() }))
			.query(Type.Object({ sort: Type.String() }))
			.body(Type.Object({ title: Type.String() }))
			.build(() => ({ processed: true }))

		const action = procedure.createAction('Test Action')
			.output(Type.String())
			.build(({ ctx, params, query, body }) => {
				expect(ctx).type.toBe<{ request: Request, processed: boolean }>()
				expect(params).type.toBe<{ id: number }>()
				expect(query).type.toBe<{ sort: string }>()
				expect(body).type.toBe<{ title: string }>()

				return ''
			})

		expect(action).type.toBe<Action<{ request: Request, processed: boolean }, TObject<{ id: TNumber }>, TObject<{ sort: TString }>, TObject<{ title: TString }>, TString, string>>()
		expect(action.params).type.toBe<TObject<{ id: TNumber }>>()
		expect(action.query).type.toBe<TObject<{ sort: TString }>>()
		expect(action.body).type.toBe<TObject<{ title: TString }>>()
	})

	test('should merge schemas from a procedure with additional params', () => {
		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.Number() }))
			.build(() => ({ processed: true }))

		const action = procedure.createAction('Test Action')
			.params(Type.Object({ name: Type.String() }))
			.build(({ ctx, params, query, body }) => {
				expect(ctx).type.toBe<{ request: Request, processed: boolean }>()
				expect(params).type.toBe<{ id: number, name: string }>()
				expect(query).type.toBeUndefined()
				expect(body).type.toBeUndefined()
			})

		expect(action).type.toBe<Action<{ request: Request, processed: boolean }, TObject<{ id: TNumber, name: TString }>, undefined, undefined, undefined, void>>()
		expect(action.params).type.toBe<TObject<{ id: TNumber, name: TString }>>()
		expect(action.query).type.toBeUndefined()
		expect(action.body).type.toBeUndefined()
	})

	test('should not allow overriding a procedure input', () => {
		const procedure = createProcedure('Test Procedure')
			.params(Type.Object({ id: Type.Number() }))
			.build()

		const action = procedure.createAction('Test Action')
			// @ts-expect-error we want to test that this throws
			.params(Type.Object({ id: Type.String() }))
			.build(({ params }) => {
				expect(params).type.toBeNever()
			})

		expect(action).type.toBe<Action<{ request: Request }, never, undefined, undefined, undefined, void>>()
		expect(action.params).type.toBeNever()
		expect(action.query).type.toBeUndefined()
		expect(action.body).type.toBeUndefined()
	})

	test('should infer the action return type with handle', async () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure.createAction('Test Action')
			.build(() => {
				return { processed: true }
			})

		const result = await action.handle({
			request: new Request('https://example.com'),
			params: { id: '123' },
			query: undefined,
			body: undefined
		})

		expect(action).type.toBe<Action<{ request: Request }, undefined, undefined, undefined, undefined, { processed: boolean }>>()
		expect(result).type.toBe<{ processed: boolean }>()
	})

	test('should infer the action return type with run', async () => {
		const procedure = createProcedure('Test Procedure').build()
		const action = procedure.createAction('Test Action')
			.build(() => {
				return { processed: true }
			})

		const result = await action.run(new Request('https://example.com'), {
			params: { id: '123' },
			query: undefined,
			body: undefined
		})

		expect(action).type.toBe<Action<{ request: Request }, undefined, undefined, undefined, undefined, { processed: boolean }>>()
		expect(result).type.toBe<{ processed: boolean }>()
	})

	test('should complain if the handler does not return the output type', async () => {
		const procedure = createProcedure('Test Procedure').build()
		const builder = procedure.createAction('Test Action')
			.output(Type.String())

		expect(builder.build(() => { return { processed: true } })).type.toRaiseError(`Type '{ processed: boolean; }' is not assignable to type 'Promisable<string>'.`)
	})
})