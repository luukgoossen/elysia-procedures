// import dependencies
import { ActionBuilder } from './action'
import { merge } from './utils'

// import types
import type { DocumentDecoration } from 'elysia'
import type { Static, TObject } from '@sinclair/typebox'
import type { Promisable, Simplify } from 'type-fest'
import type { Context, SafeTObject, MergedObject, MergedContext } from './utils'

// define a local middleware cache
const cache = new WeakMap<Request, Map<string, any>>()
const cacheKey = (id: string, array: string[]) => `${id}:[${array.join(',')}]`

/**
 * Configuration arguments for creating a procedure.
 */
export type ProcedureArgs<
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined
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
}

/**
 * Arguments passed to procedure handler functions.
 */
export type ProcedureFnArgs<
	Ctx extends Context,
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined
> = {
	/** Context object with request data and middleware results */
	ctx: Simplify<Ctx>
	/** Parsed and validated route parameters */
	params: Params extends TObject ? Static<Params> : undefined
	/** Parsed and validated query parameters */
	query: Query extends TObject ? Static<Query> : undefined
	/** Parsed and validated request body */
	body: Body extends TObject ? Static<Body> : undefined
}

/**
 * Function type for procedure middleware functions.
 */
export type ProcedureFn<
	Ctx extends Context,
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined,
	Next = object | void
> = (input: ProcedureFnArgs<Ctx, Params, Query, Body>) => Promisable<Next>

/**
 * Type alias for any middleware type.
 */
export type AnyMiddleware = Middleware<any, any, any, any>

/**
 * Middleware class representing a function to run during request processing.
 * A middleware processes requests before they reach the main action handler.
 */
export class Middleware<
	Ctx extends Context,
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined,
	Next = object | void
> {
	private _id: string = crypto.randomUUID()
	private _handler: ProcedureFn<Ctx, Params, Query, Body, Next>
	private _keys?: ProcedureFn<Ctx, Params, Query, Body, string[]>

	/** Name of the middleware for identification */
	name: string

	constructor(handler: ProcedureFn<Ctx, Params, Query, Body, Next>, name: string, keys?: ProcedureFn<Ctx, Params, Query, Body, string[]>) {
		this._handler = handler
		this._keys = keys
		this.name = name
	}

	/**
	 * Executes this middleware with the provided input
	 * @param input - The current procedure arguments
	 * @returns - The additional context created by the middleware to be merged into the procedure
	 */
	public execute = async (input: ProcedureFnArgs<Ctx, Params, Query, Body>) => {
		if (!this._keys) return await this._handler(input)

		// compute a cache key based on the name and input params, query, and body
		const key = cacheKey(this._id, await this._keys(input))

		// check if the middleware has already been executed
		const cached = cache.get(input.ctx.request) ?? new Map()
		if (cached.has(key)) return cached.get(key)

		// execute the middleware handler
		const result = await this._handler(input)

		// store the result in the cache, use null for void results
		cached.set(key, result ?? null)
		cache.set(input.ctx.request, cached)
		return result
	}
}

/**
 * Builder class for creating procedures with a type-safe API.
 * Enables chaining methods to require parameters, query, body, and handlers.
 */
export class ProcedureBuilder<
	Ctx extends Context,
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined
> {
	private _state: ProcedureArgs<Params, Query, Body> & {
		keys?: ProcedureFn<Ctx, Params, Query, Body, string[]>
	}

	constructor(base: ProcedureArgs<Params, Query, Body>) {
		this._state = base
	}

	/**
	 * Creates a new builder with applied changes.
	 * @param changes - Partial procedure configuration to apply
	 * @returns A new ProcedureBuilder with updated configuration
	 * @private
	 */
	private _apply = <
		P extends TObject | undefined,
		Q extends TObject | undefined,
		B extends TObject | undefined
	>(
		changes: Partial<ProcedureArgs<P, Q, B> & {
			keys?: ProcedureFn<Ctx, Params, Query, Body, string[]>
		}>
	): ProcedureBuilder<Ctx, P, Q, B> => {
		return new ProcedureBuilder<Ctx, P, Q, B>({
			...this._state,
			...changes
		} as ProcedureArgs<P, Q, B>)
	}

	/**
	 * Adds or merges route parameter definitions to the procedure.
	 * @param params - The TypeBox schema defining the route parameters
	 */
	public params = <T extends TObject>(params: SafeTObject<T, Params>) => {
		const mergedParams = merge(this._state.params, params)
		return this._apply<MergedObject<SafeTObject<T, Params>, Params>, Query, Body>({
			params: mergedParams
		})
	}

	/**
	 * Adds or merges query parameter definitions to the procedure.
	 * @param query - The TypeBox schema defining the query parameters
	 */
	public query = <T extends TObject>(query: SafeTObject<T, Query>) => {
		const mergedQuery = merge(this._state.query, query)
		return this._apply<Params, MergedObject<SafeTObject<T, Query>, Query>, Body>({
			query: mergedQuery
		})
	}

	/**
	 * Adds or merges request body definitions to the procedure.
	 * @param body - The TypeBox schema defining the request body
	 */
	public body = <T extends TObject>(body: SafeTObject<T, Body>) => {
		const mergedBody = merge(this._state.body, body)
		return this._apply<Params, Query, MergedObject<SafeTObject<T, Body>, Body>>({
			body: mergedBody
		})
	}

	/**
	 * Adds cache keys to the procedure.
	 * @param keys - The function to compute the cache keys
	 */
	public cache = (keys: ProcedureFn<Ctx, Params, Query, Body, string[]>) => this._apply<Params, Query, Body>({ keys })

	/**
		 * Builds this procedure with the given handler function.
		 * @param handler - The function to execute when this procedure is called
		 * @returns A built procedure with the given handler
		 */
	public build = <Next extends object | void>(handler?: ProcedureFn<Ctx, Params, Query, Body, Next>): Procedure<MergedContext<Ctx, Next>, Params, Query, Body> => {
		if (handler) {
			const middleware = new Middleware<Ctx, Params, Query, Body, Next>(handler, this._state.name, this._state.keys)
			this._state.middlewares = [...this._state.middlewares, middleware]
		}

		return new Procedure<MergedContext<Ctx, Next>, Params, Query, Body>(this._state)
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
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined
> {
	/** TypeBox schema for route parameters */
	params: Params
	/** TypeBox schema for query parameters */
	query: Query
	/** TypeBox schema for request body */
	body: Body
	/** Chain of middleware to execute before the main action handler */
	middlewares: AnyMiddleware[]

	constructor(base: ProcedureArgs<Params, Query, Body>) {
		this.params = base.params
		this.query = base.query
		this.body = base.body
		this.middlewares = base.middlewares
	}

	/**
	 * Creates a new action from this procedure.
	 * @param name - Name of the action for identification
	 * @param details - API documentation details for the action
	 * @returns A new ActionBuilder instance
	 */
	public createAction = (name: string, details?: DocumentDecoration) => {
		return new ActionBuilder<Ctx, Params, Query, Body, undefined>({
			params: this.params,
			query: this.query,
			body: this.body,
			output: undefined,
			middlewares: this.middlewares,
			name,
			details,
		})
	}
}

/**
 * Creates a new procedure builder with typed params, query, and body.
 *
 * @param name - Descriptive name for the procedure (used in logs and debugging)
 * @param base - Optional base procedure to inherit from
 * @param role - Optional role for authorization purposes
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
	Params extends TObject | undefined = undefined,
	Query extends TObject | undefined = undefined,
	Body extends TObject | undefined = undefined
>(name: string, base?: Procedure<Ctx, Params, Query, Body>) => new ProcedureBuilder<Ctx, Params, Query, Body>({
	params: base?.params as any,
	query: base?.query as any,
	body: base?.body as any,
	middlewares: base?.middlewares ?? [],
	name,
})