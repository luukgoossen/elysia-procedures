// import dependencies
import { Value } from '@sinclair/typebox/value'
import { merge, toCamelCase } from './utils'
import { trace } from './trace'

// import types
import type { TSchema, TObject, Static } from '@sinclair/typebox'
import type { Promisable } from 'type-fest'
import type { ProcedureFnArgs, AnyMiddleware } from './procedure'
import type { Context, SafeTObject, MergedObject, Decorations } from './utils'

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
	details?: Decorations
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
		return this._apply<MergedObject<SafeTObject<T, Params>, Params>, Query, Body, Output>({
			params: mergedParams
		})
	}

	/**
	 * Adds or merges query parameter definitions to the action.
	 * @param query - The TypeBox schema defining the query parameters
	 */
	public query = <T extends TObject>(query: SafeTObject<T, Query>) => {
		const mergedQuery = merge(this._state.query, query)
		return this._apply<Params, MergedObject<SafeTObject<T, Query>, Query>, Body, Output>({
			query: mergedQuery
		})
	}

	/**
	 * Adds or merges request body definitions to the action.
	 * @param body - The TypeBox schema defining the request body
	 */
	public body = <T extends TObject>(body: SafeTObject<T, Body>) => {
		const mergedBody = merge(this._state.body, body)
		return this._apply<Params, Query, MergedObject<SafeTObject<T, Body>, Body>, Output>({
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
	details?: Decorations
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
				operationId: toCamelCase(this.name),
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
	public handle = async (context: Context & {
		params: Params extends TObject ? Static<Params> : any
		query: Query extends TObject ? Static<Query> : any
		body: Body extends TObject ? Static<Body> : any
	}) => trace({
		name: this.name,
		op: 'procedure.action',
		startTime: performance.timeOrigin + performance.now(),
		attributes: {
			'procedure.type': 'action',
			'procedure.name': this.name,
		}
	}, async span => {
		const { params, query, body, ...ctx } = context

		const result = await this._execute(ctx, {
			params: params,
			query: query,
			body: body,
		})

		span?.end(performance.timeOrigin + performance.now())
		return result
	})

	/**
	 * General handler for the action
	 * @param request The HTTP request
	 * @param input The inputs for the action
	 * @returns
	 */
	public run = async (ctx: Context, input: {
		params: Params extends TObject ? Static<Params> : any,
		query: Query extends TObject ? Static<Query> : any,
		body: Body extends TObject ? Static<Body> : any,
	}): Promise<Out> => trace({
		name: this.name,
		op: 'procedure.action',
		startTime: performance.timeOrigin + performance.now(),
		attributes: {
			'procedure.type': 'action',
			'procedure.name': this.name,
		}
	}, async span => {
		let params = input.params
		let query = input.query
		let body = input.body

		// validate the input
		await trace({
			name: `${this.name}: Validate Input`,
			op: 'procedure.input',
			startTime: performance.timeOrigin + performance.now(),
			attributes: {
				'procedure.type': 'input',
				'procedure.name': this.name,
			}
		}, span => {
			// validate the params
			if (this.params) {
				params = this.params ? Value.Parse(this.params, input.params) : input.params
			}

			// validate the query
			if (this.query) {
				query = this.query ? Value.Parse(this.query, input.query) : input.query
			}

			// validate the body
			if (this.body) {
				body = this.body ? Value.Parse(this.body, input.body) : input.body
			}

			span?.end(performance.timeOrigin + performance.now())
		})

		// run the action
		const result = await this._execute(ctx, {
			params,
			query,
			body
		})

		// skip the output validation if no output schema is defined
		if (!this.output) {
			span?.end(performance.timeOrigin + performance.now())
			return result
		}

		// validate the output
		const output = await trace({
			name: `${this.name}: Validate Output`,
			op: 'procedure.output',
			startTime: performance.timeOrigin + performance.now(),
			attributes: {
				'procedure.type': 'output',
				'procedure.name': this.name,
			}
		}, span => {
			const output = Value.Parse(this.output!, result)

			span?.end(performance.timeOrigin + performance.now())
			return output
		})

		span?.end(performance.timeOrigin + performance.now())
		return output
	}) as Promise<Out>

	private _execute = async (ctx: Context, input: {
		params: Params extends TObject ? Static<Params> : any,
		query: Query extends TObject ? Static<Query> : any,
		body: Body extends TObject ? Static<Body> : any,
	}): Promise<Out> => {

		// run the middlewares
		for (const middleware of this._middlewares) {
			await trace({
				name: `Middleware: ${middleware.name}`,
				op: 'procedure.middleware',
				startTime: performance.timeOrigin + performance.now(),
				attributes: {
					'procedure.type': 'middleware',
					'procedure.name': middleware.name,
					...middleware.config.tracing?.attributes
				}
			}, async span => {
				const out = await middleware.execute({ params: input.params, query: input.query, body: input.body, ctx })
				if (out) ctx = { ...ctx, ...out }
				
				span?.end(performance.timeOrigin + performance.now())
			})
		}

		// run the action
		return await trace({
			name: `${this.name}: Handler`,
			op: 'procedure.handler',
			startTime: performance.timeOrigin + performance.now(),
			attributes: {
				'procedure.type': 'handler',
				'procedure.name': this.name,
				...this.details?.tracing?.attributes
			}
		}, async span => {
			const result = await this._handler({
				params: input.params,
				query: input.query,
				body: input.body,
				ctx: ctx as Ctx
			})

			span?.end(performance.timeOrigin + performance.now())
			return result
		})
	}
}