// import dependencies
import { Elysia, ElysiaCustomStatusResponse } from 'elysia'
import {
	ApiError,
	Problem,
	ValidationProblem,
	createErrorFactory,
} from './error'

// import types
import type { ValidationError } from 'elysia'
import type {
	ProblemFieldError,
	ProblemFieldLocation,
	ErrorConfig,
} from './error'

/**
 * Options for the problems() plugin.
 */
export type ProblemsOptions = {
	/** Report 4xx ApiErrors to Sentry as messages: 'off' (default), 'warn' (level warning) or 'all' (level info) */
	captureClientErrors?: 'off' | 'warn' | 'all';
	/** Error configuration used for the problems the plugin builds itself, so copy and `type` URIs line up with the procedures */
	errors?: ErrorConfig;
	/** Maximum characters of `received` echoed per field error; default 200 */
	receivedMaxLength?: number;
	/** Override logging; default console.warn for 4xx and console.error for 5xx */
	log?: (level: 'warn' | 'error', fields: Record<string, unknown>) => void;
}

type Sentry = {
	captureException: (
		error: unknown,
		context?: Record<string, unknown>,
	) => string;
	captureMessage: (
		message: string,
		context?: Record<string, unknown>,
	) => string;
}

/** Pointer segments whose value is never echoed back */
const SENSITIVE = /password|secret|token|key/i

/** Resolves the optional sentry dependency once */
let sentry: Promise<Sentry | undefined> | undefined
const loadSentry = () =>
	(sentry ??= (async () => {
		try {
			// @ts-expect-error dynamic import of optional dependency
			const module = await import('@sentry/bun')
			return typeof module.captureException === 'function'
				? (module as Sentry)
				: undefined
		} catch {
			return undefined
		}
	})())

/** Serializes a received value as JSON, eliding sensitive fields, values without a JSON form, and truncating long values */
const describeReceived = (
	pointer: string,
	value: unknown,
	max: number,
): string | undefined => {
	if (pointer.split('/').some((segment) => SENSITIVE.test(segment)))
		return undefined

	let json: string | undefined
	try {
		json = JSON.stringify(value)
	} catch {
		return undefined
	}

	if (json === undefined) return undefined
	return json.length > max ? `${json.slice(0, max)}…` : json
}

/** Elysia's request validation targets mapped onto the OpenAPI location vocabulary */
const LOCATIONS = {
	body: 'body',
	params: 'path',
	query: 'query',
	headers: 'header',
	cookie: 'cookie',
} as const satisfies Record<string, ProblemFieldLocation>

const isRequestValidation = (
	error: ValidationError,
): error is ValidationError & { type: keyof typeof LOCATIONS } =>
	error.type in LOCATIONS

/** Builds the field errors of a validation error */
const fieldErrors = (
	error: ValidationError,
	max: number,
): ProblemFieldError[] => {
	const all = error.all.filter(
		(item): item is Extract<typeof item, { path: string }> => 'path' in item,
	)
	return all.map((item) => {
		const field: ProblemFieldError = {
			in: LOCATIONS[error.type as keyof typeof LOCATIONS],
			pointer: `#${item.path}`,
			detail: item.summary ?? item.message,
		}

		const received = describeReceived(item.path, item.value, max)
		if (received !== undefined) field.received = received

		return field
	})
}

/** Builds the detail line of a validation problem, listing at most five fields */
const describeFields = (errors: ProblemFieldError[]) => {
	const names = errors.map(
		(field: ProblemFieldError) =>
			field.in +
      field.pointer
      	.slice(1)
      	.split('/')
      	.filter(Boolean)
      	.map((segment) =>
      		/^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`,
      	)
      	.join(''),
	)
	const listed = names.slice(0, 5).join(', ') + (names.length > 5 ? ', …' : '')
	return `${names.length} field${names.length === 1 ? ' is' : 's are'} invalid: ${listed}`
}

/**
 * Elysia plugin serializing every failure to an RFC 9457 `application/problem+json` response.
 * Redirects, thrown Responses and `status(...)` values are returned untouched.
 */
export const problems = (options: ProblemsOptions = {}) => {
	const capture = options.captureClientErrors ?? 'off'
	const receivedMaxLength = options.receivedMaxLength ?? 200
	const log = options.log ?? ((level, fields) => console[level](fields))
	const onError = createErrorFactory(options.errors)

	return new Elysia({ name: 'elysia-procedures/problems' })
		.model({ Problem, ValidationProblem })
		.error({ API_ERROR: ApiError })
		.onError({ as: 'global' }, async ({ code, error, request, set }) => {
			// elysia uses these for redirects and early returns
			if (
				error instanceof Response ||
        error instanceof ElysiaCustomStatusResponse
			)
				return

			const instance = new URL(request.url).pathname
			const fields: Record<string, unknown> = {
				instance,
				method: request.method,
			}
			let problem: Problem | ValidationProblem

			if (error instanceof ApiError) {
				let reference: string | undefined
				if (error.status >= 500) {
					reference = (await loadSentry())?.captureException(error, {
						tags: { reason: error.reason, status: error.status },
					})
					fields.message =
            error.cause instanceof Error ? error.cause.message : error.message
				} else if (capture !== 'off') {
					(await loadSentry())?.captureMessage(error.title, {
						level: capture === 'warn' ? 'warning' : 'info',
						tags: { reason: error.reason, status: error.status },
					})
				}
				problem = error.toProblem({ instance, reference })
			} else if (
				code === 'VALIDATION' &&
        isRequestValidation(error as ValidationError)
			) {
				const errors = fieldErrors(error as ValidationError, receivedMaxLength)
				problem = {
					...onError('INVALID_INPUT', undefined, {
						detail: describeFields(errors),
					}).toProblem({ instance }),
					errors,
				}
			} else if (code === 'INVALID_FILE_TYPE') {
				const { property, message } = error as Error & { property: string }
				const errors: ProblemFieldError[] = [
					{ in: 'body', pointer: `#/${property}`, detail: message },
				]
				problem = {
					...onError('INVALID_INPUT', undefined, {
						detail: describeFields(errors),
					}).toProblem({ instance }),
					errors,
				}
			} else if (code === 'PARSE') {
				problem = onError('MALFORMED_REQUEST', undefined, {
					detail: 'The request body could not be parsed.',
				}).toProblem({ instance })
			} else if (code === 'INVALID_COOKIE_SIGNATURE') {
				problem = onError('MALFORMED_REQUEST', undefined, {
					detail: 'The request carries a cookie with an invalid signature.',
				}).toProblem({ instance })
			} else if (code === 'NOT_FOUND') {
				problem = onError('NOT_FOUND').toProblem({ instance })
			} else {
				// includes response validation failures: the handler, not the client, produced an invalid value
				const reference = (await loadSentry())?.captureException(error)
				if (reference !== undefined) fields.reference = reference
				fields.message = error instanceof Error ? error.message : String(error)
				problem = onError('INTERNAL').toProblem({ instance, reference })
			}

			log(problem.status >= 500 ? 'error' : 'warn', {
				status: problem.status,
				reason: problem.reason,
				...fields,
				...(problem.reference ? { reference: problem.reference } : {}),
			})

			set.status = problem.status
			return new Response(JSON.stringify(problem), {
				status: problem.status,
				headers: { 'content-type': 'application/problem+json' },
			})
		})
}
