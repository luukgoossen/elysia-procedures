// import types
import type { TSchema, Intersect, TObject } from '@sinclair/typebox'

export type MergeSchema<Prev extends TSchema | undefined, Next extends TObject> =
	Prev extends TSchema
	? Intersect<[Prev, Next]>
	: Next

export type MergeObject<A, B> = Omit<A, keyof B> & B