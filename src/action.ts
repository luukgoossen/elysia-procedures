// import dependencies
import { Value } from '@sinclair/typebox/value'
import { merge, toCamelCase } from './utils'
import { trace } from './trace'
import { createErrorFactory, statusesOf } from './error'

// import types
import type { TSchema, Static } from '@sinclair/typebox'
import type { Promisable, Simplify } from 'type-fest'
import type { ProcedureFnArgs, AnyMiddleware } from './procedure'
import type { Context, ObjectSchema, SafeTObject, MergedObject, Decorations } from './utils'
import type { DocumentDecoration } from 'elysia'
import type { ErrorFactory, ErrorTable, DefaultErrors, NoErrors, Problem, ValidationProblem } from './error'

/**
 * Configuration arguments for creating an action builder.
 */
export type ActionBuilderArgs<
	Params extends ObjectSchema | undefined,
	Query extends ObjectSchema | undefined,
	Body extends ObjectSchema | undefined,
	Output extends TSchema | undefined,
	Errors extends ErrorTable = NoErrors
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
	/** API documentation details for the action, including the effective error configuration */
	details?: Decorations<Errors>
}

/**
 * Configuration arguments for creating an action.
 */
export type ActionArgs<
	Ctx extends Context,
	Params extends ObjectSchema | undefined,
	Query extends ObjectSchema | undefined,
	Body extends ObjectSchema | undefined,
	Output extends TSchema | undefined,
	Errors extends ErrorTable = NoErrors
> = ActionBuilderArgs<Params, Query, Body, Output, Errors> & {
	/** The main handler function of the action */
	handler: ActionFn<Ctx, Params, Query, Body, Output, any, Errors>
}

/**
 * Function type for action's main handler functions.
 */
export type ActionFn<
	Ctx extends Context,
	Params extends ObjectSchema | undefined,
	Query extends ObjectSchema | undefined,
	Body extends ObjectSchema | undefined,
	Output extends TSchema | undefined,
	Out = Output extends TSchema ? Static<Output> : any,
	Errors extends ErrorTable = NoErrors
> = (input: ProcedureFnArgs<Ctx, Params, Query, Body>, onError: ErrorFactory<Errors>) => Promisable<Out>

/**
 * The response schemas an action documents, keyed by status: the output under 200, `ValidationProblem` under 422
 * and `Problem` under every other status in the error table.
 *
 * At runtime the error entries are the model names `'Problem'` and `'ValidationProblem'`. Elysia resolves those from
 * the models the procedures() plugin registers on the root app, and `@elysiajs/openapi` emits them as `$ref`s. The
 * type uses the schemas themselves, so routes typecheck on any instance, not only on one whose type carries the models.
 *
 * Error statuses only show up in the type when the table keeps them literal (inline literals or `defineError`).
 * A status widened to `number` documents nothing.
 */
export type ActionResponses<Output extends TSchema | undefined, Errors extends ErrorTable> = Simplify<
(Output extends TSchema ? { 200: Output } : unknown)
& ErrorResponses<(Errors[keyof Errors] | DefaultErrors[keyof DefaultErrors])['status']>
>

type ErrorResponses<Status extends number> = number extends Status ? unknown : { [S in Status]: S extends 422 ? typeof ValidationProblem : typeof Problem }

/**
 * Builder class for creating actions with a type-safe API.
 * Enables chaining methods to require parameters, query, body, output and handlers.
 */
export class ActionBuilder<
	Ctx extends Context,
	Params extends ObjectSchema | undefined,
	Query extends ObjectSchema | undefined,
	Body extends ObjectSchema | undefined,
	Output extends TSchema | undefined,
	Errors extends ErrorTable = NoErrors
> {
	private _state: ActionBuilderArgs<Params, Query, Body, Output, Errors>

	constructor(base: ActionBuilderArgs<Params, Query, Body, Output, Errors>) {
		this._state = base
	}

	/**
	 * Creates a new builder with applied changes.
	 * @param changes - Partial action configuration to apply
	 * @returns A new ActionBuilder with updated configuration
	 * @private
	 */
	private _apply = <
		P extends ObjectSchema | undefined,
		Q extends ObjectSchema | undefined,
		B extends ObjectSchema | undefined,
		O extends TSchema | undefined
	>(
		changes: Partial<ActionBuilderArgs<P, Q, B, O, Errors>>
	): ActionBuilder<Ctx, P, Q, B, O, Errors> => {
		return new ActionBuilder<Ctx, P, Q, B, O, Errors>({
			...this._state,
			...changes
		} as ActionBuilderArgs<P, Q, B, O, Errors>)
	}

	/**
	 * Adds or merges route parameter definitions to the action.
	 * @param params - The TypeBox schema defining the route parameters
	 */
	public params = <T extends ObjectSchema>(params: SafeTObject<T, Params>) => {
		const mergedParams = merge(this._state.params, params)
		return this._apply<MergedObject<SafeTObject<T, Params>, Params>, Query, Body, Output>({
			params: mergedParams
		})
	}

	/**
	 * Adds or merges query parameter definitions to the action.
	 * @param query - The TypeBox schema defining the query parameters
	 */
	public query = <T extends ObjectSchema>(query: SafeTObject<T, Query>) => {
		const mergedQuery = merge(this._state.query, query)
		return this._apply<Params, MergedObject<SafeTObject<T, Query>, Query>, Body, Output>({
			query: mergedQuery
		})
	}

	/**
	 * Adds or merges request body definitions to the action.
	 * @param body - The TypeBox schema defining the request body
	 */
	public body = <T extends ObjectSchema>(body: SafeTObject<T, Body>) => {
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
	public build = <Out>(handler: ActionFn<Ctx, Params, Query, Body, Output, Output extends TSchema ? Static<Output> : Out, Errors>) => {
		return new Action<Ctx, Params, Query, Body, Output, Output extends TSchema ? Static<Output> : Out, Errors>({
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
	Params extends ObjectSchema | undefined,
	Query extends ObjectSchema | undefined,
	Body extends ObjectSchema | undefined,
	Output extends TSchema | undefined,
	Out,
	Errors extends ErrorTable = NoErrors
> {
	private _handler: ActionFn<Ctx, Params, Query, Body, Output, any, Errors>
	private _middlewares: AnyMiddleware[]
	private _onError: ErrorFactory<Errors>

	/** Name of the action for identification */
	name: string
	/** API documentation details for the action, including the effective error configuration */
	details?: Decorations<Errors>
	/** TypeBox schema for route parameters */
	params: Params
	/** TypeBox schema for query parameters */
	query: Query
	/** TypeBox schema for request body */
	body: Body
	/** TypeBox schema for response output */
	output: Output

	constructor(input: ActionArgs<Ctx, Params, Query, Body, Output, Errors>) {
		this._handler = input.handler
		this._middlewares = input.middlewares
		this._onError = createErrorFactory(input.details?.errors)

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
		const details = Object.fromEntries(Object.entries(this.details ?? {}).filter(([key]) => key !== 'errors' && key !== 'tracing')) as DocumentDecoration
		const statuses = statusesOf(this.details?.errors?.table ?? {})

		return {
			params: this.params as any,
			query: this.query,
			body: this.body,
			response: {
				...(this.output ? { 200: this.output } : {}),
				...Object.fromEntries(statuses.map(status => [status, status === 422 ? 'ValidationProblem' : 'Problem'])),
			} as ActionResponses<Output, Errors>,
			detail: {
				summary: this.name,
				operationId: toCamelCase(this.name),
				...details,
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
		params: Params extends ObjectSchema ? Static<Params> : any
		query: Query extends ObjectSchema ? Static<Query> : any
		body: Body extends ObjectSchema ? Static<Body> : any
	}) => trace('action', this.details?.tracing?.name ?? this.name, {
		'procedure.name': this.name,
		...this.details?.tracing?.attributes
	}, () => {
		const { params, query, body, ...ctx } = context

		return this._execute(ctx, {
			params: params,
			query: query,
			body: body,
		})
	})

	/**
	 * General handler for the action
	 * @param request The HTTP request
	 * @param input The inputs for the action
	 * @returns
	 */
	public run = async (ctx: Context, input: {
		params: Params extends ObjectSchema ? Static<Params> : any
		query: Query extends ObjectSchema ? Static<Query> : any
		body: Body extends ObjectSchema ? Static<Body> : any
	}): Promise<Out> => trace('action', this.details?.tracing?.name ?? this.name, {
		'procedure.name': this.name,
		...this.details?.tracing?.attributes
	}, async () => {
		let params = input.params
		let query = input.query
		let body = input.body

		// validate the input
		trace('input', this.details?.tracing?.name ?? this.name, { 'procedure.name': this.name }, () => {
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
		})

		// run the action
		const result = await this._execute(ctx, {
			params,
			query,
			body
		})

		// skip the output validation if no output schema is defined
		if (!this.output) return result

		// validate the output
		return trace('output', this.details?.tracing?.name ?? this.name, { 'procedure.name': this.name }, () => Value.Parse(this.output!, result))
	}) as Promise<Out>

	private _execute = async (ctx: Context, input: {
		params: Params extends ObjectSchema ? Static<Params> : any
		query: Query extends ObjectSchema ? Static<Query> : any
		body: Body extends ObjectSchema ? Static<Body> : any
	}): Promise<Out> => {

		// run the middlewares
		for (const middleware of this._middlewares) {
			const out = await middleware.execute({ params: input.params, query: input.query, body: input.body, ctx })
			if (out) ctx = { ...ctx, ...out }
		}

		// run the action
		return trace('handler', this.details?.tracing?.name ?? this.name, {
			'procedure.name': this.name,
			...this.details?.tracing?.attributes
		}, () => this._handler({
			params: input.params,
			query: input.query,
			body: input.body,
			ctx: ctx as Ctx
		}, this._onError))
	}
}