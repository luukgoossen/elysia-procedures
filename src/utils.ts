// import dependencies
import { Type } from '@sinclair/typebox'
import type { DocumentDecoration } from 'elysia'
import type { Attributes } from '@opentelemetry/api'

// import types
import type { TObject, TProperties, TSchema } from '@sinclair/typebox'
import type { Simplify } from 'type-fest'
import type { Cookie } from 'elysia'
import type { ErrorConfig, ErrorTable } from './error'

/** Converts a string from Title Case to camelCase */
export const toCamelCase = (str: string): string =>
	str
		.replace(/(?:^\w|[A-Z]|\b\w)/g, (match, index) =>
			index === 0 ? match.toLowerCase() : match.toUpperCase(),
		)
		.replace(/\s+/g, '')

/**
 * Merges two TypeBox object schemas into one.
 * The next schema's properties will override the previous schema's properties.
 * @param prev - The optional previous object schema.
 * @param next - The next object schema to merge with the previous one.
 * @returns A new object schema that combines properties from both schemas.
 */
export const merge = <
	Prev extends ObjectSchema | undefined,
	Next extends ObjectSchema,
>(
	prev: Prev,
	next: Next,
): MergedObject<Next, Prev> =>
	Type.Object(
		{
			...next.properties,
			...(prev ? prev.properties : {}),
		},
		{ additionalProperties: false },
	) as any

/**
 * Base context available in all procedures.
 */
export type Context = {
	/** The received HTTP request */
	request: Request;
	cookie: Record<string, Cookie<unknown>>;
}

/**
 * Structural stand-in for `TObject` in generic constraints and conditional types.
 *
 * Checking a schema against `TObject` itself makes TypeScript compare the two structurally, which evaluates the
 * schema's `static` type (TypeBox's `ObjectStatic`) on every check. Checking against this alias only compares `type`
 * and `properties`, around forty times cheaper, and still rejects non-object schemas. Any `TObject<...>` satisfies it.
 */
export type ObjectSchema = TSchema & { type: 'object'; properties: TProperties }

/**
 * API documentation details for an action or procedure.
 */
export type Decorations<Errors extends ErrorTable = ErrorTable> =
  DocumentDecoration & Config<Errors>

/**
 * Tracing and error configuration for an action or procedure.
 */
export type Config<Errors extends ErrorTable = ErrorTable> = {
	tracing?: {
		name?: string;
		attributes?: Attributes;
	};
	errors?: ErrorConfig<Errors>;
}

/**
 * Resolves to Next when its properties do not overlap with those of the optional Prev schema, and to never otherwise.
 */
export type SafeTObject<
	Next extends ObjectSchema,
	Prev extends ObjectSchema | undefined = undefined,
> = Prev extends ObjectSchema
	? Extract<keyof Prev['properties'], keyof Next['properties']> extends never
		? Next
		: never
	: Next

/**
 * Merges two object schemas into one.
 * Without a previous schema the next schema is returned as is, so no new type is created.
 * `SafeTObject` already rejects overlapping properties, so a plain intersection of the properties is exact.
 */
export type MergedObject<
	Next extends ObjectSchema,
	Prev extends ObjectSchema | undefined = undefined,
> = Next extends ObjectSchema
	? Prev extends ObjectSchema
		? TObject<Simplify<Next['properties'] & Prev['properties']>>
		: Next
	: never

/**
 * A utility type that merges the context of a procedure with an optional next context.
 * The next context can be an object or void.
 */
export type MergedContext<
	Ctx extends Context,
	Next extends object | void = void,
> = [Next] extends [object] ? Simplify<Context & Omit<Ctx, keyof Next> & Next> : Ctx
