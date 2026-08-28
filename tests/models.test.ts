// import dependencies
import { describe, test, expect, beforeEach } from 'bun:test'
import { Elysia, t } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { Type, CloneType } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { createProcedure } from '@/procedure'
import { procedures, procedureModels } from '@/plugin'
import { Problem, ValidationProblem } from '@/error'
import { registerSchema, registerSchemas, schemaModels, clearSchemas } from '@/models'

const request = (app: { handle: (request: Request) => Promise<Response> }, path: string, init?: RequestInit) => app.handle(new Request(`http://localhost${path}`, init))

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })

const deviceType = Type.Object({
	id: Type.String(),
	name: Type.String(),
}, { $id: 'DeviceType' })

const device = Type.Object({
	id: Type.String(),
	type: deviceType,
	spare: Type.Optional(deviceType),
	history: Type.Array(deviceType),
}, { $id: 'Device' })

const base = createProcedure('Base').build()

beforeEach(() => clearSchemas())

describe('registration', () => {
	test('a named schema is documented as its model name', () => {
		expect(registerSchema(device)).toBe('Device')
		expect(Object.keys(schemaModels()).sort()).toEqual(['Device', 'DeviceType'])
	})

	test('a model carries the pointer its references use as its own $id', () => {
		registerSchema(device)
		expect(schemaModels().Device!.$id).toBe('#/components/schemas/Device')
		expect(schemaModels().DeviceType!.$id).toBe('#/components/schemas/DeviceType')
	})

	test('named subschemas are replaced by references, at every depth', () => {
		registerSchema(device)
		const model = schemaModels().Device as any

		expect(model.properties.type).toMatchObject(ref('DeviceType'))
		expect(model.properties.spare).toMatchObject(ref('DeviceType'))
		expect(model.properties.history.items).toMatchObject(ref('DeviceType'))
		expect(model.required).toEqual(['id', 'type', 'history'])
		expect(schemaModels().DeviceType).toMatchObject({ type: 'object', properties: { name: { type: 'string' } } })
	})

	test('a schema without a root $id is documented inline, with its named subschemas referenced', () => {
		const list = Type.Object({ devices: Type.Array(device), total: Type.Integer() })
		const documented = registerSchema(list) as any

		expect(typeof documented).toBe('object')
		expect(documented.properties.devices.items).toMatchObject(ref('Device'))
		expect(documented.properties.total).toBe(list.properties.total)
		expect(Object.keys(schemaModels()).sort()).toEqual(['Device', 'DeviceType'])
	})

	test('a schema with nothing named is returned untouched', () => {
		const plain = Type.Object({ id: Type.String(), nested: Type.Object({ n: Type.Number() }) })

		expect(registerSchema(plain)).toBe(plain)
		expect(schemaModels()).toEqual({})
	})

	test('the walk keeps TypeBox usable: kinds, modifiers and static types survive', () => {
		registerSchema(device)
		const model = schemaModels().Device as any

		const references = [schemaModels().DeviceType!]
		expect(Value.Check(model, references, { id: 'd', type: { id: 't', name: 'n' }, history: [] })).toBe(true)
		expect(Value.Check(model, references, { id: 'd', type: { id: 't' }, history: [] })).toBe(false)
		expect(Value.Check(model, references, { id: 'd', history: [] })).toBe(false)
	})

	test('union members stay inline, while what they hold is still referenced', () => {
		const union = Type.Object({
			one: Type.Union([deviceType, Type.Null()]),
			two: Type.Union([Type.Object({ device }), Type.Null()]),
		}, { $id: 'Union' })
		registerSchema(union)
		const model = schemaModels().Union as any

		expect(model.properties.one.anyOf[0]).toMatchObject({ type: 'object', properties: { name: { type: 'string' } } })
		expect(model.properties.two.anyOf[0].properties.device).toMatchObject(ref('Device'))
	})

	test('a schema that refers back to itself terminates', () => {
		const tree: any = Type.Object({ id: Type.String() }, { $id: 'Tree' })
		tree.properties.children = Type.Array(tree)

		expect(registerSchema(tree)).toBe('Tree')
		expect((schemaModels().Tree as any).properties.children.items).toMatchObject(ref('Tree'))
	})

	test('registerSchemas registers without documenting', () => {
		registerSchemas([device])
		expect(Object.keys(schemaModels()).sort()).toEqual(['Device', 'DeviceType'])
	})
})

describe('collisions', () => {
	test('the same schema under the same name is the normal case', () => {
		expect(() => registerSchema(device)).not.toThrow()
		expect(() => registerSchema(device)).not.toThrow()
		expect(() => registerSchema(Type.Object({ one: deviceType, two: Type.Optional(deviceType) }))).not.toThrow()
	})

	test('two different schemas under one name is a boot error', () => {
		registerSchema(device)
		expect(() => registerSchema(CloneType(device, { description: 'A device' })))
			.toThrow(/Two different schemas carry the \$id "Device"/)
	})

	test('the problem model names are taken', () => {
		expect(() => registerSchema(Type.Object({ status: Type.Integer() }, { $id: 'Problem' })))
			.toThrow(/taken by the problem model/)
	})

	test('the problem models themselves are documented as their names, and left to the plugin', () => {
		expect(registerSchema(Problem)).toBe('Problem')
		expect(registerSchema(ValidationProblem)).toBe('ValidationProblem')
		expect(schemaModels()).toEqual({})
	})
})

describe('action documentation', () => {
	test('a named output is documented as its model name and validated against the schema itself', () => {
		const action = base.createAction('Get Device').output(device).build(() => ({ id: 'd', type: { id: 't', name: 'n' }, history: [] }))

		expect(action.docs.response[200]).toBe('Device' as any)
		expect(action.output).toBe(device)
	})

	test('an unnamed output is documented as a copy carrying references', () => {
		const output = Type.Object({ devices: Type.Array(device) })
		const action = base.createAction('List Devices').output(output).build(() => ({ devices: [] }))

		expect((action.docs.response[200] as any).properties.devices.items).toMatchObject(ref('Device'))
	})

	test('params and query are never referenced', () => {
		const params = Type.Object({ id: Type.String() }, { $id: 'DeviceParams' })
		const query = Type.Object({ type: deviceType })
		const action = base.createAction('Get Device').params(params).query(query).output(device).build(() => ({ id: 'd', type: { id: 't', name: 'n' }, history: [] }))

		expect(action.docs.params.type).toBe('object')
		expect(action.docs.query!.type).toBe('object')
		expect((action.docs.query as any).properties.type).toBe(deviceType)
		expect(schemaModels().DeviceParams).toBeUndefined()
	})

	test('building the action registers the output, before any route is defined', () => {
		base.createAction('Get Device').output(device).build(() => ({ id: 'd', type: { id: 't', name: 'n' }, history: [] }))
		expect(Object.keys(schemaModels()).sort()).toEqual(['Device', 'DeviceType'])
	})
})

describe('openapi integration', () => {
	const build = () => {
		const get = base.createAction('Get Device').params(t.Object({ id: t.String() })).output(device)
			.build(({ params }) => ({ id: params.id, type: { id: 't', name: 'n' }, history: [{ id: 't', name: 'n' }] }))

		const list = base.createAction('List Devices').output(Type.Object({ devices: Type.Array(device) }))
			.build(() => ({ devices: [] }))

		const broken = base.createAction('Broken Device').output(device)
			.build(() => ({ id: 'd', type: { id: 't' }, history: [] }) as any)

		return new Elysia()
			.use(procedures({ observability: { logging: () => {} } }))
			.use(openapi())
			.get('/devices/:id', get.handle, get.docs)
			.get('/devices', list.handle, list.docs)
			.get('/broken', broken.handle, broken.docs)
	}

	test('named schemas become components and use sites become references', async () => {
		const spec: any = await (await request(build(), '/openapi/json')).json()

		expect(Object.keys(spec.components.schemas).sort()).toEqual(['Device', 'DeviceType', 'Problem', 'ValidationProblem'])
		expect(spec.components.schemas.Device.properties.type).toEqual(ref('DeviceType'))
		expect(spec.components.schemas.DeviceType.properties.name).toEqual({ type: 'string' })

		expect(spec.paths['/devices/{id}'].get.responses['200'].content['application/json'].schema).toEqual(ref('Device'))
		expect(spec.paths['/devices'].get.responses['200'].content['application/json'].schema.properties.devices.items).toEqual(ref('Device'))
		expect(spec.paths['/devices/{id}'].get.responses['404'].content['application/json'].schema).toEqual(ref('Problem'))
		expect(spec.paths['/devices/{id}'].get.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }])
	})

	test('response validation follows the references', async () => {
		const app = build()

		const ok = await request(app, '/devices/abc')
		expect(ok.status).toBe(200)
		expect(await ok.json()).toMatchObject({ id: 'abc', type: { name: 'n' } })

		// the nested DeviceType is missing a required property, which is a server bug, not a client error
		const bad = await request(app, '/broken')
		expect(bad.status).toBe(500)
		expect(await bad.json()).toMatchObject({ reason: 'INTERNAL' })
	})

	test('procedureModels registers the same models', async () => {
		const action = base.createAction('Get Device').output(device).build(() => ({ id: 'd', type: { id: 't', name: 'n' }, history: [] }))
		const app = new Elysia().use(procedureModels()).use(openapi()).get('/devices', action.handle, action.docs)
		const spec: any = await (await request(app, '/openapi/json')).json()

		expect(spec.components.schemas.Device).toBeDefined()
		expect(spec.paths['/devices'].get.responses['200'].content['application/json'].schema).toEqual(ref('Device'))
	})

	test('schemas passed to the plugin are registered too', async () => {
		const app = new Elysia().use(procedures({ schemas: [device] })).use(openapi())
		const spec: any = await (await request(app, '/openapi/json')).json()

		expect(Object.keys(spec.components.schemas).sort()).toEqual(['Device', 'DeviceType', 'Problem', 'ValidationProblem'])
	})

	test('an action without named schemas documents exactly what it did before', async () => {
		const action = base.createAction('Get Video').output(Type.Object({ id: Type.String() })).build(() => ({ id: 'v' }))
		const app = new Elysia().use(procedures({ observability: { logging: () => {} } })).use(openapi()).get('/videos', action.handle, action.docs)
		const spec: any = await (await request(app, '/openapi/json')).json()

		expect(Object.keys(spec.components.schemas).sort()).toEqual(['Problem', 'ValidationProblem'])
		expect(spec.paths['/videos'].get.responses['200'].content['application/json'].schema).toEqual({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] })
	})
})
