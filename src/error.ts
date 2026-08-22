// import dependencies
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

// import types
import type { Static } from '@sinclair/typebox'
import type { ObjectSchema } from './utils'
import type { Simplify } from 'type-fest'

/**
 * A single entry in an error table.
 */
export type ErrorEntry<M extends ObjectSchema | undefined = undefined> = {
	/** HTTP status code of the error */
	status: number;
	/** TypeBox schema for the metadata argument of onError(); omit = no metadata */
	metadata?: M;
	/** Default title; string or function of the (validated) metadata */
	title?:
	| string
	| ((metadata: M extends ObjectSchema ? Static<M> : undefined) => string);
	/** Default detail; same shape as title */
	detail?:
	| string
	| ((metadata: M extends ObjectSchema ? Static<M> : undefined) => string);
}

/**
 * A table of errors keyed by their stable reason.
 */
export type ErrorTable = Record<string, ErrorEntry<any>>

/**
 * An empty error table.
 */
export type NoErrors = Record<never, never>

/**
 * Error configuration of a procedure or action.
 */
export type ErrorConfig<Errors extends ErrorTable = ErrorTable> = {
	/** Builds the RFC 9457 `type` URI for a reason; default: () => 'about:blank' */
	type?: (reason: string) => string;
	/** Error table; merged by key with the parent's, child wins */
	table?: Errors;
}

/**
 * Error entries the package relies on. Always present, overridable by key.
 */
export const DEFAULT_ERRORS = {
	INTERNAL: {
		status: 500,
		title: 'Something went wrong',
		detail: 'Please try again later. If the problem persists, contact support.',
	},
	INVALID_INPUT: { status: 422, title: 'Invalid input' },
	MALFORMED_REQUEST: { status: 400, title: 'Malformed request' },
	NOT_FOUND: { status: 404, title: 'Not found' },
} as const satisfies ErrorTable

export type DefaultErrors = typeof DEFAULT_ERRORS

/**
 * Where a request value lives, using the OpenAPI parameter vocabulary plus `body`.
 */
export const ProblemFieldLocation = Type.Union([
	Type.Literal('body'),
	Type.Literal('path'),
	Type.Literal('query'),
	Type.Literal('header'),
	Type.Literal('cookie'),
])

export type ProblemFieldLocation = Static<typeof ProblemFieldLocation>

/**
 * A single field error within a validation problem.
 */
export const ProblemFieldError = Type.Object({
	in: ProblemFieldLocation,
	pointer: Type.String({
		description:
      'JSON pointer fragment to the invalid value within its location, e.g. #/tags/1',
	}),
	detail: Type.String(),
	received: Type.Optional(Type.String({ description: 'JSON of the received value; omitted for sensitive fields, truncated when long' })),
})

export type ProblemFieldError = Static<typeof ProblemFieldError>

const problemProperties = {
	type: Type.String({
		description: 'URI reference identifying the problem type',
	}),
	title: Type.String({
		description: 'Short, human-readable summary of the problem type',
	}),
	status: Type.Integer({ minimum: 100, maximum: 599 }),
	detail: Type.Optional(
		Type.String({
			description: 'Human-readable explanation specific to this occurrence',
		}),
	),
	instance: Type.Optional(
		Type.String({ description: 'Request path that produced the problem' }),
	),
	reason: Type.String({ description: 'Stable UPPER_SNAKE error code' }),
	metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	reference: Type.Optional(
		Type.String({
			description:
        'Error tracking reference, present when the error was reported',
		}),
	),
}

/**
 * RFC 9457 problem details with package extensions.
 */
export const Problem = Type.Object(problemProperties, { $id: 'Problem' })

export type Problem = Static<typeof Problem>

/**
 * A 422 problem carrying one entry per invalid field.
 */
export const ValidationProblem = Type.Object(
	{
		...problemProperties,
		errors: Type.Array(ProblemFieldError),
	},
	{ $id: 'ValidationProblem' },
)

export type ValidationProblem = Static<typeof ValidationProblem>

/**
 * Extension members that can be merged into a problem at serialization time.
 */
export type ProblemExtra = {
	instance?: string;
	reference?: string;
}

/**
 * Options accepted by the onError factory for a single occurrence.
 */
export type ApiErrorOptions = {
	title?: string;
	detail?: string;
	cause?: unknown;
}

/**
 * A thrown API error. Serialized to an RFC 9457 problem by the procedures() plugin.
 */
export class ApiError<
	Reason extends string = string,
	Meta = unknown,
> extends Error {
	readonly status: number
	readonly reason: Reason
	readonly metadata: Meta
	readonly title: string
	readonly detail?: string
	readonly type: string

	constructor(input: {
		status: number;
		reason: Reason;
		metadata: Meta;
		title: string;
		detail?: string;
		type: string;
		cause?: unknown;
	}) {
		super(
			input.title,
			input.cause === undefined ? undefined : { cause: input.cause },
		)
		this.name = 'ApiError'
		this.status = input.status
		this.reason = input.reason
		this.metadata = input.metadata
		this.title = input.title
		this.detail = input.detail
		this.type = input.type
	}

	/**
   * Serializes the error to an RFC 9457 problem. The cause is never included.
   * @param extra - Extension members (instance, reference) to merge
   */
	public toProblem = (extra: ProblemExtra = {}): Problem => {
		const problem: Problem = {
			type: this.type,
			title: this.title,
			status: this.status,
			reason: this.reason,
		}

		if (this.detail !== undefined) problem.detail = this.detail
		if (extra.instance !== undefined) problem.instance = extra.instance
		if (this.metadata !== undefined)
			problem.metadata = this.metadata as Record<string, unknown>
		if (extra.reference !== undefined) problem.reference = extra.reference

		return problem
	}
}

/**
 * Metadata type of an error table entry.
 */
export type ErrorMetadata<E extends ErrorEntry<any>> =
  E['metadata'] extends ObjectSchema ? Static<E['metadata']> : undefined

/**
 * Arguments of the onError factory after the reason: metadata is required if the entry has a schema.
 */
export type ErrorArgs<E extends ErrorEntry<any>> = E['metadata'] extends ObjectSchema
	? [metadata: Static<E['metadata']>, options?: ApiErrorOptions]
	: [metadata?: undefined, options?: ApiErrorOptions]

/**
 * Factory producing typed ApiErrors from an error table. The package defaults are always callable, overridable by key.
 * A single generic signature resolves the metadata type per call site, so the table is never expanded eagerly.
 */
export type ErrorFactory<Errors extends ErrorTable> = {
	<R extends keyof MergedErrors<DefaultErrors, Errors> & string>(
		reason: R,
		...args: ErrorArgs<MergedErrors<DefaultErrors, Errors>[R]>
	): ApiError<R, ErrorMetadata<MergedErrors<DefaultErrors, Errors>[R]>>;
	/** Wraps an unexpected failure as a 5xx error; the cause is reported but never serialized */
	unexpected(
		cause: unknown,
		options?: ApiErrorOptions & { reason?: keyof Errors & string },
	): ApiError<string, undefined>;
}

/** Converts UPPER_SNAKE to Title Case */
const toTitleCase = (reason: string) =>
	reason
		.toLowerCase()
		.split(/[_\s]+/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ')

const resolveCopy = (copy: ErrorEntry<any>['title'], metadata: unknown) =>
	typeof copy === 'function' ? copy(metadata as any) : copy

/**
 * Creates an onError factory bound to an effective error configuration. The package defaults back any missing entry.
 * @param config - The effective error configuration; `type` defaults to 'about:blank'
 */
export const createErrorFactory = <Errors extends ErrorTable>(
	config: ErrorConfig<Errors> = {},
): ErrorFactory<Errors> => {
	const typeOf = config.type ?? (() => 'about:blank')
	const table: ErrorTable = { ...DEFAULT_ERRORS, ...config.table }

	const lookup = (reason: string) => {
		const entry = table[reason]
		if (!entry) throw new TypeError(`Unknown error reason "${reason}"`)
		return entry
	}

	const create = (
		reason: string,
		metadata?: unknown,
		options: ApiErrorOptions = {},
	) => {
		const entry = lookup(reason)

		if (entry.metadata) {
			if (!Value.Check(entry.metadata, metadata)) {
				const first = Value.Errors(entry.metadata, metadata).First()
				throw new TypeError(
					`Invalid metadata for error "${reason}"${first ? `: ${first.path || '/'} ${first.message}` : ''}`,
				)
			}
		} else {
			metadata = undefined
		}

		return new ApiError({
			status: entry.status,
			reason,
			metadata,
			title:
        options.title ??
        resolveCopy(entry.title, metadata) ??
        toTitleCase(reason),
			detail: options.detail ?? resolveCopy(entry.detail, metadata),
			type: typeOf(reason),
			cause: options.cause,
		})
	}

	const factory = ((
		reason: string,
		metadata?: unknown,
		options?: ApiErrorOptions,
	) => create(reason, metadata, options)) as unknown as ErrorFactory<Errors>

	factory.unexpected = (cause, options = {}) => {
		const reason = options.reason ?? 'INTERNAL'
		const entry = lookup(reason)
		if (entry.status < 500)
			throw new TypeError(
				`Error reason "${reason}" has status ${entry.status}, unexpected() requires a 5xx reason`,
			)

		return create(reason, undefined, {
			title: options.title,
			detail: options.detail,
			cause,
		}) as ApiError<string, undefined>
	}

	return factory
}

/**
 * Merges two error configurations. The child's table entries and type function win.
 */
export const mergeErrors = <
	Parent extends ErrorTable,
	Child extends ErrorTable,
>(
	parent: ErrorConfig<Parent> | undefined,
	child: ErrorConfig<Child> | undefined,
): ErrorConfig<MergedErrors<Parent, Child>> => ({
	...((child?.type ?? parent?.type)
		? { type: child?.type ?? parent?.type }
		: {}),
	table: { ...parent?.table, ...child?.table } as MergedErrors<Parent, Child>,
})

/**
 * The error table resulting from merging a child table onto a parent table.
 */
export type MergedErrors<
	Parent extends ErrorTable,
	Child extends ErrorTable,
> = Simplify<Omit<Parent, keyof Child> & Child>

/**
 * Unique, sorted statuses documented for a table, including the package defaults.
 */
export const statusesOf = (table: ErrorTable): number[] =>
	[
		...new Set(
			Object.values({ ...DEFAULT_ERRORS, ...table }).map(
				(entry) => entry.status,
			),
		),
	].sort((a, b) => a - b)

/**
 * Identity helper that types the `title` / `detail` functions of an entry from its `metadata` schema,
 * so they can be written inline without annotating the metadata parameter.
 * @param entry - The error entry
 */
export function defineError<const S extends number, M extends ObjectSchema>(entry: {
	status: S;
	metadata: M;
	title?: string | ((metadata: Static<M>) => string);
	detail?: string | ((metadata: Static<M>) => string);
}): {
	status: S;
	metadata: M;
	title?: string | ((metadata: Static<M>) => string);
	detail?: string | ((metadata: Static<M>) => string);
}
export function defineError<const S extends number>(entry: {
	status: S;
	metadata?: undefined;
	title?: string | (() => string);
	detail?: string | (() => string);
}): {
	status: S;
	metadata?: undefined;
	title?: string | (() => string);
	detail?: string | (() => string);
}
export function defineError(entry: ErrorEntry<any>) {
	return entry
}
