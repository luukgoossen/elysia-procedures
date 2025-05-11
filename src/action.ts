// import dependencies
import { Value } from '@sinclair/typebox/value'
import { merge, type SafeTObject } from './utils'
import { record } from '@elysiajs/opentelemetry'

// import types
import type { TSchema, TObject, Static } from '@sinclair/typebox'
import type { Promisable } from 'type-fest'
import type { Context, ProcedureFnArgs, AnyMiddleware } from './procedure'

/**
 * API documentation details for the action.
 */
export type ActionDetails = Partial<{
	/** Explaination of what the action does */
	description: string
}>

/**
 * Configuration arguments for creating an action builder.
 */
export type ActionBuilderArgs<
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined,
	Output extends TSchema | undefined
> = {
	/** TypeBox schema for route parameters */
	params: Params
	/** TypeBox schema for query parameters */
	query: Query
	/** TypeBox schema for request body */
	body: Body
	/** TypeBox schema for response output */
	output: Output
	/** Chain of middleware to execute before the action's main handler function */
	middlewares: AnyMiddleware[]
	/** Name of the action for identification */
	name: string
	/** API documentation details for the action */
	details?: ActionDetails
}

/**
 * Configuration arguments for creating an action.
 */
export type ActionArgs<
	Ctx extends Context,
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined,
	Output extends TSchema | undefined
> = ActionBuilderArgs<Params, Query, Body, Output> & {
	/** The main handler function of the action */
	handler: ActionFn<Ctx, Params, Query, Body, Output>
}

/**
 * Function type for action's main handler functions.
 */
export type ActionFn<
	Ctx extends Context,
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined,
	Output extends TSchema | undefined,
	Out = Output extends TSchema ? Static<Output> : any
> = (input: ProcedureFnArgs<Ctx, Params, Query, Body>) => Promisable<Out>

/**
 * Builder class for creating actions with a type-safe API.
 * Enables chaining methods to require parameters, query, body, output and handlers.
 */
export class ActionBuilder<
	Ctx extends Context,
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined,
	Output extends TSchema | undefined,
> {
	private _state: ActionBuilderArgs<Params, Query, Body, Output>

	constructor(base: ActionBuilderArgs<Params, Query, Body, Output>) {
		this._state = base
	}

	/**
	 * Creates a new builder with applied changes.
	 * @param changes - Partial action configuration to apply
	 * @returns A new ActionBuilder with updated configuration
	 * @private
	 */
	private _apply = <
		P extends TObject | undefined,
		Q extends TObject | undefined,
		B extends TObject | undefined,
		O extends TSchema | undefined
	>(
		changes: Partial<ActionBuilderArgs<P, Q, B, O>>
	): ActionBuilder<Ctx, P, Q, B, O> => {
		return new ActionBuilder<Ctx, P, Q, B, O>({
			...this._state,
			...changes
		} as ActionBuilderArgs<P, Q, B, O>)
	}

	/**
	 * Adds or merges route parameter definitions to the action.
	 * @param params - The TypeBox schema defining the route parameters
	 */
	public params = <T extends TObject>(params: SafeTObject<T, Params>) => {
		const mergedParams = merge(this._state.params, params)
		return this._apply<typeof mergedParams, Query, Body, Output>({
			params: mergedParams
		})
	}

	/**
	 * Adds or merges query parameter definitions to the action.
	 * @param query - The TypeBox schema defining the query parameters
	 */
	public query = <T extends TObject>(query: SafeTObject<T, Query>) => {
		const mergedQuery = merge(this._state.query, query)
		return this._apply<Params, typeof mergedQuery, Body, Output>({
			query: mergedQuery
		})
	}

	/**
	 * Adds or merges request body definitions to the action.
	 * @param body - The TypeBox schema defining the request body
	 */
	public body = <T extends TObject>(body: SafeTObject<T, Body>) => {
		const mergedBody = merge(this._state.body, body)
		return this._apply<Params, Query, typeof mergedBody, Output>({
			body: mergedBody
		})
	}

	/**
	 * Adds response output definitions to the action.
	 * @param output - The TypeBox schema defining the reponse output
	 */
	public output = <T extends TSchema>(output: T) => this._apply<Params, Query, Body, T>({
		output
	})

	/**
	 * Builds this action with the given handler function.
	 * @param handler - The function to execute when this action is called
	 * @returns A built action with the given handler
	 */
	public build = <Out>(handler: ActionFn<Ctx, Params, Query, Body, Output, Output extends TSchema ? Static<Output> : Out>) => {
		return new Action<Ctx, Params, Query, Body, Output, Output extends TSchema ? Static<Output> : Out>({
			handler: handler as any,
			...this._state
		})
	}
}

/**
 * An action is a common interface to query or mutate data.
 * It contains both the business logic and the API documentation.
 */
export class Action<
	Ctx extends Context,
	Params extends TObject | undefined,
	Query extends TObject | undefined,
	Body extends TObject | undefined,
	Output extends TSchema | undefined,
	Out,
> {
	private _handler: ActionFn<Ctx, Params, Query, Body, Output>
	private _middlewares: AnyMiddleware[]

	/** Name of the action for identification */
	name: string
	/** API documentation details for the action */
	details?: ActionDetails
	/** TypeBox schema for route parameters */
	params: Params
	/** TypeBox schema for query parameters */
	query: Query
	/** TypeBox schema for request body */
	body: Body
	/** TypeBox schema for response output */
	output: Output

	constructor(input: ActionArgs<Ctx, Params, Query, Body, Output>) {
		this._handler = input.handler
		this._middlewares = input.middlewares

		this.name = input.name
		this.details = input.details
		this.params = input.params
		this.query = input.query
		this.body = input.body
		this.output = input.output
	}

	/**
	 * The API documentation for the action in Elysia route handler format.
	 */
	public get docs() {
		return {
			params: this.params as any,
			query: this.query,
			body: this.body,
			response: this.output,
			detail: {
				summary: this.name,
				...this.details
			},
		}
	}

	/**
	 * Elysia handler for the action
	 *
	 * This method does not validate the inputs, as Elysia REST's handlers will do it for us with nicer errors.
	 * Do not use this method outside of Elysia's REST handlers.
	 * @param context The Elysia context
	 * @returns
	 */
	public handle = async (context: {
		request: Request
		params: Params extends TObject ? Static<Params> : any
		query: Query extends TObject ? Static<Query> : any
		body: Body extends TObject ? Static<Body> : any
	}) => {
		const { request, params, query, body } = context

		return await this._execute(request, {
			params: params,
			query: query,
			body: body,
		})
	}

	/**
	 * General handler for the action
	 * @param request The HTTP request
	 * @param input The inputs for the action
	 * @returns
	 */
	public run = async (request: Request, input: {
		params: Params extends TObject ? Static<Params> : any,
		query: Query extends TObject ? Static<Query> : any,
		body: Body extends TObject ? Static<Body> : any,
	}): Promise<Out> => {
		// validate the params
		let params = input.params
		if (this.params) {
			params = this.params ? Value.Parse(this.params, input.params) : input.params
		}

		// validate the query
		let query = input.query
		if (this.query) {
			query = this.query ? Value.Parse(this.query, input.query) : input.query
		}

		// validate the body
		let body = input.body
		if (this.body) {
			body = this.body ? Value.Parse(this.body, input.body) : input.body
		}

		// run the action
		const result = await this._execute(request, {
			params,
			query,
			body
		})

		// validate the output
		return this.output ? Value.Parse(this.output, result) : result
	}

	private _execute = async (request: Request, input: {
		params: Params extends TObject ? Static<Params> : any,
		query: Query extends TObject ? Static<Query> : any,
		body: Body extends TObject ? Static<Body> : any,
	}): Promise<Out> => {
		// create the base context
		let ctx = {
			request
		}

		// run the middlewares
		for (const middleware of this._middlewares) {
			await record(middleware.name, {
				attributes: {
					type: 'middleware',
					action: this.name,
				}
			}, async () => {
				const out = await middleware.execute({ params: input.params, query: input.query, body: input.body, ctx })
				if (out) ctx = { ...ctx, ...out }
			})
		}

		// run the action
		return record(this.name, {
			attributes: {
				type: 'handler',
				action: this.name,
			}
		}, async () => {
			return await this._handler({
				params: input.params,
				query: input.query,
				body: input.body,
				ctx: ctx as Ctx
			})
		})
	}
}