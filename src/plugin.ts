// import dependencies
import { Elysia } from 'elysia'
import { ApiError, Problem, ValidationProblem } from './error'
import { resolveProblem, problemResponse } from './problems'
import { configureTracing } from './trace'

// import types
import type { Promisable } from 'type-fest'
import type { ErrorConfig } from './error'
import type { ResolveProblemOptions } from './problems'
import type { TracingOptions } from './trace'

/**
 * Reports a failure to an error tracker and returns the reference to expose in the problem, if any.
 */
export type ProblemReporter = (error: unknown, problem: Problem | ValidationProblem) => Promisable<string | undefined>

/**
 * Logs one handled failure.
 */
export type ProblemLogger = (level: 'warn' | 'error', fields: Record<string, unknown>) => void

/**
 * Options for the procedures() plugin, grouped by concern.
 */
export type ProceduresOptions = {
	/** The wire contract: error configuration for the problems the plugin builds itself, so copy and `type` URIs line up with the procedures, and echo limits */
	errors?: ErrorConfig & Pick<ResolveProblemOptions, 'receivedMaxLength'>
	/** Policy: how handled failures are reported and logged, and whether runs are traced */
	observability?: {
		/** Reports failures and yields the `reference`; default: none, problems carry no `reference` */
		errorReporting?: ProblemReporter
		/** Logs handled failures; default console.warn for 4xx and console.error for 5xx */
		logging?: ProblemLogger
		/** Traces procedure and action runs through the OpenTelemetry API; default: off */
		tracing?: TracingOptions | boolean
	}
}

/**
 * Options for the Sentry reporter.
 */
export type SentryReporterOptions = {
	/** Report 4xx ApiErrors as messages: 'off' (default), 'warn' (level warning) or 'all' (level info) */
	captureClientErrors?: 'off' | 'warn' | 'all'
}

/**
 * The part of a Sentry SDK the reporter uses; any `@sentry/*` module satisfies it.
 */
export type SentryLike = {
	captureException: (error: unknown, context?: any) => string
	captureMessage: (message: string, context?: any) => string
}

/**
 * A reporter for Sentry: 5xx problems are captured as exceptions (Sentry follows the `cause` chain), 4xx ApiErrors
 * optionally as messages. Pass the SDK you initialized, e.g. `sentryReporter(Sentry)` with `import * as Sentry from '@sentry/bun'`.
 */
export const sentryReporter = (sentry: SentryLike, options: SentryReporterOptions = {}): ProblemReporter => {
	const capture = options.captureClientErrors ?? 'off'

	return (error, problem) => {
		const tags = { reason: problem.reason, status: problem.status }

		if (problem.status >= 500) return sentry.captureException(error, { tags })
		if (error instanceof ApiError && capture !== 'off') {
			sentry.captureMessage(error.title, { level: capture === 'warn' ? 'warning' : 'info', tags })
		}
		return undefined
	}
}

/** Extracts the message to log for a failure; never exposed in the body */
const messageOf = (error: unknown) => {
	if (error instanceof ApiError) return error.cause instanceof Error ? error.cause.message : error.message
	return error instanceof Error ? error.message : String(error)
}

/**
 * Registers the `Problem` and `ValidationProblem` models that `action.docs` reference, and `ApiError` as a known error.
 * Use this instead of procedures() when bringing your own `onError` handler.
 */
export const procedureModels = () => new Elysia({ name: 'elysia-procedures/models' })
	.model({ Problem, ValidationProblem })
	.error({ API_ERROR: ApiError })

/**
 * The Elysia integration of elysia-procedures. Registers the problem models and serializes every failure to an
 * RFC 9457 `application/problem+json` response, reporting and logging it, and configures tracing. Mount it once on
 * the root app before any sub-apps. Redirects, thrown Responses and `status(...)` values pass through.
 */
export const procedures = (options: ProceduresOptions = {}) => {
	const { receivedMaxLength, ...errors } = options.errors ?? {}
	const report = options.observability?.errorReporting ?? (() => undefined)
	const log = options.observability?.logging ?? ((level, fields) => console[level](fields))

	configureTracing(options.observability?.tracing ?? false)

	return new Elysia({ name: 'elysia-procedures' })
		.use(procedureModels())
		.onError({ as: 'global' }, async ({ code, error, request, set }) => {
			const instance = new URL(request.url).pathname
			const resolved = resolveProblem(code, error, { errors, receivedMaxLength, instance })
			if (!resolved) return

			const reference = await report(error, resolved)
			const problem = reference === undefined ? resolved : { ...resolved, reference }

			log(problem.status >= 500 ? 'error' : 'warn', {
				status: problem.status,
				reason: problem.reason,
				instance,
				method: request.method,
				...(reference !== undefined ? { reference } : {}),
				...(problem.status >= 500 ? { message: messageOf(error) } : {}),
			})

			set.status = problem.status
			return problemResponse(problem)
		})
}
