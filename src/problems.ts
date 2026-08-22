// import dependencies
import { ElysiaCustomStatusResponse } from 'elysia'
import { ApiError, createErrorFactory } from './error'

// import types
import type { ValidationError } from 'elysia'
import type { Problem, ValidationProblem, ProblemFieldError, ProblemFieldLocation, ErrorConfig, ErrorFactory, NoErrors } from './error'

/**
 * Options for resolving an Elysia error into a problem.
 */
export type ResolveProblemOptions = {
	/** Request path, exposed as the problem's `instance` */
	instance?: string
	/** Error configuration for the problems built here; pass the procedures' so copy and `type` URIs line up */
	errors?: ErrorConfig
	/** Maximum characters of `received` echoed per field error; default 200 */
	receivedMaxLength?: number
}

/** Pointer segments and property names whose value is never echoed back */
const SENSITIVE = /password|secret|token|key/i

/** Placeholder for redacted properties inside an echoed object */
const REDACTED = '[redacted]'

/** Replaces sensitive properties, at any depth, while JSON.stringify walks the value */
const redact = (key: string, value: unknown) => (SENSITIVE.test(key) ? REDACTED : value)

/**
 * Serializes a received value as JSON. Returns undefined for sensitive fields and values without a JSON form, and
 * truncates long values. Sensitive properties nested inside an object are replaced, so an error reported at the
 * object level never echoes a secret either.
 */
const describeReceived = (pointer: string, value: unknown, max: number): string | undefined => {
	if (pointer.split('/').some(segment => SENSITIVE.test(segment))) return undefined

	let json: string | undefined
	try {
		json = JSON.stringify(value, redact)
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

const isRequestValidation = (error: ValidationError): error is ValidationError & { type: keyof typeof LOCATIONS } => error.type in LOCATIONS

/** Builds the field errors of a validation error */
const fieldErrors = (error: ValidationError, max: number): ProblemFieldError[] => {
	const all = error.all.filter((item): item is Extract<typeof item, { path: string }> => 'path' in item)
	return all.map(item => {
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

/** Converts a field error like { in: 'body', pointer: '#/tags/1' } to body.tags[1] */
const humanizeField = (field: ProblemFieldError) => field.in + field.pointer
	.slice(1)
	.split('/')
	.filter(Boolean)
	.map(segment => /^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`)
	.join('')

/** Builds the detail line of a validation problem, listing at most five fields */
const describeFields = (errors: ProblemFieldError[]) => {
	const names = errors.map(humanizeField)
	const listed = names.slice(0, 5).join(', ') + (names.length > 5 ? ', …' : '')
	return `${names.length} field${names.length === 1 ? ' is' : 's are'} invalid: ${listed}`
}

/** One error factory per error configuration */
const factories = new WeakMap<ErrorConfig, ErrorFactory<NoErrors>>()
const defaultFactory = createErrorFactory()
const factoryFor = (errors?: ErrorConfig) => {
	if (!errors) return defaultFactory
	let factory = factories.get(errors)
	if (!factory) factories.set(errors, factory = createErrorFactory(errors))
	return factory
}

/**
 * Resolves an error caught by Elysia's `onError` into an RFC 9457 problem. This is the wire contract as a pure
 * function. It does no reporting or logging and never includes the raw message of an unexpected error. Thrown
 * Responses and `status(...)` values, which Elysia uses for redirects and early returns, resolve to `undefined` so
 * the caller can let them pass through.
 * @param code - Elysia's error code
 * @param error - The caught error
 * @param options - Instance, error configuration and echo limit
 */
export const resolveProblem = (code: string | number, error: unknown, options: ResolveProblemOptions = {}): Problem | ValidationProblem | undefined => {
	if (error instanceof Response || error instanceof ElysiaCustomStatusResponse) return undefined

	const { instance } = options
	const onError = factoryFor(options.errors)
	const max = options.receivedMaxLength ?? 200

	if (ApiError.is(error)) return error.toProblem({ instance })

	if (code === 'VALIDATION' && isRequestValidation(error as ValidationError)) {
		const errors = fieldErrors(error as ValidationError, max)
		return { ...onError('INVALID_INPUT', undefined, { detail: describeFields(errors) }).toProblem({ instance }), errors }
	}

	if (code === 'INVALID_FILE_TYPE') {
		const { property, message } = error as Error & { property: string }
		const errors: ProblemFieldError[] = [{ in: 'body', pointer: `#/${property}`, detail: message }]
		return { ...onError('INVALID_INPUT', undefined, { detail: describeFields(errors) }).toProblem({ instance }), errors }
	}

	if (code === 'PARSE') return onError('MALFORMED_REQUEST', undefined, { detail: 'The request body could not be parsed.' }).toProblem({ instance })
	if (code === 'INVALID_COOKIE_SIGNATURE') return onError('MALFORMED_REQUEST', undefined, { detail: 'The request carries a cookie with an invalid signature.' }).toProblem({ instance })
	if (code === 'NOT_FOUND') return onError('NOT_FOUND').toProblem({ instance })

	// anything else, including response validation failures, is the server's fault
	return onError('INTERNAL').toProblem({ instance })
}

/**
 * Serializes a problem to an `application/problem+json` response.
 */
export const problemResponse = (problem: Problem | ValidationProblem) => new Response(JSON.stringify(problem), {
	status: problem.status,
	headers: { 'content-type': 'application/problem+json' },
})
