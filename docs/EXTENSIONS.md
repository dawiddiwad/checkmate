# **_checkmate_** extensions

This guide is about how to adapt **_checkmate_** to your own domain.

Use it when you want to:

- add a new tool
- add a new extension
- compose your own runner
- build on top of `web()` or `salesforce()`

## Core Idea

`@xoxoai/checkmate/core` stays generic.

The runner owns:

- the model loop with retries
- pass/fail resolution
- tool dispatch

Extensions add domain-specific skills such as:

- tools
- system instructions
- initial step context
- post-tool context
- teardown logic
- shared capabilities across extensions

Pre-built `web()` and `salesforce()` are in fact extensions - made the same way as you would build your own.

## Tool vs Extension

Use `defineTool()` to create a new action the model can call.

Use `defineExtension()` to bundle different tools and instructions, setup, or extra context.

Use `createRunner()` to compose your own runtime from extensions.

## Your First Tool

A tool is the smallest unit of behavior.

```typescript
import { defineTool } from '@xoxoai/checkmate/core'
import { z } from 'zod/v4'

export const health = defineTool({
	name: 'api-health',
	description: 'Check whether the API is healthy',
	schema: z.object({ url: z.string().url() }).strict(),
	handler: async ({ url }) => {
		return {
			response: `API health is good for ${url}`,
			status: 'success',
		}
	},
})
```

Good tools are:

- single-purpose
- concrete
- easy to describe in one sentence
- safe to call multiple times

## Your First Extension

An extension can bundle one or more tools and instructions.

```typescript
import { createRunner, defineExtension } from '@xoxoai/checkmate/core'
import { web } from '@xoxoai/checkmate/playwright'
import { health, queryRecords } from './api-tools'

export const apiExtension = defineExtension({
	name: 'api',
	tools: [health, queryRecords],
	instructions: ['Use api tools to interact with xyz service.', 'Prefer api tools over web tools when possible.'],
})

const ai = createRunner({
	extensions: [web({ page }), apiExtension],
})
```

This already gives you a reusable building block that can be shared across projects.

## Extension Hooks

Extensions can do more than register tools.

`defineExtension()` supports these hooks:

- `tools`: register one or more tools
- `instructions`: append system-level guidance for the model
- `setup(api)`: register capabilities, tools, hooks, or teardown logic
- `buildInitialMessages(context)`: add step-specific context before the first model call
- `handleToolResponses(context)`: append fresh context after tools run
- `teardown()`: clean up extension-owned resources

Example:

```typescript
import { defineExtension } from '@xoxoai/checkmate/core'

export const releaseGuard = defineExtension({
	name: 'release-guard',
	instructions: ['Prefer visible release labels over inferred version numbers.'],
	buildInitialMessages: async ({ step }) => [
		{
			role: 'user',
			content: `Current release check target: ${step.expect}`,
		},
	],
})
```

## Setup API

Inside `setup(api)`, you can compose richer behavior.

Available methods:

- `addTool()`
- `addInstruction()`
- `addInitialMessages()`
- `addToolResponsesHook()`
- `setCapability()`
- `getCapability()`
- `onTeardown()`

This is the main escape hatch for advanced integrations.

## Capabilities and Composition

Capabilities let one extension publish something another extension can use without hard-coding the relationship into the core runner.

That is how the Salesforce extension builds on the web extension.

Example:

```typescript
import { defineExtension } from '@xoxoai/checkmate/core'
import { Page } from '@playwright/test'
import { PlaywrightCapability } from '@xoxoai/checkmate/playwright'

export const auditTrail = defineExtension({
	name: 'audit-trail',
	setup(api) {
		const page = api.getCapability<Page>(PlaywrightCapability.PAGE)

		api.addInstruction(`Current page starts at: ${page.url()}`)
	},
})
```

Prefer capabilities when one extension depends on another extension's runtime objects.

## Extending Built-In Extensions

Built-in extensions are composable too.

You do not need to rewrite `web()` or `salesforce()` to adapt them.

```typescript
import { web } from '@xoxoai/checkmate/playwright'

const companyWeb = web({ page }).extend({
	instructions: ['Prefer visible labels over generated ids.'],
})
```

You can also add tools or hooks on top of the built-in extension:

```typescript
const companyWeb = web({ page }).extend({
	tools: [apiHealthTool],
	instructions: ['Check API health before asserting UI state.'],
})
```

This is usually better than cloning the built-in extension from scratch.

## Building a Custom Runner

Once you have extensions, create a runner helper that matches your domain.

```typescript
import { createRunner } from '@xoxoai/checkmate/core'
import { Page } from '@playwright/test'
import { web } from '@xoxoai/checkmate/playwright'
import { salesforce } from '@xoxoai/checkmate/salesforce'
import { apiHealth } from './api-health-extension'

export function createAcmeRunner(page: Page) {
	return createRunner({
		extensions: [web({ page }), salesforce(), apiHealth],
	})
}
```

This keeps test code simple while letting your runtime evolve in one place.

## Design Guidelines

Keep extensions readable and honest.

- Keep tools focused on one action.
- Keep domain behavior out of the core runner.
- Prefer extension composition over copying built-ins.
- Prefer capabilities over direct imports between unrelated extensions.
- Keep instructions concrete and short.
- Add initial or post-tool context only when the model truly needs it.
- Return clear tool responses that help the model decide the next step.

## Recommended Progression

Most teams should build in this order:

1. Start with `@xoxoai/checkmate/playwright`.
2. Add one custom tool with `defineTool()`.
3. Group related tools into an extension with `defineExtension()`.
4. Compose a project-specific runner with `createRunner()`.
5. Extend built-ins only when you need custom runtime behavior.

## See Also

- [GUIDE](./GUIDE.md)
- [README](../README.md)
