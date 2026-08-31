/**
 * The context-pruning benchmark.
 *
 * The PRD's claim is specific — a ~2-3x cost advantage *from context pruning* — so this script
 * varies only that. Both arms share the model, the flows, and the loop; only the tool surface
 * and the context policy differ:
 *
 *   checkmate     — the 12 browser tools, pruned snapshot, ephemeral messages replaced each turn
 *   mcp-baseline  — a vendored MCP-shaped tool surface (scripts/baseline/mcp-baseline.ts),
 *                   full accumulated context
 *
 * This is only possible because `@xoxoai/checkmate/core` does not require a Playwright worker:
 * `createRunner()` is called directly and `StepReport` already carries cost, turns, and
 * duration, so this script measures nothing itself.
 *
 * Usage:
 *
 *   npx tsx scripts/benchmark.ts --dry-run   # composes both arms, prints the flow matrix, and
 *                                             # exits without issuing a single provider request
 *   npx tsx scripts/benchmark.ts             # runs every flow through both arms and every
 *                                             # configured model tier — spends real money
 *
 * This runs as a manual workflow on release, never in PR CI, because every non-dry-run
 * invocation spends real money against a live provider.
 *
 * The `checkmate` arm's browser tools dispatch every call through `BrowserToolRuntime`, which
 * wraps each dispatched call in its own `test.step()` when a Playwright Test worker is running
 * (`src/tools/browser/tool.ts`, added in Phase 4 so the HTML report reads as one `ai:` row per
 * step) and skips that wrapper outside one — which is exactly the state this script runs in, a
 * plain `npx tsx` process with no `npx playwright test` worker behind it.
 */
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CheckmateExtension, ResolvedConfig, StepReport, createRunner, resolveConfig } from '../src/core.js'
import { web } from '../src/playwright.js'
import { mcpBaseline } from './baseline/mcp-baseline.js'

type Flow = {
	name: string
	step: { name: string; action: string; expect: string }
}

type ModelTier = {
	name: string
	checkmateModel: string
	checkmateOpenaiBaseUrl?: string
}

type ArmName = 'checkmate' | 'mcp-baseline'

const FLOWS: Flow[] = [
	{
		name: 'ollama-model-search',
		step: {
			name: 'search for qwen3-vl on ollama',
			action: `
				Navigate to https://ollama.com
				Type 'qwen3-vl' into the 'Search models' search bar
				Click on 'qwen3-vl' link from the results,
				Click on 'qwen3-vl:235b' link from the models list,`,
			expect: `
				qwen3-vl:235b model page is displayed with model details,
				describing its features and capabilities,
				single browser tab is opened.`,
		},
	},
	{
		name: 'huggingface-model-search',
		step: {
			name: 'search for Qwen3-VL-4B on huggingface',
			action: `
				Navigate to the https://huggingface.co website.
				Type 'Qwen3-VL-4B' in the search bar.
				Click on the 'Qwen/Qwen3-VL-4B-Instruct' link from the search results.`,
			expect: `
				Qwen3-VL-4B-Instruct model page is displayed with model details`,
		},
	},
]

const MODEL_TIERS: ModelTier[] = [
	{ name: 'gpt-5-mini', checkmateModel: 'gpt-5-mini' },
	{
		name: 'gpt-oss-20b (groq)',
		checkmateModel: 'openai/gpt-oss-20b',
		checkmateOpenaiBaseUrl: 'https://api.groq.com/openai/v1',
	},
]

const ARM_TOOL_COUNT: Record<ArmName, number> = {
	// Kept in sync by hand with `createBrowserTools()` (src/tools/browser/tool.ts) and
	// `createMcpBaselineTools()` (scripts/baseline/mcp-baseline.ts).
	checkmate: 12,
	'mcp-baseline': 18,
}

const ARM_CONTEXT_POLICY: Record<ArmName, string> = {
	checkmate: 'pruned snapshot, ephemeral messages replaced each turn',
	'mcp-baseline': 'full accumulated context',
}

const ARM_EXTENSIONS: Record<ArmName, (page: Parameters<typeof web>[0]['page']) => CheckmateExtension> = {
	checkmate: (page) => web({ page }),
	'mcp-baseline': (page) => mcpBaseline({ page }),
}

type BenchmarkResult = {
	flow: string
	model: string
	arm: ArmName
	outcome: StepReport['outcome']
	category: StepReport['category']
	reason: StepReport['reason']
	turns: number
	durationMs: number
	costUsd: number
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes('--dry-run')

	const browser = await chromium.launch()
	try {
		if (dryRun) {
			await printDryRun(browser)
			return
		}

		const results = await runBenchmark(browser)
		writeResults(results)
	} finally {
		await browser.close()
	}
}

async function printDryRun(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<void> {
	const context = await browser.newContext()
	const page = await context.newPage()

	try {
		for (const arm of Object.keys(ARM_EXTENSIONS) as ArmName[]) {
			// Composing the runner registers every tool and applies the extension, exercising the
			// same wiring a real run uses, without ever calling `runner.run()` — so nothing here
			// issues a provider request.
			const runner = createRunner({ config: resolveConfig(), extensions: [ARM_EXTENSIONS[arm](page)] })
			await runner.teardown()
		}

		console.log('Benchmark flow matrix (--dry-run, no requests issued):\n')
		console.log('flow                        model                 arm            tools  context policy')
		console.log('-'.repeat(110))
		for (const flow of FLOWS) {
			for (const model of MODEL_TIERS) {
				for (const arm of Object.keys(ARM_EXTENSIONS) as ArmName[]) {
					console.log(
						[
							flow.name.padEnd(28),
							model.name.padEnd(22),
							arm.padEnd(15),
							String(ARM_TOOL_COUNT[arm]).padEnd(7),
							ARM_CONTEXT_POLICY[arm],
						].join(' ')
					)
				}
			}
		}
	} finally {
		await context.close()
	}
}

async function runBenchmark(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<BenchmarkResult[]> {
	const results: BenchmarkResult[] = []

	for (const flow of FLOWS) {
		for (const model of MODEL_TIERS) {
			for (const arm of Object.keys(ARM_EXTENSIONS) as ArmName[]) {
				const config: ResolvedConfig = resolveConfig({
					checkmateModel: model.checkmateModel,
					checkmateOpenaiBaseUrl: model.checkmateOpenaiBaseUrl,
				})

				const context = await browser.newContext()
				const page = await context.newPage()
				const runner = createRunner({ config, extensions: [ARM_EXTENSIONS[arm](page)] })

				try {
					const report = await runner.run(flow.step)
					results.push({
						flow: flow.name,
						model: model.name,
						arm,
						outcome: report.outcome,
						category: report.category,
						reason: report.reason,
						turns: report.turns,
						durationMs: report.durationMs,
						costUsd: report.usage.costUsd,
					})
					console.log(
						`${flow.name} / ${model.name} / ${arm}: ${report.outcome} in ${report.turns} turns, ` +
							`${(report.durationMs / 1000).toFixed(1)}s, $${report.usage.costUsd.toFixed(4)}`
					)
				} finally {
					await runner.teardown()
					await context.close()
				}
			}
		}
	}

	return results
}

function writeResults(results: BenchmarkResult[]): void {
	const outDir = fileURLToPath(new URL('.', import.meta.url))
	writeFileSync(join(outDir, 'benchmark-results.json'), JSON.stringify(results, null, 2))

	const table = buildMarkdownTable(results)
	writeFileSync(join(outDir, 'benchmark-results.md'), table)
	console.log('\nWrote scripts/benchmark-results.json and scripts/benchmark-results.md')
}

function buildMarkdownTable(results: BenchmarkResult[]): string {
	const header = '| Flow | Model | checkmate cost | mcp-baseline cost | Ratio |\n| --- | --- | --- | --- | --- |'
	const rows: string[] = []

	for (const flow of FLOWS) {
		for (const model of MODEL_TIERS) {
			const checkmateResult = results.find(
				(result) => result.flow === flow.name && result.model === model.name && result.arm === 'checkmate'
			)
			const baselineResult = results.find(
				(result) => result.flow === flow.name && result.model === model.name && result.arm === 'mcp-baseline'
			)
			if (!checkmateResult || !baselineResult) {
				continue
			}

			const ratio =
				checkmateResult.costUsd > 0 ? (baselineResult.costUsd / checkmateResult.costUsd).toFixed(2) : 'n/a'
			rows.push(
				`| ${flow.name} | ${model.name} | $${checkmateResult.costUsd.toFixed(4)} | $${baselineResult.costUsd.toFixed(4)} | ${ratio}x |`
			)
		}
	}

	return [header, ...rows].join('\n') + '\n'
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
