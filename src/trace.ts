// import dependencies
import { trace as otel, SpanStatusCode } from '@opentelemetry/api'
import { ApiError } from './error'

// import types
import type { Attributes, Span, Tracer } from '@opentelemetry/api'

/**
 * The kinds of spans this package emits. `action` wraps one action run and `middleware` one middleware run.
 * `handler` wraps the action's own handler, after its middlewares. `input` and `output` wrap the validation
 * around `action.run()`.
 */
export type SpanType = 'action' | 'middleware' | 'handler' | 'input' | 'output'

/**
 * Options for tracing procedure and action runs through OpenTelemetry.
 */
export type TracingOptions = {
	/** The tracer to create spans with. Defaults to the global provider's tracer for this package */
	tracer?: Tracer
	/** Which span types to emit. Every type defaults to true */
	spans?: Partial<Record<SpanType, boolean>>
	/** Attributes added to every span */
	attributes?: Attributes
}

type Tracing = {
	tracer: Tracer
	spans: Record<SpanType, boolean>
	attributes: Attributes
}

/** The active tracing configuration; tracing is off until configured */
let tracing: Tracing | undefined

/**
 * Configures tracing for every procedure and action run. Spans are created through the OpenTelemetry API, so they
 * nest under whatever span is active: Elysia's OpenTelemetry plugin, Sentry, or any other SDK that registered the
 * global provider. `procedures({ observability: { tracing } })` calls this for you; call it directly when running
 * actions outside Elysia.
 * @param options `true` for the defaults, `false` to turn tracing off
 */
export const configureTracing = (options: TracingOptions | boolean = true) => {
	if (options === false) {
		tracing = undefined
		return
	}

	const { tracer, spans, attributes } = options === true ? {} : options

	tracing = {
		tracer: tracer ?? otel.getTracer('@luukgoossen/elysia-procedures'),
		spans: { action: true, middleware: true, handler: true, input: true, output: true, ...spans },
		attributes: attributes ?? {},
	}
}

/** Marks the span for a failure. A 4xx ApiError is an expected outcome and does not fail the span; everything else does */
const fail = (span: Span, error: unknown) => {
	if (ApiError.is(error) && error.status < 500) {
		span.setAttribute('procedure.error.reason', error.reason)
		span.setAttribute('procedure.error.status', error.status)
		return
	}

	span.recordException(error instanceof Error ? error : String(error))
	span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) })
}

/**
 * Runs `fn` inside an active span of the given type, when tracing is configured and the type is enabled. The span
 * ends when `fn` returns or its promise settles, and records the failure if it throws.
 * @param type The kind of span
 * @param name The span name
 * @param attributes Attributes specific to this span
 * @param fn The work to trace, given the span when there is one
 */
export const trace = <T>(type: SpanType, name: string, attributes: Attributes, fn: (span?: Span) => T): T => {
	if (!tracing?.spans[type]) return fn()

	const options = {
		attributes: {
			// sentry reads the operation from this attribute, other backends ignore it
			'sentry.op': `procedure.${type}`,
			'procedure.type': type,
			...tracing.attributes,
			...attributes,
		}
	}

	return tracing.tracer.startActiveSpan(name, options, span => {
		try {
			const result = fn(span)

			if (result instanceof Promise) {
				return result.then(value => {
					span.end()
					return value
				}, (error: unknown) => {
					fail(span, error)
					span.end()
					throw error
				}) as T
			}

			span.end()
			return result
		} catch (error) {
			fail(span, error)
			span.end()
			throw error
		}
	})
}
