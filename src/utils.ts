// import dependencies
import { Type } from '@sinclair/typebox'

// import types
import type { TSchema, Intersect, TObject, TProperties } from '@sinclair/typebox'
import type { Merge, Simplify } from 'type-fest'

export type MergeSchema<Prev extends TSchema | undefined, Next extends TObject> =
	Prev extends TSchema
	? Intersect<[Prev, Next]>
	: Next

export type MergeObject<Prev extends TProperties, Next extends TProperties> = TObject<Simplify<Merge<Prev, Next>>>

export const merge = <
	Prev extends TObject | undefined,
	Next extends TObject,
>(prev: Prev, next: Next): TObject<Simplify<Merge<Prev extends TObject ? Prev['properties'] : unknown, Next['properties']>>> => Type.Object({
	...(prev ? prev.properties : {}),
	...next.properties,
}, { additionalProperties: false }) as any

const typeOne = Type.Object({
	name: Type.String(),
	age: Type.Number()
})

const typeTwo = Type.Object({
	email: Type.String(),
	verified: Type.Boolean()
})

const merged = merge(typeOne, typeTwo)