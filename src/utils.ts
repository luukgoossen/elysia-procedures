// import dependencies
import { Type } from '@sinclair/typebox'

// import types
import type { TObject } from '@sinclair/typebox'
import type { Merge, Simplify } from 'type-fest'

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
>(prev: Prev, next: Next): Next extends TObject
	? TObject<Simplify<Merge<Prev extends TObject ? Prev['properties'] : unknown, Next['properties']>>>
	: Prev =>
	Type.Object({
		...next.properties,
		...(prev ? prev.properties : {}),
	}, { additionalProperties: false }) as any

/**
 * A utlity type that ensures a TObject (Next) does not have any overlapping properties with an opional reference TObject (Prev).
 */
export type SafeTObject<Next extends TObject, Prev extends TObject | undefined = undefined> = Prev extends TObject
	? (Extract<keyof Prev['properties'], keyof Next['properties']> extends never
		? Next
		: never)
	: Next