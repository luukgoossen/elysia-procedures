// generates a consumer-like file with N actions, see README.md
const N = Number(process.argv[2] ?? 250)
const F = new Set((process.env.FLAGS ?? '').split(',').filter(Boolean))
const has = (f: string) => !F.has('no-' + f)
const lines: string[] = []
lines.push(`import { Elysia } from 'elysia'`)
lines.push(`import { Type } from '@sinclair/typebox'`)
lines.push(`import { createProcedure, defineError, problems } from '../src/index'`)
lines.push(`
const base = createProcedure('Base', undefined, {
  errors: {
    type: r => 'https://x/' + r,
    table: {
      FORBIDDEN: { status: 403, title: 'Forbidden' },
      CONFLICT: defineError({ status: 409, metadata: Type.Object({ id: Type.String() }), title: m => m.id }),
      UPSTREAM: { status: 502 },
    },
  },
}).build(({ ctx }) => ({ requestTime: new Date() }))

const auth = createProcedure('Auth', base).build(async ({ ctx }, onError) => {
  if (!ctx.request.headers.get('authorization')) throw onError('FORBIDDEN')
  return { user: { id: '1', name: 'x', role: 'admin' as const } }
})

const entity = createProcedure('Entity', auth)
  .params(Type.Object({ entityId: Type.String() }))
  .query(Type.Object({ include: Type.Optional(Type.String()), page: Type.Optional(Type.Number()) }))
  .cache(({ params }) => [params.entityId])
  .build(({ params }) => ({ entity: { id: params.entityId, owner: 'me' } }))
`)
for (let i = 0; i < N; i++) {
  const proc = i % 3 === 0 ? 'base' : i % 3 === 1 ? 'auth' : 'entity'
  const details = !has('details') ? '' : has('errors')
    ? `, { tags: ['t${i % 10}'], errors: { table: { E${i}: { status: ${400 + (i % 50)}, title: 'e${i}' } } } }`
    : `, { tags: ['t${i % 10}'] }`
  lines.push(`
export const action${i} = ${proc}
  .createAction('Action ${i}'${details})
  ${has('params') ? `.params(Type.Object({ p${i}: Type.String() }))` : ''}
  ${has('query') ? `.query(Type.Object({ q${i}: Type.Optional(Type.Number()) }))` : ''}
  ${has('body') ? `.body(Type.Object({ name: Type.String(), nested: Type.Object({ a: Type.Number(), b: Type.Array(Type.String()) }), flag: Type.Optional(Type.Boolean()) }))` : ''}
  ${has('output') ? `.output(Type.Object({ id: Type.String(), name: Type.String(), count: Type.Number(), items: Type.Array(Type.Object({ k: Type.String(), v: Type.Number() })) }))` : ''}
  .build(({ ctx, params, query, body }, onError) => {
    ${has('onerror') ? `if (Math.random() < 0) throw onError('${has('errors') && has('details') ? 'E' + i : 'FORBIDDEN'}')
    if (Math.random() < 0) throw onError('NOT_FOUND')` : ''}
    return { id: String(params), name: String(body), count: Number(query) || 0, items: [{ k: 'a', v: 1 }] }
  })`)
}
const route = (i: number) => `  .post('/a${i}/:p${i}${i % 3 === 2 ? '/:entityId' : ''}', action${i}.handle, action${i}.docs)`
const SPLIT = Number(process.env.SPLIT ?? 0)
if (has('app') && !SPLIT) {
  lines.push(`\nexport const app = new Elysia().use(problems())`)
  for (let i = 0; i < N; i++) lines.push(route(i))
  lines.push(`  .listen(3000)\n`)
}
if (has('app') && SPLIT) {
  const groups = Math.ceil(N / SPLIT)
  for (let g = 0; g < groups; g++) {
    lines.push(`\nconst group${g} = new Elysia({ prefix: '/g${g}' }).use(problems())`)
    for (let i = g * SPLIT; i < Math.min(N, (g + 1) * SPLIT); i++) lines.push(route(i))
  }
  lines.push(`\nexport const app = new Elysia().use(problems())`)
  for (let g = 0; g < groups; g++) lines.push(`  .use(group${g})`)
  lines.push(`  .listen(3000)\n`)
}
await Bun.write(new URL('./consumer.ts', import.meta.url).pathname, lines.join('\n'))
