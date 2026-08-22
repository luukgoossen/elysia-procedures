import type { BuildConfig } from 'bun'
import dts from 'bun-plugin-dts'

const defaultBuildConfig: BuildConfig = {
	entrypoints: ['./src/index.ts', './src/action.ts', './src/procedure.ts'],
	outdir: './dist',
	target: 'node',
	splitting: true,
	packages: 'external',
	env: 'disable',
	minify: true,
}

await Promise.all([
	Bun.build({
		...defaultBuildConfig,
		plugins: [dts()],
		format: 'esm',
		naming: '[dir]/[name].js',
	}),
	Bun.build({
		...defaultBuildConfig,
		format: 'cjs',
		naming: '[dir]/[name].cjs',
	})
])