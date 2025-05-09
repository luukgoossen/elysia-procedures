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
	.build()

const authProcedure = createProcedure('User Authentication', baseProcedure)
	.params(Type.Object({
		token: Type.String({ description: "some name" })
	}))
	.build(({ ctx, params }) => ({
		user: {
			name: params.name,
			token: params.token,
		}
	}))

const userSchema = Type.Object({
	name: Type.String({ description: "some name" }),
})

const getUserAction = authProcedure.createAction('Get User')
	.output(userSchema)
	.build(({ ctx, params }) => ctx.user)

const app = new Elysia()
	.use(swagger({ documentation: { info: { title: "Elysia API", version: "1.0.0" } } }))
	.get("/user/:name", getUserAction.handle, { ...getUserAction.docs, tags: ["User"] })

app.listen(3000, () => {
	console.log(`🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}`);
});