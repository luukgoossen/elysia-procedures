// import types
import type { Span, SpanOptions } from '@opentelemetry/api'

export type TraceOptions = SpanOptions & {
	name: string
	op: string
}

export const trace = async <T>(options: TraceOptions, fn: (span?: Span) => T) => {
	// try tracing using sentry
	try {
		const { startSpan } = await import('@sentry/bun')
		return startSpan(options, fn)
	} catch {}
	
	// try tracing using opentelemetry
	try {
		const { record } = await import('@elysiajs/opentelemetry')
		return record(options.name, options, fn)
	} catch {}
	
	return fn()
}