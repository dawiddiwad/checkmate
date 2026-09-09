import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { CheckmateManifestV1, RunRequestV1 } from '../../contracts/types.js'

export type CliTestEnvironment = Readonly<{
	root: string
	server: Server
	baseUrl: string
	request: (mode: 'pass' | 'app' | 'model' | 'infra' | 'hang' | 'noisy' | 'signal') => RunRequestV1
	close: () => Promise<void>
}>

export async function createCliTestEnvironment(): Promise<CliTestEnvironment> {
	const root = await mkdtemp(resolve(tmpdir(), 'checkmate-cli-run-'))
	const server = createServer((request, response) => {
		let body = ''
		request.setEncoding('utf8').on('data', (chunk) => (body += chunk))
		request.on('end', () => {
			let action: string
			try {
				const input = JSON.parse(body) as { messages?: Array<{ content?: unknown }> }
				action = JSON.stringify(input.messages ?? [])
			} catch {
				response.writeHead(400).end('{}')
				return
			}
			if (action.includes('infra')) {
				response.writeHead(401, { 'content-type': 'application/json' })
				response.end(JSON.stringify({ error: { message: 'fixture provider rejected the request' } }))
				return
			}
			const name = action.includes('app')
				? 'fail_test_step'
				: action.includes('model')
					? undefined
					: 'pass_test_step'
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end(JSON.stringify(completion(name, action.includes('noisy') ? 'driver-secret' : undefined)))
		})
	})
	await new Promise<void>((accept, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => accept())
	})
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('Fixture server has no TCP address')
	const baseUrl = `http://127.0.0.1:${address.port}/v1`

	await writeDriver(root)
	await writeManifest(root, baseUrl)
	return {
		root,
		server,
		baseUrl,
		request: (mode) => ({
			schemaVersion: 1,
			scenario: {
				id: `cli-${mode}`,
				driver: {
					id: 'fixture',
					target: { mode, ...(mode === 'signal' ? { marker: resolve(root, 'driver.ready') } : {}) },
				},
				policy: 'ci',
				...(mode === 'hang' ? { limits: { timeoutMs: 1000 } } : {}),
				steps: [{ id: 'step-one', action: `execute ${mode}`, expect: `${mode} outcome` }],
			},
		}),
		close: async () => {
			await new Promise<void>((accept) => server.close(() => accept()))
			await rm(root, { recursive: true, force: true })
		},
	}
}

async function writeManifest(root: string, baseUrl: string): Promise<void> {
	const manifest: CheckmateManifestV1 = {
		schemaVersion: 1,
		outputDirectory: '.checkmate/runs',
		defaultPolicy: 'ci',
		secretBindings: {
			'provider-key': { source: 'environment', name: 'CHECKMATE_CLI_PROVIDER_KEY' },
			'driver-key': { source: 'environment', name: 'CHECKMATE_CLI_DRIVER_KEY' },
		},
		policies: {
			ci: {
				modelEgress: {
					provider: { id: 'openai', model: 'fixture-model', baseUrl, apiKeyBinding: 'provider-key' },
					textRedaction: 'on',
					allowOpaque: false,
					maxStepBytes: 1_048_576,
					maxMessageBytes: 262_144,
				},
				bounds: {
					scenarioTimeoutMs: 5000,
					stepTimeoutMs: 2000,
					turnsPerStep: 1,
					requestTimeoutMs: 1000,
					maxRetries: 0,
					loopMaxRepetitions: 2,
					cleanupTimeoutMs: 1000,
					budgetTokens: 100,
				},
				evidence: { retention: 'retain-on-failure', redaction: 'on', allowOpaque: false },
				drivers: { fixture: { settings: {}, tools: { allowed: ['*'] } } },
			},
		},
		drivers: { fixture: { package: '@checkmate-test/cli-driver', secrets: { session: 'driver-key' } } },
	}
	await writeFile(resolve(root, 'checkmate.config.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

async function writeDriver(root: string): Promise<void> {
	const directory = resolve(root, 'node_modules/@checkmate-test/cli-driver')
	await mkdir(directory, { recursive: true })
	await writeFile(
		resolve(directory, 'package.json'),
		JSON.stringify({
			name: '@checkmate-test/cli-driver',
			version: '1.0.0',
			type: 'module',
			exports: { '.': './index.js', './checkmate-driver.json': './checkmate-driver.json' },
		})
	)
	await writeFile(
		resolve(directory, 'checkmate-driver.json'),
		JSON.stringify({
			schemaVersion: 1,
			id: 'fixture',
			driverContractVersion: 1,
			targetSchema: {
				type: 'object',
				additionalProperties: false,
				required: ['mode'],
				properties: {
					mode: { enum: ['pass', 'app', 'model', 'infra', 'hang', 'noisy', 'signal'] },
					marker: { type: 'string' },
				},
			},
			settingsSchema: { type: 'object', additionalProperties: false },
			requiredSecretSlots: ['session'],
			tools: [],
			evidenceKinds: [],
		})
	)
	await writeFile(
		resolve(directory, 'index.js'),
		`import { writeFileSync } from 'node:fs'
export const checkmateDriver = {
  id: 'fixture', driverContractVersion: 1,
  async start(input) {
    const secret = input.secrets.read('session')
    if (input.target.mode === 'hang') while (true) {}
    if (input.target.mode === 'signal') {
      writeFileSync(input.target.marker, 'ready')
    }
    if (input.target.mode === 'noisy') {
      console.log('raw stdout ' + secret)
      process.stderr.write('raw stderr ' + secret + '\\n')
      input.logger.warn('logger ' + secret)
    }
    let abortObserved = false
    return {
      tools: [], instructions: [],
      buildInitialContext: async (context) => {
        if (input.target.mode === 'signal') {
          await new Promise((resolve) => {
            const observeAbort = () => {
              abortObserved = true
              writeFileSync(input.target.marker + '.aborted', 'aborted')
              resolve()
            }
            if (context.signal.aborted) observeAbort()
            else context.signal.addEventListener('abort', observeAbort, { once: true })
          })
        }
        return []
      },
      handleToolResponses: async () => [],
      close: async () => {
        if (input.target.mode !== 'signal' || !abortObserved) return
        await new Promise((resolve) => setTimeout(resolve, 500))
      },
    }
  },
}\n`
	)
}

function completion(tool: string | undefined, actual = `fixture ${tool}`): unknown {
	return {
		id: 'fixture-completion',
		object: 'chat.completion',
		created: 1,
		model: 'fixture-model',
		choices: [
			{
				index: 0,
				message: tool
					? {
							role: 'assistant',
							content: null,
							tool_calls: [
								{
									id: 'fixture-call',
									type: 'function',
									function: {
										name: tool,
										arguments: JSON.stringify({ actualResult: actual }),
									},
								},
							],
						}
					: { role: 'assistant', content: 'no tool call' },
				finish_reason: tool ? 'tool_calls' : 'stop',
			},
		],
		usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
	}
}
