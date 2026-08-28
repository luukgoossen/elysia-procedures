// import dependencies
import { Kind, OptionalKind, ReadonlyKind, Type } from '@sinclair/typebox'
import { Problem, ValidationProblem } from './error'

// import types
import type { TSchema } from '@sinclair/typebox'

/** JSON pointer prefix of an OpenAPI component schema */
const PREFIX = '#/components/schemas/'

/** The models this package registers itself, which the plugin adds to Elysia on its own */
const RESERVED: Record<string, TSchema> = { Problem, ValidationProblem }

/**
 * Keyword whose members are kept inline instead of referenced.
 *
 * A `$ref` written as a JSON pointer resolves for TypeBox's compiler, which dereferences against the `$id` of every
 * registered model, but not for Elysia's response normalizer, which resolves against the model names. Everywhere but
 * inside a union that only costs the normalizer its knowledge of the referenced shape; inside one it makes Elysia
 * drop the normalizer for the whole route and say so on the console. Union members are worth neither.
 */
const INLINE = 'anyOf'

/** A registered model: the schema it was built from and the form registered with Elysia */
type Model = {
	/** The schema as its author wrote it, used to recognize a name registered twice */
	source: TSchema
	/** The same schema with every named subschema replaced by a reference */
	model: TSchema
}

/** Registered models by name */
const models = new Map<string, Model>()

/** The documentation form per schema, so the tree is walked once per schema */
let documented = new WeakMap<TSchema, string | TSchema>()

const isSchema = (value: unknown): value is TSchema => typeof value === 'object' && value !== null && Kind in value

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The model name of a schema: its root `$id`, with the component pointer prefix stripped when it carries one */
const nameOf = (schema: TSchema): string | undefined => {
	const id = schema.$id
	if (typeof id !== 'string' || !id) return undefined
	return id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id
}

/** Copies the modifiers TypeBox keeps in symbols, so a reference stays optional or readonly where the schema was */
const withModifiers = (ref: TSchema, source: TSchema): TSchema => {
	const modifiers = source as unknown as Record<symbol, unknown>
	for (const modifier of [OptionalKind, ReadonlyKind])
		if (modifier in source) Object.assign(ref, { [modifier]: modifiers[modifier] })

	return ref
}

/** Maps every schema held by a value: the value itself, the schemas in an array, or the schemas of a record */
const mapValue = (value: unknown, map: (schema: TSchema) => TSchema): unknown => {
	if (isSchema(value)) return map(value)

	if (Array.isArray(value)) {
		let changed = false
		const next = value.map(item => {
			if (!isSchema(item)) return item
			const mapped = map(item)
			if (mapped !== item) changed = true
			return mapped
		})
		return changed ? next : value
	}

	if (isRecord(value)) {
		let changed = false
		const next: Record<string, unknown> = {}
		for (const [key, item] of Object.entries(value)) {
			const mapped = isSchema(item) ? map(item) : item
			if (mapped !== item) changed = true
			next[key] = mapped
		}
		return changed ? next : value
	}

	return value
}

/**
 * Replaces every named schema below `schema` with a reference, keeping `schema` itself inline. Returns the schema
 * unchanged when nothing below it is named, so a schema that opts out of the feature keeps its identity.
 */
const inline = (schema: TSchema): TSchema => {
	let changed = false
	const next: Record<string, unknown> = {}

	for (const [key, value] of Object.entries(schema)) {
		const mapped = mapValue(value, key === INLINE ? inline : reference)
		if (mapped === value) continue
		changed = true
		next[key] = mapped
	}

	return changed ? Object.assign({}, schema, next) : schema
}

/** Registers `schema` and replaces it with a reference when it is named, and replaces its named subschemas otherwise */
const reference = (schema: TSchema): TSchema => {
	const name = nameOf(schema)
	if (!name) return inline(schema)

	register(name, schema)
	return withModifiers(Type.Ref(PREFIX + name), schema)
}

/** Registers a schema under a name, or throws when the name is taken by another schema */
const register = (name: string, schema: TSchema) => {
	// the plugin registers the problem models itself, so documenting one is a reference and nothing more
	const reserved = RESERVED[name]
	if (reserved) {
		if (reserved === schema) return
		throw new Error(`The $id "${name}" is taken by the problem model this package registers. Give the schema another $id.`)
	}

	const existing = models.get(name)
	if (existing) {
		// the same schema under the same name is the normal case: one schema reused by many actions
		if (existing.source === schema || JSON.stringify(existing.source) === JSON.stringify(schema)) return
		throw new Error(`Two different schemas carry the $id "${name}". Reference the one schema everywhere rather than cloning it, and give schemas that genuinely differ their own $id.`)
	}

	// claim the name before walking the tree, so a schema that refers back to itself terminates
	models.set(name, { source: schema, model: schema })

	// the model's own $id is the pointer its references use: that is what TypeBox dereferences them against
	models.set(name, { source: schema, model: Object.assign({}, inline(schema), { $id: PREFIX + name }) })
}

/**
 * Registers every named schema in a tree as an OpenAPI model and returns the form to document.
 *
 * A schema with a root `$id` becomes a model of that name and is documented as the name, which Elysia resolves to the
 * model and `@elysiajs/openapi` emits as a `$ref`. A schema without one is documented as a copy of itself with its
 * named subschemas referenced, and a schema with nothing named anywhere is returned untouched.
 * @param schema - The schema to register
 */
export const registerSchema = <T extends TSchema>(schema: T): string | TSchema => {
	const cached = documented.get(schema)
	if (cached !== undefined) return cached

	const name = nameOf(schema)
	if (name) register(name, schema)

	const result = name ?? inline(schema)
	documented.set(schema, result)
	return result
}

/**
 * Registers schemas without documenting them. Actions register their own output when it is built, which is early
 * enough as long as the modules that define them are loaded before the plugin is mounted. Pass the schemas here when
 * they are not, for instance when actions are built behind a dynamic import.
 * @param schemas - The schemas to register
 */
export const registerSchemas = (schemas: TSchema[]) => {
	for (const schema of schemas) registerSchema(schema)
}

/**
 * The registered models by name, in the form the `procedureModels()` plugin hands to Elysia's `.model()`.
 */
export const schemaModels = (): Record<string, TSchema> =>
	Object.fromEntries([...models].map(([name, { model }]) => [name, model]))

/**
 * Forgets every registered model. The registry is global and lives as long as the process, so this is only useful to
 * isolate tests that register schemas of their own.
 */
export const clearSchemas = () => {
	models.clear()
	documented = new WeakMap()
}
