import { defineConfig } from '@playwright/test'
import type { CheckmateOptions } from '@xoxoai/checkmate/playwright'
import { config as envConfig } from 'dotenv'

envConfig({ quiet: true })

export default defineConfig<CheckmateOptions>({
	projects: [
		{
			name: 'salesforce',
			testDir: './test/examples/salesforce',
		},
		{
			name: 'web',
			testDir: './test/examples/web',
		},
	],
	outputDir: process.env.CI ? undefined : './test-reports/results',
	reporter: [
		['junit', { outputFile: './test-reports/junit/results.xml' }],
		['html', { outputFolder: './test-reports/html' }],
		['list'],
	],
	timeout: 10 * 60000,
	repeatEach: 1,
	retries: 1,
	workers: 1,
	expect: {
		timeout: 1 * 10000,
	},
	use: {
		checkmateModel: 'openai/gpt-oss-20b',
		checkmateOpenaiBaseUrl: 'https://api.groq.com/openai/v1',
		checkmateLogLevel: 'debug',
		checkmateTurnCap: 20,
		checkmateStepTimeout: 120_000,
		checkmateBudgetUsd: 0.1,
		checkmateBudgetTokens: 300000,
		checkmateSnapshotFilter: false,
		viewport: { width: 1360, height: 768 },
		browserName: 'chromium',
		actionTimeout: 1 * 5000,
		navigationTimeout: 1 * 30000,
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
		video: 'on',
	},
})
