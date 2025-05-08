// import dependencies
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

// import types
import type { TSchema, TObject, Static } from '@sinclair/typebox'
import type { Context as ElysiaContext } from 'elysia'
import type { Context, ProcedureFnArgs, AnyMiddleware } from './procedure'
import type { MergeSchema } from './utils'

// define types
export type ActionDetails = Partial<{
	description: string
}>

export type ActionBuilderInput<
	Params extends TObject | undefined = undefined,
	Query extends TObject | undefined = undefined,
	Body extends TObject | undefined = undefined,
	Output extends TSchema | undefined = undefined
> = {
	params: Params
	query: Query
	body: Body
	output: Output
	middlewares: AnyMiddleware[]
	name: string
	details?: ActionDetails
}

export type ActionInput<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Output extends TSchema | undefined,
	Ctx extends Context,
> = ActionBuilderInput<Params, Query, Body, Output> & {
	fn: ActionFn<Params, Query, Body, Output, Ctx>
}

export type ActionFn<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Output extends TSchema | undefined,
	Ctx extends Context,
> = (input: ProcedureFnArgs<Params, Query, Body, Ctx>) => (Promise<Output extends TSchema ? Static<Output> : any>) | (Output extends TSchema ? Static<Output> : any)

export class Action<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Output extends TSchema | undefined,
	Ctx extends Context
> {
	private _fn: ActionFn<Params, Query, Body, Output, Ctx>
	private _middlewares: AnyMiddleware[]

	title: string
	description?: string
	params?: TSchema
	query?: TSchema
	body?: TSchema
	output?: TSchema

	constructor(input: ActionInput<Params, Query, Body, Output, Ctx>) {
		this._fn = input.fn
		this._middlewares = input.middlewares

		this.title = input.name
		this.description = input.description
		this.params = input.params
		this.query = input.query
		this.body = input.body
		this.output = input.output
	}

	public get docs() {
		return {
			params: this.params,
			query: this.query,
			body: this.body,
			response: this.output,
			detail: {
				summary: this.title,
				description: this.description,
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
	public handle = async (context: ElysiaContext) => {
		const { request, params, query, body } = context

		return await this._execute(request, {
			params: params as any,
			query: query as any,
			body: body as any,
		})
	}

	/**
	 * General handler for the action
	 * @param request The HTTP request
	 * @param input The inputs for the action
	 * @returns 
	 */
	public run = async (request: Request, input: {
		params: Params extends TObject ? Params : any,
		query: Query extends TObject ? Params : any,
		body: Body extends TObject ? Params : any,
	}) => {
		// run the action
		const result = await this._execute(request, input)

		// validate the output
		if (this.output) {
			const output = Value.Clean(this.output, result)
			Value.Assert(this.output, output)
			return output
		} else {
			return result
		}
	}

	private _execute = async (request: Request, input: {
		params: Params extends TObject ? Params : any,
		query: Query extends TObject ? Params : any,
		body: Body extends TObject ? Params : any,
	}) => {
		// validate the inputs
		const params = (this.params ? Value.Parse(this.params, input.params) : input.params)
		const query = (this.query ? Value.Parse(this.query, input.query) : input.query)
		const body = (this.body ? Value.Parse(this.body, input.body) : input.body)

		// create the base context
		let ctx = {
			request
		}

		// run the middlewares
		for (const middleware of this._middlewares) {
			console.log(`Middleware: ${middleware.name}`)
			console.profile(`Middleware: ${middleware.name}`)
			const out = await middleware.fn({ params, query, body, ctx })
			if (out) ctx = { ...ctx, ...out }
			console.profileEnd(`Middleware: ${middleware.name}`)
		}

		// run the action
		return await this._fn({
			params: params as any,
			query: query as any,
			body: body as any,
			ctx: ctx as Ctx
		})
	}
}

export class ActionBuilder<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Output extends TSchema | undefined,
	Ctx extends Context
> {
	private _params: Params
	private _query: Query
	private _body: Body
	private _output: Output
	private _middlewares: AnyMiddleware[]
	private _name: string
	private _description?: string

	constructor(base: ActionBuilderInput<Params, Query, Body, Output>) {
		this._params = base.params as Params
		this._query = base.query as Query
		this._body = base.body as Body
		this._output = base.output as Output
		this._middlewares = base.middlewares
		this._name = base.name
		this._description = base.description
	}

	public params<T extends TObject>(params: T) {
		return new ActionBuilder<MergeSchema<Params, T>, Query, Body, Output, Ctx>({
			params: Type.Intersect([...(this._params ? [this._params] : []), params]) as MergeSchema<Params, T>,
			query: this._query,
			body: this._body,
			output: this._output,
			middlewares: this._middlewares,
			name: this._name,
			description: this._description,
		})
	}

	public query<T extends TObject>(query: T) {
		return new ActionBuilder<Params, MergeSchema<Query, T>, Body, Output, Ctx>({
			params: this._params,
			query: Type.Intersect([...(this._query ? [this._query] : []), query]) as MergeSchema<Query, T>,
			body: this._body,
			output: this._output,
			middlewares: this._middlewares,
			name: this._name,
			description: this._description,
		})
	}

	public body<T extends TObject>(body: T) {
		return new ActionBuilder<Params, Query, MergeSchema<Body, T>, Output, Ctx>({
			params: this._params,
			query: this._query,
			body: Type.Intersect([...(this._body ? [this._body] : []), body]) as MergeSchema<Body, T>,
			output: this._output,
			middlewares: this._middlewares,
			name: this._name,
			description: this._description,
		})
	}

	public output<T extends TSchema>(output: T) {
		return new ActionBuilder<Params, Query, Body, T, Ctx>({
			params: this._params,
			query: this._query,
			body: this._body,
			output,
			middlewares: this._middlewares,
			name: this._name,
			description: this._description,
		})
	}

	public handler(fn: ActionFn<Params, Query, Body, Output, Ctx>) {
		return new Action<Params, Query, Body, Output, Ctx>({
			fn,
			params: this._params,
			query: this._query,
			body: this._body,
			output: this._output,
			middlewares: this._middlewares,
			name: this._name,
			description: this._description,
		})
	}
}