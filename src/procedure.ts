// import dependencies
import { ActionBuilder } from './action'
import { merge } from './utils'
import { trace } from './trace'
import { createErrorFactory, mergeErrors } from './error'

// import types
import type { Static } from '@sinclair/typebox'
import type { Promisable, Simplify } from 'type-fest'
import type { Context, ObjectSchema, SafeTObject, MergedObject, MergedContext, Decorations, Config } from './utils'
import type { ErrorFactory, ErrorTable, MergedErrors, NoErrors } from './error'

// define a local middleware cache
const cache = new WeakMap<Request, Map<string, any>>()
const cacheKey = (id: string, array: string[]) => `${id}:[${array.join(',')}]`

/**
 * Configuration arguments for creating a procedure.
 */
export type ProcedureArgs<
	Params extends ObjectSchema | undefined,
	Query extends ObjectSchema | undefined,
	Body extends ObjectSchema | undefined,
	Errors extends ErrorTable = NoErrors
> = {
	/** TypeBox schema for route parameters */
	params: Params
	/** TypeBox schema for query parameters */
	query: Query
	/** TypeBox schema for request body */
	body: Body
	/** Chain of middleware to execute before the main action handler */
	middlewares: AnyMiddleware[]
	/** Name of the procedure for identification */
	name: string
	/** Effective configuration for the procedure, including the merged error table */
	config: Config<Errors>
}

/**
 * Arguments passed to procedure handler functions.
 */
export type ProcedureFnArgs<
	Ctx extends Context,
	Params extends ObjectSchema | undefined,
	Query extends ObjectSchema | undefined,
	Body extends ObjectSchema | undefined
> = {
	/** Context object with request data and middleware results */
	ctx: Simplify<Ctx>
	/** Parsed and validated route parameters */
	params: Params extends ObjectSchema ? Static<Params> : undefined
	/** Parsed and validated query parameters */
	query: Query extends ObjectSchema ? Static<Query> : undefined
	/** Parsed and validated request body */
	body: Body extends ObjectSchema ? Static<Body> : undefined
}

/**
 * Function type for procedure middleware functions.
 */
export type ProcedureFn<
	Ctx extends Context,
	Params extends ObjectSchema | undefined,
	Query extends ObjectSchema | undefined,
	Body extends ObjectSchema | undefined,
	Next = object | void,
	Errors extends ErrorTable = NoErrors
> = (input: ProcedureFnArgs<Ctx, Params, Query, Body>, onError: ErrorFactory<Errors>) => Promisable<Next>

/**
 * Type alias for any middleware type.
 */
export type AnyMiddleware = Middleware<any, any, any, any, any, any>

/**
 * Middleware class representing a function to run during request processing.
 * A middleware processes requests before they reach the main action handler.
 */
export class Middleware<
	Ctx extends Context,
	Params extends ObjectSchema | undefined,
	Query extends ObjectSchema | undefined,
	Body extends ObjectSchema | undefined,
	Next = object | void,
	Errors extends ErrorTable = NoErrors
> {
	private _id: string = crypto.randomUUID()
	private _handler: ProcedureFn<Ctx, Params, Query, Body, Next, Errors>
	private _keys?: ProcedureFn<Ctx, Params, Query, Body, string[], Errors>
	private _onError: ErrorFactory<Errors>

	/** Name of the middleware for identification */
	name: string

	/** Additional configuration for the middleware */
	config: Config<Errors>

	constructor(handler: ProcedureFn<Ctx, Params, Query, Body, Next, Errors>, name: string, config: Config<Errors>, keys?: ProcedureFn<Ctx, Params, Query, Body, string[], Errors>) {
		this._handler = handler
		this._keys = keys
		this.name = name
		this.config = config
		this._onError = createErrorFactory(config.errors)
	}

	/**
	 * Executes this middleware with the provided input
	 * @param input - The current procedure arguments
	 * @returns - The additional context created by the middleware to be merged into the procedure
	 */
	public execute = async (input: ProcedureFnArgs<Ctx, Params, Query, Body>) => trace('middleware', this.config.tracing?.name ?? this.name, {
		'procedure.name': this.name,
		...this.config.tracing?.attributes
	}, async span => {
		if (!this._keys) {
			span?.setAttribute('procedure.cache', 'unavailable')
			return await this._handler(input, this._onError)
		}

		// compute a cache key based on the name and input params, query, and body
		const key = cacheKey(this._id, await this._keys(input, this._onError))

		// check if the middleware has already been executed
		const cached = cache.get(input.ctx.request) ?? new Map()
		if (cached.has(key)) {
			span?.setAttribute('procedure.cache.hit', true)
			return cached.get(key)
		}

		// execute the middleware handler
		const result = await this._handler(input, this._onError)

		// store the result in the cache, use null for void results
		cached.set(key, result ?? null)
		cache.set(input.ctx.request, cached)

		span?.setAttribute('procedure.cache.hit', false)
		return result
	})
}

/**
 * Builder class for creating procedures with a type-safe API.
 * Enables chaining methods to require parameters, query, body, and handlers.
 */
export class ProcedureBuilder<
	Ctx extends Context,
	Params extends ObjectSchema | undefined,
	Query extends ObjectSchema | undefined,
	Body extends ObjectSchema | undefined,
	Errors extends ErrorTable = NoErrors
> {
	private _state: ProcedureArgs<Params, Query, Body, Errors> & {
		keys?: ProcedureFn<Ctx, Params, Query, Body, string[], Errors>
	}

	constructor(base: ProcedureArgs<Params, Query, Body, Errors>) {
		this._state = base
	}

	/**
	 * Creates a new builder with applied changes.
	 * @param changes - Partial procedure configuration to apply
	 * @returns A new ProcedureBuilder with updated configuration
	 * @private
	 */
	private _apply = <
		P extends ObjectSchema | undefined,
		Q extends ObjectSchema | undefined,
		B extends ObjectSchema | undefined
	>(
		changes: Partial<ProcedureArgs<P, Q, B, Errors> & {
			keys?: ProcedureFn<Ctx, Params, Query, Body, string[], Errors>
		}>
	): ProcedureBuilder<Ctx, P, Q, B, Errors> => {
		return new ProcedureBuilder<Ctx, P, Q, B, Errors>({
			...this._state,
			...changes
		} as ProcedureArgs<P, Q, B, Errors>)
	}

	/**
	 * Adds or merges route parameter definitions to the procedure.
	 * @param params - The TypeBox schema defining the route parameters
	 */
	public params = <T extends ObjectSchema>(params: SafeTObject<T, Params>) => {
		const mergedParams = merge(this._state.params, params)
		return this._apply<MergedObject<SafeTObject<T, Params>, Params>, Query, Body>({
			params: mergedParams
		})
	}

	/**
	 * Adds or merges query parameter definitions to the procedure.
	 * @param query - The TypeBox schema defining the query parameters
	 */
	public query = <T extends ObjectSchema>(query: SafeTObject<T, Query>) => {
		const mergedQuery = merge(this._state.query, query)
		return this._apply<Params, MergedObject<SafeTObject<T, Query>, Query>, Body>({
			query: mergedQuery
		})
	}

	/**
	 * Adds or merges request body definitions to the procedure.
	 * @param body - The TypeBox schema defining the request body
	 */
	public body = <T extends ObjectSchema>(body: SafeTObject<T, Body>) => {
		const mergedBody = merge(this._state.body, body)
		return this._apply<Params, Query, MergedObject<SafeTObject<T, Body>, Body>>({
			body: mergedBody
		})
	}

	/**
	 * Adds cache keys to the procedure.
	 * @param keys - The function to compute the cache keys
	 */
	public cache = (keys: ProcedureFn<Ctx, Params, Query, Body, string[], Errors>) => this._apply<Params, Query, Body>({ keys })

	/**
		 * Builds this procedure with the given handler function.
		 * @param handler - The function to execute when this procedure is called
		 * @returns A built procedure with the given handler
		 */
	public build = <Next extends object | void>(handler?: ProcedureFn<Ctx, Params, Query, Body, Next, Errors>): Procedure<MergedContext<Ctx, Next>, Params, Query, Body, Errors> => {
		if (handler) {
			const middleware = new Middleware<Ctx, Params, Query, Body, Next, Errors>(handler, this._state.name, this._state.config, this._state.keys)
			this._state.middlewares = [...this._state.middlewares, middleware]
		}

		return new Procedure<MergedContext<Ctx, Next>, Params, Query, Body, Errors>(this._state)
	}
}


/**
 * A procedure acts as a base for creating actions.
 * It predefines and handles parameters, query, body, and middlewares.
 * The procedure can be extended to create more specific procedures
 * or used to create actions directly.
 */
export class Procedure<
	Ctx extends Context,
	Params extends ObjectSchema | undefined,
	Query extends ObjectSchema | undefined,
	Body extends ObjectSchema | undefined,
	Errors extends ErrorTable = NoErrors
> {
	/** TypeBox schema for route parameters */
	params: Params
	/** TypeBox schema for query parameters */
	query: Query
	/** TypeBox schema for request body */
	body: Body
	/** Chain of middleware to execute before the main action handler */
	middlewares: AnyMiddleware[]
	/** Effective configuration of the procedure, including the merged error table */
	config: Config<Errors>

	constructor(base: ProcedureArgs<Params, Query, Body, Errors>) {
		this.params = base.params
		this.query = base.query
		this.body = base.body
		this.middlewares = base.middlewares
		this.config = base.config
	}

	/**
	 * Creates a new action from this procedure.
	 * @param name - Name of the action for identification
	 * @param details - API documentation details for the action, including additional errors
	 * @returns A new ActionBuilder instance
	 */
	public createAction = <const DetailErrors extends ErrorTable = NoErrors>(name: string, details?: Decorations<DetailErrors>) => {
		const errors = mergeErrors(this.config.errors, details?.errors)
		return new ActionBuilder<Ctx, Params, Query, Body, undefined, MergedErrors<Errors, DetailErrors>>({
			params: this.params,
			query: this.query,
			body: this.body,
			output: undefined,
			middlewares: this.middlewares,
			name,
			details: { ...details, errors } as Decorations<MergedErrors<Errors, DetailErrors>>,
		})
	}
}

/**
 * Creates a new procedure builder with typed params, query, and body.
 *
 * @param name - Descriptive name for the procedure (used in logs and debugging)
 * @param base - Optional base procedure to inherit from
 * @param config - Optional tracing and error configuration, merged onto the base procedure's
 *
 * @example
 * ```ts
 * const userProcedure = createProcedure('User Authentication')
 * 	.params(Type.Object({
 * 		id: Type.String()
 * 	}))
 * 	.handler(({ params }) => ({
 * 		user: {
 * 			id: params.id,
 * 			name: "John Doe"
 * 		}
 * 	}))
 * ```
 */
export const createProcedure = <
	Ctx extends Context,
	Params extends ObjectSchema | undefined = undefined,
	Query extends ObjectSchema | undefined = undefined,
	Body extends ObjectSchema | undefined = undefined,
	BaseErrors extends ErrorTable = NoErrors,
	const ConfigErrors extends ErrorTable = NoErrors
>(name: string, base?: Procedure<Ctx, Params, Query, Body, BaseErrors>, config: Config<ConfigErrors> = {}) => new ProcedureBuilder<Ctx, Params, Query, Body, MergedErrors<BaseErrors, ConfigErrors>>({
	params: base?.params as any,
	query: base?.query as any,
	body: base?.body as any,
	middlewares: base?.middlewares ?? [],
	name,
	config: {
		...config,
		errors: mergeErrors(base?.config.errors, config.errors)
	}
})