// import dependencies
import { ActionBuilder } from './action'
import { merge } from './utils'

// import types
import type { Static, TObject } from '@sinclair/typebox'
import type { Merge, Promisable, Simplify } from 'type-fest'
import type { ActionDetails } from './action'

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
 * Base context available in all procedures.
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
	Ctx extends Context,
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined,
	Next = object | void
> {
	private _handler: ProcedureFn<Ctx, Params, Query, Body, Next>

	/** Name of the middleware for identification */
	name: string

	constructor(handler: ProcedureFn<Ctx, Params, Query, Body, Next>, name: string) {
		this._handler = handler
		this.name = name
	}

	/**
	 * Executes this middleware with the provided input
	 * @param input - The current procedure arguments
	 * @returns - The additional context created by the middleware to be merged into the procedure
	 */
	public execute = async (input: ProcedureFnArgs<Ctx, Params, Query, Body>) => {
		return await this._handler(input)
	}
}

/**
 * Builder class for creating procedures with a type-safe API.
 * Enables chaining methods to require parameters, query, body, and handlers.
 */
class ProcedureBuilder<
	Ctx extends Context,
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined
> {
	private _state: ProcedureArgs<Params, Query, Body>

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
		changes: Partial<ProcedureArgs<P, Q, B>>
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
	public params = <T extends TObject>(params: T) => {
		const mergedParams = merge(this._state.params, params)
		return this._apply<typeof mergedParams, Query, Body>({
			params: mergedParams
		})
	}

	/**
	 * Adds or merges query parameter definitions to the procedure.
	 * @param query - The TypeBox schema defining the query parameters
	 */
	public query = <T extends TObject>(query: T) => {
		const mergedQuery = merge(this._state.query, query)
		return this._apply<Params, typeof mergedQuery, Body>({
			query: mergedQuery
		})
	}

	/**
	 * Adds or merges request body definitions to the procedure.
	 * @param body - The TypeBox schema defining the request body
	 */
	public body = <T extends TObject>(body: T) => {
		const mergedBody = merge(this._state.body, body)
		return this._apply<Params, Query, typeof mergedBody>({
			body: mergedBody
		})
	}

	/**
	 * Builds this procedure with the given handler function.
	 * @param handler - The function to execute when this procedure is called
	 * @returns A built procedure with the given handler
	 */
	public build = <Next extends object | void>(handler?: ProcedureFn<Ctx, Params, Query, Body, Next>) => {
		if (handler) {
			const middleware = new Middleware<Ctx, Params, Query, Body, Next>(handler, this._state.name)
			this._state.middlewares = [...this._state.middlewares, middleware]
		}

		return new Procedure<Simplify<Context & Merge<Ctx, Next extends object ? Next : unknown>>, Params, Query, Body>(this._state)
	}
}


/**
 * A procedure acts as a base for creating actions.
 * It predefines and handles parameters, query, body, and middlewares.
 * The procedure can be extended to create more specific procedures
 * or used to create actions directly.
 */
class Procedure<
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
	public createAction = (name: string, details?: ActionDetails) => {
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