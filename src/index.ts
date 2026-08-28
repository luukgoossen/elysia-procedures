// we need this for type format support
import {} from 'elysia'

export { createProcedure } from './procedure'

export type { Middleware, Procedure } from './procedure'

export type { Action } from './action'

export {
	ApiError,
	Problem,
	ValidationProblem,
	ProblemFieldError,
	defineError,
	createErrorFactory,
} from './error'

export type { ErrorTable, ErrorFactory } from './error'

export { resolveProblem, problemResponse } from './problems'

export type { ResolveProblemOptions } from './problems'

export {
	registerSchema,
	registerSchemas,
	schemaModels,
	clearSchemas,
} from './models'

export { procedures, procedureModels, sentryReporter } from './plugin'

export type {
	ProceduresOptions,
	ProcedureModelsOptions,
	ProblemReporter,
	ProblemLogger,
	SentryReporterOptions,
	SentryLike,
} from './plugin'

export { configureTracing } from './trace'

export type { TracingOptions, SpanType } from './trace'

export type { Context, Config, Decorations, ObjectSchema } from './utils'
