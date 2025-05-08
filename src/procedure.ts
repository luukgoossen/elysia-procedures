// import dependencies
import { Type } from '@sinclair/typebox'
import { ActionBuilder } from './action'

// import types
import type { TSchema, Static, TObject } from '@sinclair/typebox'
import type { MergeSchema, MergeObject } from './utils'

/**
 * Configuration arguments for creating a procedure
 */
export type ProcedureArgs<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
> = {
	/** Schema for route parameters */
	params?: Params
	/** Schema for query parameters */
	query?: Query
	/** Schema for request body */
	body?: Body
	/** Chain of middleware to execute before the main action handler */
	middlewares: AnyMiddleware[]
	/** Name of the procedure for identification */
	name: string
	/** Optional description of what the procedure does for logging purposes */
	role?: string
}

/**
 * Arguments passed to procedure handler functions
 */
export type ProcedureFnArgs<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Ctx extends Context
> = {
	/** Parsed and validated route parameters */
	params: Params extends TSchema ? Static<Params> : undefined
	/** Parsed and validated query parameters */
	query: Query extends TSchema ? Static<Query> : undefined
	/** Parsed and validated request body */
	body: Body extends TSchema ? Static<Body> : undefined
	/** Context object with request data and middleware results */
	ctx: Ctx
}

/**
 * Function type for procedure middleware functions
 */
export type ProcedureFn<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Ctx extends Context,
	Next = object | void
> = (input: ProcedureFnArgs<Params, Query, Body, Ctx>) => Promise<Next> | Next

/**
 * Type alias for any middleware type
 */
export type AnyMiddleware = Middleware<any, any, any, any>

/**
 * Base context available in all procedures
 */
export type Context = {
	/** The received HTTP request */
	request: Request
}

/**
 * Middleware class representing a function to run during request processing.
 * A middleware processes requests before they reach the main action handler.
 */
class Middleware<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Ctx extends Context,
	Next = object | void
> {
	/** The middleware function to execute */
	fn: ProcedureFn<Params, Query, Body, Ctx, Next>
	/** Name of the middleware for identification */
	name: string
	/** Optional description of what the middleware does for logging purposes */
	role?: string

	constructor(fn: ProcedureFn<Params, Query, Body, Ctx, Next>, name: string, role?: string) {
		this.fn = fn
		this.name = name
		this.role = role
	}
}

/**
 * A procedure acts as a base for creating actions.
 * It predefines and handles parameters, query, body, and middlewares.
 * The procedure can be extended to create more specific procedures
 * or used to create actions directly.
 */
class Procedure<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Ctx extends Context
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
		this.params = base.params as Params
		this.query = base.query as Query
		this.body = base.body as Body
		this.middlewares = base.middlewares
	}

	/**
	 * Creates a new action from this procedure
	 * @param name - The name of the action
	 * @param options - Optional configuration options
	 * @param options.description - Optional description of what the action does for API documentation
	 * @returns A new ActionBuilder instance
	 */
	public createAction(name: string, options?: { description?: string }) {
		return new ActionBuilder<Params, Query, Body, undefined, Ctx>({
			params: this.params,
			query: this.query,
			body: this.body,
			output: undefined,
			middlewares: this.middlewares,
			name,
			description: options?.description,
		})
	}
}

/**
 * Builder class for creating procedures with a type-safe API.
 * Enables chaining methods to require parameters, query, body, and handlers.
 */
class ProcedureBuilder<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Ctx extends Context
> {
	private _properties: ProcedureArgs<Params, Query, Body>

	constructor(base: ProcedureArgs<Params, Query, Body>) {
		this._properties = base
	}

	/**
	 * Creates a new builder with applied changes
	 * @param changes - Partial procedure configuration to apply
	 * @returns A new ProcedureBuilder with updated configuration
	 * @private
	 */
	private _apply<
		P extends TSchema | undefined,
		Q extends TSchema | undefined,
		B extends TSchema | undefined
	>(
		changes: Partial<ProcedureArgs<P, Q, B>>
	): ProcedureBuilder<P, Q, B, Ctx> {
		return new ProcedureBuilder<P, Q, B, Ctx>({
			...this._properties,
			...changes
		} as ProcedureArgs<P, Q, B>)
	}

	/**
	 * Merges two TypeBox schemas together
	 * @param prev - Previous schema (if any)
	 * @param next - New schema to merge
	 * @returns Merged schema
	 * @private
	 */
	private _merge<Prev extends TSchema | undefined, Next extends TObject>(
		prev: Prev,
		next: Next
	) {
		if (!prev) return next
		return Type.Intersect([prev, next])
	}

	/**
	 * Adds or merges route parameter definitions to the procedure
	 * @param params - The TypeBox schema defining the route parameters
	 */
	public params<T extends TObject>(params: T) {
		const mergedParams = this._merge(this._properties.params, params) as MergeSchema<Params, T>
		return this._apply<MergeSchema<Params, T>, Query, Body>({
			params: mergedParams
		})
	}

	/**
	 * Adds or merges query parameter definitions to the procedure
	 * @param query - The TypeBox schema defining the query parameters
	 */
	public query<T extends TObject>(query: T) {
		const mergedQuery = this._merge(this._properties.query, query) as MergeSchema<Query, T>
		return this._apply<Params, MergeSchema<Query, T>, Body>({
			query: mergedQuery
		})
	}

	/**
	 * Adds or merges request body definitions to the procedure
	 * @param body - The TypeBox schema defining the request body
	 */
	public body<T extends TObject>(body: T) {
		const mergedBody = this._merge(this._properties.body, body) as MergeSchema<Body, T>
		return this._apply<Params, Query, MergeSchema<Body, T>>({
			body: mergedBody
		})
	}

	/**
	 * Builds this procedure with the given handler function.
	 * @param fn - The function to execute when this procedure is called
	 * @returns A built procedure with the given handler
	 */
	public handler<Next extends Object | void>(fn: ProcedureFn<Params, Query, Body, Ctx, Next>) {
		const middleware = new Middleware<Params, Query, Body, Ctx, Next>(fn, this._properties.name, this._properties.role)
		this._properties.middlewares = [...this._properties.middlewares, middleware]

		return new Procedure<Params, Query, Body, Context & MergeObject<Ctx, Next>>(this._properties)
	}
}

/**
 * Creates a new procedure builder with typed params, query, and body
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
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Ctx extends Context
>(name: string, base?: Procedure<Params, Query, Body, Ctx>, role?: string) => new ProcedureBuilder<Params, Query, Body, Ctx>({
	params: base?.params ?? undefined,
	query: base?.query ?? undefined,
	body: base?.body ?? undefined,
	middlewares: base?.middlewares ?? [],
	name,
	role,
})