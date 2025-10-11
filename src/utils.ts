// import dependencies
import { Type } from '@sinclair/typebox'
import type { DocumentDecoration } from 'elysia'

// import types
import type { TObject } from '@sinclair/typebox'
import type { Merge, Simplify } from 'type-fest'
import type { Cookie } from 'elysia'

/** Converts a string from Title Case to camelCase */
export const toCamelCase = (str: string): string =>
	str
		.replace(/(?:^\w|[A-Z]|\b\w)/g, (match, index) => index === 0 ? match.toLowerCase() : match.toUpperCase())
		.replace(/\s+/g, '')

/**
 * Merges two TypeBox object schemas into one.
 * The next schema's properties will override the previous schema's properties.
 * @param prev - The optional previous object schema.
 * @param next - The next object schema to merge with the previous one.
 * @returns A new object schema that combines properties from both schemas.
 */
export const merge = <
	Prev extends TObject | undefined,
	Next extends TObject | never,
>(prev: Prev, next: Next): MergedObject<Next, Prev> =>
	Type.Object({
		...next.properties,
		...(prev ? prev.properties : {}),
	}, { additionalProperties: false }) as any

/**
 * Base context available in all procedures.
 */
export type Context = {
	/** The received HTTP request */
	request: Request
	cookie: Record<string, Cookie<unknown>>
}

/**
 * API documentation details for an action or procedure.
 */
export type Decorations = DocumentDecoration & Config

/**
 * Tracing configuration for an action or procedure.
 */
export type Config = {
	tracing?: {
		name?: string
		attributes?: Record<string, unknown>
	}
}

/**
 * A utlity type that ensures a TObject (Next) does not have any overlapping properties with an opional reference TObject (Prev).
 */
export type SafeTObject<Next extends TObject, Prev extends TObject | undefined = undefined> = Prev extends TObject
	? (Extract<keyof Prev['properties'], keyof Next['properties']> extends never
		? Next
		: never)
	: Next

/**
 * A utility type that checks the properties of a TypeBox object schema.
 */
export type CheckProperties<T extends TObject | undefined> = T extends TObject ? T['properties'] : unknown

/**
 * A utility type that merges the properties of two TypeBox object schemas.
 * The second schema is optional and can be undefined.
 */
export type MergedProperties<Next extends TObject, Prev extends TObject | undefined = undefined> = Merge<Next['properties'], CheckProperties<Prev>>

/**
 * A utility type that merges two TypeBox objects into one.
 * The next schema's properties will override the previous schema's properties.
 */
export type MergedObject<
	Next extends TObject | never,
	Prev extends TObject | undefined = undefined,
> = Next extends TObject
	? TObject<Simplify<MergedProperties<Next, Prev>>>
	: Prev

/**
 * A utility type that merges the context of a procedure with an optional next context.
 * The next context can be an object or void.
 */
export type MergedContext<Ctx extends Context, Next extends object | void = void> = Simplify<Context & Merge<Ctx, Next extends object ? Next : unknown>>