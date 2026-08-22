// import dependencies
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { Elysia, t } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { createProcedure } from '@/procedure'
import { problems } from '@/problems'
import { ApiError } from '@/error'

// mock the optional sentry dependency
const captureException = mock(() => 'event-id-exception')
const captureMessage = mock(() => 'event-id-message')
mock.module('@sentry/bun', () => ({
	captureException,
	captureMessage,
	startSpanManual: (_options: unknown, fn: (span?: unknown) => unknown) => fn(),
}))

const logs: { level: string; fields: Record<string, unknown> }[] = []
const log = (level: 'warn' | 'error', fields: Record<string, unknown>) => { logs.push({ level, fields }) }

const base = createProcedure('Base', undefined, {
	errors: {
		type: r => `/errors/${r}`,
		table: {
			NOT_FOUND: { status: 404, metadata: t.Object({ entity: t.String() }), title: (m: { entity: string }) => `${m.entity} not found` },
			UPSTREAM_DOWN: { status: 502, title: 'Upstream down', detail: 'The upstream service did not respond.' },
		}
	}
}).build()

const notFound = base.createAction('Get Video').params(t.Object({ id: t.String() })).output(t.Object({ id: t.String() })).build(({ params }, onError) => {
	throw onError('NOT_FOUND', { entity: 'Video' }, { detail: `Video ${params.id} is gone` })
})
const upstream = base.createAction('Upstream').build((_, onError) => {
	throw onError('UPSTREAM_DOWN', undefined, { cause: new Error('socket hang up') })
})
const wrapped = base.createAction('Wrapped').build((_, onError) => {
	throw onError.unexpected(new Error('db exploded'))
})
const create = base.createAction('Create Video').body(t.Object({
	name: t.String({ minLength: 3 }),
	password: t.String({ minLength: 8 }),
	tags: t.Optional(t.Array(t.String()))
})).build(({ body }) => body)
const boom = base.createAction('Boom').build(() => { throw new Error('db exploded') })

const build = (options?: Parameters<typeof problems>[0]) => new Elysia()
	.use(problems({ log, ...options }))
	.get('/videos/:id', notFound.handle, notFound.docs)
	.get('/upstream', upstream.handle, upstream.docs)
	.get('/wrapped', wrapped.handle, wrapped.docs)
	.post('/videos', create.handle, create.docs)
	.get('/boom', boom.handle, boom.docs)
	.get('/redirect', ({ redirect }) => redirect('/videos/1', 302))
	.get('/status', ({ status }) => status(302, 'moved'))

const request = (app: { handle: (request: Request) => Promise<Response> }, path: string, init?: RequestInit) => app.handle(new Request(`http://localhost${path}`, init))

beforeEach(() => {
	logs.length = 0
	captureException.mockClear()
	captureMessage.mockClear()
})

describe('problems() plugin', () => {
	test('serializes a 4xx ApiError without reporting', async () => {
		const res = await request(build(), '/videos/abc')

		expect(res.status).toBe(404)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		expect(await res.json()).toEqual({
			type: '/errors/NOT_FOUND',
			title: 'Video not found',
			status: 404,
			detail: 'Video abc is gone',
			instance: '/videos/abc',
			reason: 'NOT_FOUND',
			metadata: { entity: 'Video' },
		})
		expect(captureException).not.toHaveBeenCalled()
		expect(captureMessage).not.toHaveBeenCalled()
		expect(logs).toEqual([{ level: 'warn', fields: { status: 404, reason: 'NOT_FOUND', instance: '/videos/abc', method: 'GET' } }])
	})

	test('reports a 5xx ApiError and keeps author copy', async () => {
		const res = await request(build(), '/upstream')
		const body: any = await res.json()

		expect(res.status).toBe(502)
		expect(body).toEqual({
			type: '/errors/UPSTREAM_DOWN',
			title: 'Upstream down',
			status: 502,
			detail: 'The upstream service did not respond.',
			instance: '/upstream',
			reason: 'UPSTREAM_DOWN',
			reference: 'event-id-exception',
		})
		expect(captureException).toHaveBeenCalledTimes(1)
		expect((captureException.mock.calls[0] as unknown[])[0]).toBeInstanceOf(ApiError)
		expect((captureException.mock.calls[0] as unknown[])[1]).toEqual({ tags: { reason: 'UPSTREAM_DOWN', status: 502 } })
		expect(logs[0]?.level).toBe('error')
		expect(logs[0]?.fields.message).toBe('socket hang up')
	})

	test('onError.unexpected hides the cause and reports it', async () => {
		const res = await request(build(), '/wrapped')
		const text = await res.text()

		expect(res.status).toBe(500)
		expect(text).not.toContain('db exploded')
		expect(JSON.parse(text)).toMatchObject({ reason: 'INTERNAL', title: 'Something went wrong', reference: 'event-id-exception', type: '/errors/INTERNAL' })
		expect(captureException).toHaveBeenCalledTimes(1)
	})

	test('maps validation errors to 422 with field errors', async () => {
		const res = await request(build(), '/videos', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: '', password: 'hunter2hunter2', tags: ['a', 1] })
		})
		const body: any = await res.json()

		expect(res.status).toBe(422)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		expect(body).toMatchObject({ type: 'about:blank', title: 'Invalid input', status: 422, reason: 'INVALID_INPUT', instance: '/videos' })
		expect(body.detail).toBe('2 fields are invalid: body.name, body.tags[1]')
		expect(body.errors).toEqual([
			{ in: 'body', pointer: '#/name', detail: expect.any(String), received: '""' },
			{ in: 'body', pointer: '#/tags/1', detail: expect.any(String), received: '1' },
		])
		expect(captureException).not.toHaveBeenCalled()
	})

	test('elides sensitive received values and truncates long ones', async () => {
		const res = await request(build({ receivedMaxLength: 10 }), '/videos', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'x'.repeat(50), password: 'short', tags: [1] })
		})
		const body: any = await res.json()

		expect(res.status).toBe(422)
		expect(body.errors.find((e: { pointer: string }) => e.pointer === '#/password').received).toBeUndefined()
		expect(body.errors.find((e: { pointer: string }) => e.pointer === '#/tags/0').received).toBe('1')
		expect(body.errors.find((e: { pointer: string }) => e.pointer === '#/name')).toBeUndefined()
	})

	test('omits received for missing properties and maps locations', async () => {
		const app = new Elysia().use(problems({ log })).get('/q', () => 'ok', { query: t.Object({ page: t.Number() }) })
		const res = await request(app, '/q')
		const body: any = await res.json()

		expect(res.status).toBe(422)
		expect(body.errors.length).toBeGreaterThan(0)
		for (const field of body.errors) {
			expect(field).toEqual({ in: 'query', pointer: '#/page', detail: expect.any(String) })
		}
		expect(body.detail).toMatch(/^\d+ fields? (is|are) invalid: query\.page/)
	})

	test('treats response validation failures as server errors', async () => {
		const app = new Elysia().use(problems({ log })).get('/r', () => ({ id: 1 }) as any, { response: t.Object({ id: t.String() }) })
		const res = await request(app, '/r')
		const body: any = await res.json()

		expect(res.status).toBe(500)
		expect(body.reason).toBe('INTERNAL')
		expect(body.errors).toBeUndefined()
		expect(captureException).toHaveBeenCalledTimes(1)
	})

	test('maps malformed JSON to 400', async () => {
		const res = await request(build(), '/videos', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{not json'
		})

		expect(res.status).toBe(400)
		expect(await res.json()).toMatchObject({ title: 'Malformed request', status: 400, reason: 'MALFORMED_REQUEST', instance: '/videos' })
	})

	test('maps unknown routes to 404', async () => {
		const res = await request(build(), '/nope')

		expect(res.status).toBe(404)
		expect(await res.json()).toEqual({ type: 'about:blank', title: 'Not found', status: 404, instance: '/nope', reason: 'NOT_FOUND' })
	})

	test('uses the plugin error config for its own problems', async () => {
		const res = await request(build({ errors: { type: r => `/plugin/${r}`, table: { NOT_FOUND: { status: 404, title: 'Nothing here' } } } }), '/nope')

		expect(await res.json()).toMatchObject({ type: '/plugin/NOT_FOUND', title: 'Nothing here' })
	})

	test('maps plain errors to 500 without leaking the message', async () => {
		const res = await request(build(), '/boom')
		const text = await res.text()

		expect(res.status).toBe(500)
		expect(text).not.toContain('db exploded')
		expect(JSON.parse(text)).toEqual({
			type: 'about:blank',
			title: 'Something went wrong',
			status: 500,
			detail: 'Please try again later. If the problem persists, contact support.',
			instance: '/boom',
			reason: 'INTERNAL',
			reference: 'event-id-exception',
		})
		expect(captureException).toHaveBeenCalledTimes(1)
		expect(logs[0]).toEqual({ level: 'error', fields: { status: 500, reason: 'INTERNAL', instance: '/boom', method: 'GET', reference: 'event-id-exception', message: 'db exploded' } })
	})

	test('leaves redirects and sub-400 statuses untouched', async () => {
		const redirect = await request(build(), '/redirect')
		expect(redirect.status).toBe(302)
		expect(redirect.headers.get('content-type')).not.toBe('application/problem+json')

		const status = await request(build(), '/status')
		expect(status.status).toBe(302)
		expect(await status.text()).toBe('moved')
	})

	test('captureClientErrors reports 4xx ApiErrors as messages', async () => {
		await request(build({ captureClientErrors: 'warn' }), '/videos/abc')
		expect(captureMessage).toHaveBeenCalledTimes(1)
		expect(captureMessage.mock.calls[0] as unknown[]).toEqual(['Video not found', { level: 'warning', tags: { reason: 'NOT_FOUND', status: 404 } }])

		await request(build({ captureClientErrors: 'all' }), '/videos/abc')
		expect((captureMessage.mock.calls[1] as unknown[])[1]).toMatchObject({ level: 'info' })

		await request(build({ captureClientErrors: 'off' }), '/videos/abc')
		expect(captureMessage).toHaveBeenCalledTimes(2)
	})

	test('is idempotent when used on multiple instances', async () => {
		const child = new Elysia().use(problems({ log })).get('/child', () => { throw new Error('x') })
		const app = new Elysia().use(problems({ log })).use(child)

		const res = await request(app, '/child')
		expect(res.status).toBe(500)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		expect(logs).toHaveLength(1)
	})
})

describe('openapi integration', () => {
	test('documents error responses with a shared Problem schema', async () => {
		const app = new Elysia().use(openapi()).use(build())
		const res = await request(app, '/openapi/json')
		const spec: any = await res.json()

		expect(spec.components.schemas.Problem).toBeDefined()
		expect(spec.components.schemas.Problem.properties.reason).toBeDefined()
		expect(spec.components.schemas.Problem.properties.errors).toBeUndefined()
		expect(spec.components.schemas.ValidationProblem.required).toContain('errors')
		expect(spec.components.schemas.ValidationProblem.properties.errors.items.properties.in).toEqual({
			type: 'string',
			enum: ['body', 'path', 'query', 'header', 'cookie']
		})

		const responses = spec.paths['/videos/{id}'].get.responses
		expect(Object.keys(responses).sort()).toEqual(['200', '400', '404', '422', '500', '502'])
		expect(responses['404'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/Problem' })
		expect(responses['422'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/ValidationProblem' })
		expect(responses['200'].content['application/json'].schema.properties.id).toBeDefined()
	})
})

describe('elysia built-in errors', () => {
	test('maps invalid file types to 422', async () => {
		const app = new Elysia()
			.use(problems({ log }))
			.post('/upload', () => 'ok', { body: t.Object({ file: t.File({ type: 'image/png' }) }) })

		const form = new FormData()
		form.append('file', new File(['hello'], 'a.txt', { type: 'text/plain' }))
		const res = await request(app, '/upload', { method: 'POST', body: form })
		const body: any = await res.json()

		expect(res.status).toBe(422)
		expect(body.reason).toBe('INVALID_INPUT')
		expect(body.errors?.[0]).toMatchObject({ in: 'body', pointer: '#/file' })
		expect(body.detail).toBe('1 field is invalid: body.file')
	})
})

describe('sub-apps', () => {
	test('handles each error once when mounted on nested sub-apps', async () => {
		const calls: unknown[] = []
		const log = (level: 'warn' | 'error', fields: Record<string, unknown>) => calls.push([level, fields])
		const action = createProcedure('P', undefined, { errors: { table: { NOPE: { status: 418, title: 'Nope' } } } }).build()
			.createAction('A')
			.body(t.Object({ name: t.String() }))
			.output(t.Object({ ok: t.Boolean() }))
			.build(({ body }, onError) => { if (body.name === 'x') throw onError('NOPE'); return { ok: true } })

		const g1 = new Elysia({ prefix: '/g1' }).use(problems({ log })).post('/a', action.handle, action.docs)
		const g2 = new Elysia({ prefix: '/g2' }).use(problems({ log })).post('/a', action.handle, action.docs)
		const app = new Elysia().use(problems({ log })).use(g1).use(g2)

		const res = await app.handle(new Request('http://localhost/g2/a', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }) }))
		expect(res.status).toBe(418)
		expect(res.headers.get('content-type')).toBe('application/problem+json')
		expect(await res.json()).toMatchObject({ status: 418, reason: 'NOPE' })
		expect(calls.length).toBe(1)

		const bad = await app.handle(new Request('http://localhost/g1/a', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }))
		expect(bad.status).toBe(422)
		expect(calls.length).toBe(2)
	})
})
