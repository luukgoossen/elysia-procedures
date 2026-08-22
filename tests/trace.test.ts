// import dependencies
import { describe, test, expect, beforeEach, afterAll } from 'bun:test'
import { Elysia, t } from 'elysia'
import { trace as otel, context, SpanStatusCode, ROOT_CONTEXT } from '@opentelemetry/api'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createProcedure } from '@/procedure'
import { procedures } from '@/plugin'
import { configureTracing } from '@/trace'

// import types
import type { Tracer, Span, SpanOptions, Context, Attributes, ContextManager } from '@opentelemetry/api'

// propagate the active span the way an otel sdk would
const storage = new AsyncLocalStorage<Context>()
const manager: ContextManager = {
	active: () => storage.getStore() ?? ROOT_CONTEXT,
	with: (ctx, fn, thisArg, ...args) => storage.run(ctx, () => fn.call(thisArg, ...args)),
	bind: (_ctx, target) => target,
	enable() { return this },
	disable() { return this },
}
context.setGlobalContextManager(manager)

type Recorded = {
	name: string
	parent?: string
	attributes: Attributes
	status?: { code: SpanStatusCode, message?: string }
	exceptions: unknown[]
	ended: boolean
}

/** An in-memory tracer that records every span and nests them through the otel context */
const recorder = () => {
	const spans: Recorded[] = []

	const tracer: Tracer = {
		startSpan: () => { throw new Error('not used') },
		startActiveSpan: (...args: unknown[]) => {
			const name = args[0] as string
			const fn = args[args.length - 1] as (span: Span) => unknown
			const options = (args.length > 2 ? args[1] : {}) as SpanOptions
			const parent = args.length > 3 ? args[2] as Context : context.active()
			const recorded: Recorded = { name, parent: (otel.getSpan(parent) as any)?.recorded?.name, attributes: { ...options.attributes }, exceptions: [], ended: false }
			spans.push(recorded)

			const span = {
				recorded,
				spanContext: () => ({ traceId: '1', spanId: String(spans.length), traceFlags: 1 }),
				setAttribute(key: string, value: unknown) { recorded.attributes[key] = value as never; return span },
				setAttributes(attributes: Attributes) { Object.assign(recorded.attributes, attributes); return span },
				setStatus(status: { code: SpanStatusCode, message?: string }) { recorded.status = status; return span },
				recordException(error: unknown) { recorded.exceptions.push(error) },
				end() { recorded.ended = true },
				isRecording: () => true,
				updateName: () => span,
				addEvent: () => span,
				addLink: () => span,
				addLinks: () => span,
			} as unknown as Span

			return context.with(otel.setSpan(parent, span), () => fn(span))
		}
	}

	return { tracer, spans }
}

const base = createProcedure('Base', {
	errors: { table: { NOT_FOUND: { status: 404 }, UPSTREAM_DOWN: { status: 502 } } }
}).build()

const withAuth = createProcedure('Auth', base, { tracing: { name: 'authenticate', attributes: { 'auth.kind': 'bearer' } } }).build(() => ({ user: 'me' }))

const ok = withAuth.createAction('Get Video', { tracing: { attributes: { 'video.source': 'db' } } })
	.params(t.Object({ id: t.String() })).output(t.Object({ id: t.String() }))
	.build(({ params }) => ({ id: params.id }))
const notFound = withAuth.createAction('Missing').build((_, onError) => { throw onError('NOT_FOUND') })
const upstream = withAuth.createAction('Upstream').build((_, onError) => { throw onError('UPSTREAM_DOWN') })
const boom = withAuth.createAction('Boom').build(() => { throw new Error('db exploded') })

const build = (tracing?: Parameters<typeof procedures>[0] extends infer O ? O extends { observability?: infer Ob } ? Ob extends { tracing?: infer T } ? T : never : never : never) => new Elysia()
	.use(procedures({ observability: { logging: () => {}, tracing } }))
	.get('/videos/:id', ok.handle, ok.docs)
	.get('/missing', notFound.handle, notFound.docs)
	.get('/upstream', upstream.handle, upstream.docs)
	.get('/boom', boom.handle, boom.docs)

const request = (app: { handle: (request: Request) => Promise<Response> }, path: string) => app.handle(new Request(`http://localhost${path}`))
const ctx = () => ({ request: new Request('http://localhost/') }) as any

beforeEach(() => configureTracing(false))
afterAll(() => {
	configureTracing(false)
	context.disable()
})

describe('tracing', () => {
	test('is off unless configured', async () => {
		const { tracer, spans } = recorder()
		otel.setGlobalTracerProvider({ getTracer: () => tracer })

		await request(build(), '/videos/1')
		expect(spans).toHaveLength(0)

		await ok.run(ctx(), { params: { id: '1' }, query: undefined, body: undefined })
		expect(spans).toHaveLength(0)

		otel.disable()
	})

	test('tracing: true uses the global tracer provider', async () => {
		const { tracer, spans } = recorder()
		otel.setGlobalTracerProvider({ getTracer: () => tracer })

		const res = await request(build(true), '/videos/1')
		expect(res.status).toBe(200)
		expect(spans.map(s => s.name)).toEqual(['Get Video', 'authenticate', 'Get Video'])

		otel.disable()
	})

	test('nests middleware and handler spans under the action span', async () => {
		const { tracer, spans } = recorder()
		await request(build({ tracer, attributes: { 'service.layer': 'api' } }), '/videos/1')

		const [action, middleware, handler] = spans
		expect(action).toMatchObject({ name: 'Get Video', parent: undefined, ended: true, attributes: { 'sentry.op': 'procedure.action', 'procedure.type': 'action', 'procedure.name': 'Get Video', 'video.source': 'db', 'service.layer': 'api' } })
		expect(middleware).toMatchObject({ name: 'authenticate', parent: 'Get Video', ended: true, attributes: { 'sentry.op': 'procedure.middleware', 'procedure.type': 'middleware', 'procedure.name': 'Auth', 'auth.kind': 'bearer', 'procedure.cache': 'unavailable' } })
		expect(handler).toMatchObject({ name: 'Get Video', parent: 'Get Video', ended: true, attributes: { 'sentry.op': 'procedure.handler', 'procedure.type': 'handler', 'video.source': 'db' } })
		expect(spans.every(s => s.status === undefined)).toBe(true)
	})

	test('run() adds input and output validation spans', async () => {
		const { tracer, spans } = recorder()
		configureTracing({ tracer })

		await ok.run(ctx(), { params: { id: '1' }, query: undefined, body: undefined })
		expect(spans.map(s => `${s.attributes['procedure.type']}:${s.parent ?? '-'}`)).toEqual(['action:-', 'input:Get Video', 'middleware:Get Video', 'handler:Get Video', 'output:Get Video'])
		expect(spans.every(s => s.ended)).toBe(true)
	})

	test('span types can be disabled', async () => {
		const { tracer, spans } = recorder()
		configureTracing({ tracer, spans: { input: false, output: false, middleware: false } })

		await ok.run(ctx(), { params: { id: '1' }, query: undefined, body: undefined })
		expect(spans.map(s => s.attributes['procedure.type'])).toEqual(['action', 'handler'])
	})

	test('records unexpected and 5xx failures as span errors and still ends the spans', async () => {
		const { tracer, spans } = recorder()
		const app = build({ tracer })

		await request(app, '/boom')
		const [action, , handler] = spans
		expect(handler).toMatchObject({ ended: true, status: { code: SpanStatusCode.ERROR, message: 'db exploded' } })
		expect(handler?.exceptions[0]).toBeInstanceOf(Error)
		expect(action).toMatchObject({ ended: true, status: { code: SpanStatusCode.ERROR } })

		spans.length = 0
		await request(app, '/upstream')
		expect(spans[2]).toMatchObject({ ended: true, status: { code: SpanStatusCode.ERROR }, attributes: { 'procedure.type': 'handler' } })
	})

	test('marks 4xx ApiErrors on the span without an error status', async () => {
		const { tracer, spans } = recorder()
		await request(build({ tracer }), '/missing')

		const handler = spans[2]
		expect(handler).toMatchObject({ ended: true, attributes: { 'procedure.error.reason': 'NOT_FOUND', 'procedure.error.status': 404 }, exceptions: [] })
		expect(handler?.status).toBeUndefined()
		expect(spans[0]?.status).toBeUndefined()
	})

	test('input validation failures in run() end the spans', async () => {
		const { tracer, spans } = recorder()
		configureTracing({ tracer })

		await expect(ok.run(ctx(), { params: {} as any, query: undefined, body: undefined })).rejects.toThrow()
		expect(spans.map(s => s.attributes['procedure.type'])).toEqual(['action', 'input'])
		expect(spans.every(s => s.ended)).toBe(true)
		expect(spans[1]?.status?.code).toBe(SpanStatusCode.ERROR)
	})
})
