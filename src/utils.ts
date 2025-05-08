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
	Next extends TObject,
>(prev: Prev, next: Next): TObject<Simplify<Merge<Prev extends TObject ? Prev['properties'] : unknown, Next['properties']>>> => Type.Object({
	...(prev ? prev.properties : {}),
	...next.properties,
}, { additionalProperties: false }) as any