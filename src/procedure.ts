// import dependencies
import { Type } from '@sinclair/typebox'
import { ActionBuilder } from './action'

// import types
import type { TSchema, Static, TObject } from '@sinclair/typebox'
import type { MergeSchema, MergeObject } from './utils'

// define types
export type ProcedureInput<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
> = {
	params?: Params
	query?: Query
	body?: Body
	middlewares: AnyProcedureFn[]
}

export type ProcedureFnArgs<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Ctx extends Context
> = {
	params: Params extends TSchema ? Static<Params> : undefined
	query: Query extends TSchema ? Static<Query> : undefined
	body: Body extends TSchema ? Static<Body> : undefined
	ctx: Ctx
}

export type ProcedureFn<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Ctx extends Context,
	Next = object | void
> = (input: ProcedureFnArgs<Params, Query, Body, Ctx>) => Promise<Next> | Next
export type AnyProcedureFn = ProcedureFn<any, any, any, any>

export type Context = {
	request: Request
}

/**
 * Procedure class
 */
class Procedure<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Ctx extends Context
> {
	// Define the procedure properties
	params: Params
	query: Query
	body: Body
	middlewares: AnyProcedureFn[]

	constructor(base: ProcedureInput<Params, Query, Body>) {
		this.params = base.params as Params
		this.query = base.query as Query
		this.body = base.body as Body
		this.middlewares = base.middlewares
	}

	// return an action builder based on the procedure
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
 * ProcedureBuilder class
 */
class ProcedureBuilder<
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Ctx extends Context
> {
	private _params: Params
	private _query: Query
	private _body: Body
	private _middlewares: AnyProcedureFn[]

	constructor(base: ProcedureInput<Params, Query, Body>) {
		this._params = base.params as Params
		this._query = base.query as Query
		this._body = base.body as Body
		this._middlewares = base?.middlewares ?? []
	}

	public params<T extends TObject>(params: T) {
		return new ProcedureBuilder<MergeSchema<Params, T>, Query, Body, Ctx>({
			params: Type.Intersect([...(this._params ? [this._params] : []), params]) as MergeSchema<Params, T>,
			query: this._query,
			body: this._body,
			middlewares: this._middlewares,
		})
	}

	public query<T extends TObject>(query: T) {
		return new ProcedureBuilder<Params, MergeSchema<Query, T>, Body, Ctx>({
			params: this._params,
			query: Type.Intersect([...(this._query ? [this._query] : []), query]) as MergeSchema<Query, T>,
			body: this._body,
			middlewares: this._middlewares,
		})
	}

	public body<T extends TObject>(body: T) {
		return new ProcedureBuilder<Params, Query, MergeSchema<Body, T>, Ctx>({
			params: this._params,
			query: this._query,
			body: Type.Intersect([...(this._body ? [this._body] : []), body]) as MergeSchema<Body, T>,
			middlewares: this._middlewares,
		})
	}

	public handler<Next extends Object | void>(fn: ProcedureFn<Params, Query, Body, Ctx, Next>) {
		this._middlewares = [...this._middlewares, fn]
		return new Procedure<Params, Query, Body, Context & MergeObject<Ctx, Next>>({
			params: this._params,
			query: this._query,
			body: this._body,
			middlewares: this._middlewares,
		})
	}
}

/**
 * Create a new procedure
 * @param base - base procedure to extend
 */
export const createProcedure = <
	Params extends TSchema | undefined,
	Query extends TSchema | undefined,
	Body extends TSchema | undefined,
	Ctx extends Context
>(base?: Procedure<Params, Query, Body, Ctx>) => new ProcedureBuilder<Params, Query, Body, Ctx>({
	params: base?.params ?? undefined,
	query: base?.query ?? undefined,
	body: base?.body ?? undefined,
	middlewares: base?.middlewares ?? [],
})
