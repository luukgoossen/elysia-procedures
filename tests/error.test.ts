// import dependencies
import { describe, test, expect } from 'bun:test'
import { Type } from '@sinclair/typebox'
import { ApiError, DEFAULT_ERRORS, createErrorFactory, mergeErrors, statusesOf } from '@/error'

const table = {
	NOT_FOUND: {
		status: 404,
		metadata: Type.Object({ entity: Type.String() }),
		title: (m: { entity: string }) => `${m.entity} not found`,
		detail: 'The requested resource does not exist.'
	},
	FORBIDDEN: { status: 403, title: 'Forbidden' },
	RATE_LIMITED: { status: 429 },
	UPSTREAM_DOWN: { status: 502, title: 'Upstream down' },
}

describe('ApiError', () => {
	test('serializes to an RFC 9457 problem without cause', () => {
		const error = new ApiError({
			status: 404,
			reason: 'NOT_FOUND',
			metadata: { entity: 'Video' },
			title: 'Video not found',
			detail: 'Gone',
			type: '/errors/NOT_FOUND',
			cause: new Error('secret')
		})

		expect(error).toBeInstanceOf(Error)
		expect(error.cause).toBeInstanceOf(Error)
		expect(error.message).toBe('Video not found')

		const problem = error.toProblem({ instance: '/videos/1', reference: 'ref' })
		expect(problem).toEqual({
			type: '/errors/NOT_FOUND',
			title: 'Video not found',
			status: 404,
			detail: 'Gone',
			instance: '/videos/1',
			reason: 'NOT_FOUND',
			metadata: { entity: 'Video' },
			reference: 'ref'
		})
		expect(JSON.stringify(problem)).not.toContain('secret')
		expect('cause' in problem).toBe(false)
	})

	test('omits undefined members', () => {
		const error = new ApiError({ status: 500, reason: 'INTERNAL', metadata: undefined, title: 'Oops', type: 'about:blank' })
		expect(Object.keys(error.toProblem())).toEqual(['type', 'title', 'status', 'reason'])
	})
})

describe('ApiError.is', () => {
	test('recognizes errors by brand rather than prototype', () => {
		const error = new ApiError({ status: 404, reason: 'NOT_FOUND', metadata: undefined, title: 'Not found', type: 'about:blank' })
		const foreign = Object.assign(new Error('Not found'), { status: 404, [Symbol.for('elysia-procedures.ApiError')]: true })

		expect(ApiError.is(error)).toBe(true)
		expect(ApiError.is(foreign)).toBe(true)
		expect(ApiError.is(new Error('Not found'))).toBe(false)
		expect(ApiError.is(undefined)).toBe(false)
	})
})

describe('mergeErrors', () => {
	test('child keys win and type is inherited', () => {
		const parent = { type: (r: string) => `/p/${r}`, table: { A: { status: 400, title: 'parent' }, B: { status: 401 } } }
		const child = { table: { A: { status: 409, title: 'child' }, C: { status: 403 } } }
		const merged = mergeErrors(parent, child)

		expect(merged.table).toEqual({ A: { status: 409, title: 'child' }, B: { status: 401 }, C: { status: 403 } })
		expect(merged.type?.('A')).toBe('/p/A')
	})

	test('child type overrides parent type', () => {
		const merged = mergeErrors({ type: () => 'parent' }, { type: () => 'child' })
		expect(merged.type?.('X')).toBe('child')
	})

	test('handles undefined on either side', () => {
		expect(mergeErrors(undefined, undefined)).toEqual({ table: {} })
		expect(mergeErrors(undefined, { table: { A: { status: 400 } } }).table).toEqual({ A: { status: 400 } })
	})
})

describe('statusesOf', () => {
	test('returns unique sorted statuses including the package defaults', () => {
		expect(statusesOf({ A: { status: 404 }, B: { status: 404 }, C: { status: 403 } })).toEqual([400, 403, 404, 422, 500])
	})
})

describe('createErrorFactory', () => {
	const onError = createErrorFactory({ table, type: r => `/errors/${r}` })

	test('resolves title from entry function and detail from entry string', () => {
		const error = onError('NOT_FOUND', { entity: 'Video' })
		expect(error).toBeInstanceOf(ApiError)
		expect(error.status).toBe(404)
		expect(error.reason).toBe('NOT_FOUND')
		expect(error.metadata).toEqual({ entity: 'Video' })
		expect(error.title).toBe('Video not found')
		expect(error.detail).toBe('The requested resource does not exist.')
		expect(error.type).toBe('/errors/NOT_FOUND')
	})

	test('options take precedence over entry copy', () => {
		const cause = new Error('x')
		const error = onError('NOT_FOUND', { entity: 'Video' }, { title: 'Custom', detail: 'Custom detail', cause })
		expect(error.title).toBe('Custom')
		expect(error.detail).toBe('Custom detail')
		expect(error.cause).toBe(cause)
	})

	test('falls back to a title cased reason and no detail', () => {
		const error = onError('RATE_LIMITED')
		expect(error.title).toBe('Rate Limited')
		expect(error.detail).toBeUndefined()
		expect(error.metadata).toBeUndefined()
	})

	test('throws a TypeError on invalid metadata or unknown reason', () => {
		expect(() => (onError as any)('NOT_FOUND', { entity: 1 })).toThrow(TypeError)
		expect(() => (onError as any)('NOPE')).toThrow(TypeError)
	})

	test('uses about:blank when no type function is given', () => {
		expect(createErrorFactory({ table })('FORBIDDEN').type).toBe('about:blank')
	})

	test('unexpected wraps a cause as a 500 with default copy', () => {
		const cause = new Error('db exploded')
		const error = createErrorFactory({ table }).unexpected(cause)
		expect(error.status).toBe(500)
		expect(error.reason).toBe('INTERNAL')
		expect(error.title).toBe(DEFAULT_ERRORS.INTERNAL.title)
		expect(error.cause).toBe(cause)
		expect(JSON.stringify(error.toProblem())).not.toContain('db exploded')
	})

	test('unexpected accepts an alternative reason with status >= 500', () => {
		const factory = createErrorFactory({ table })
		expect(factory.unexpected(new Error('x'), { reason: 'UPSTREAM_DOWN' }).status).toBe(502)
		expect(() => factory.unexpected(new Error('x'), { reason: 'FORBIDDEN' })).toThrow(TypeError)
	})

	test('package defaults are callable and overridable by key', () => {
		expect(createErrorFactory({ table })('INVALID_INPUT').status).toBe(422)
		const overridden = createErrorFactory({ table: { INTERNAL: { status: 503, title: 'Down' } } })
		expect(overridden('INTERNAL').status).toBe(503)
		expect(overridden.unexpected(new Error('x')).title).toBe('Down')
	})
})
