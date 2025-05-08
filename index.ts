// import dependencies
import { Type } from '@sinclair/typebox'
import { createProcedure } from './src/procedure'
import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'

// example usage
const baseProcedure = createProcedure('Base Route Handler')
	.params(Type.Object({
		name: Type.String({ description: "some name" })
	}))
	.build(({ params }) => {
		return {
			user: params.name
		}
	})

const authProcedure = createProcedure('User Authentication', baseProcedure)
	.params(Type.Object({
		token: Type.String({ description: "some token" })
	}))
	.build(({ ctx, params, body }) => {
		console.log('token: ', params.token)
		console.log('params: ', params.name)
		console.log('user: ', ctx.user)

		return {
			user: 12
		}
	})

const baseAction = baseProcedure.createAction("Base", { description: "Base Action" })
	.body(Type.Object({
		id: Type.Number({ description: "some id" }),
		key: Type.String({ description: "some key" })
	}))
	.output(Type.Object({
		id: Type.Number({ description: "some id" }),
		key: Type.String({ description: "some key" }),
		user: Type.String({ description: "some user" }),
	}))
	.build(({ ctx, body }) => {
		return {
			id: body.id,
			key: body.key,
			user: ctx.user,
			test: "test"
		}
	})

const testAction = authProcedure.createAction("Test")
	.output(Type.String({ description: "some output" }))
	.build(() => {
		return "Hello World"
	})


const app = new Elysia()
	.use(swagger())
	.post("/base/:name", baseAction.handle, { ...baseAction.docs, tags: ["Base"] })
	.get("/test/:name/:token", testAction.handle, { ...testAction.docs, tags: ["Test"] })

app.listen(3000, () => {
	console.log(`🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`);
});