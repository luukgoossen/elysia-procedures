// import types
import type { Span, SpanOptions } from '@opentelemetry/api'

export type TraceOptions = SpanOptions & {
	name: string
	op: string
}

export const trace = async <T>(options: TraceOptions, fn: (span?: Span) => T) => {
	// try tracing using sentry
	try {
		// @ts-expect-error dynamic import of optional dependency
		const { startSpanManual } = await import('@sentry/bun')
		return startSpanManual(options, fn) as T
	} catch {}
	
	// try tracing using opentelemetry
	try {
		// @ts-expect-error dynamic import of optional dependency
		const { record } = await import('@elysiajs/opentelemetry')
		return record(options.name, options, fn) as T
	} catch {}
	
	return fn() as T
}