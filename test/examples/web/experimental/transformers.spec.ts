import { test } from '../../../fixtures/checkmate'
import { pipeline, cos_sim } from '@huggingface/transformers'

// This test is meant to be run locally for performance and memory usage analysis of the transformers pipeline when processing page snapshots. It is not intended for CI as it may require significant resources and time depending on the size of the snapshot and the model used.
test.describe('transformers', () => {
	test('should transform tool calls to messages and back to tool calls', async ({ page }) => {
		const llmQuery = `
                Navigate to https://ollama.com
                Type 'qwen3' into the 'Search models' search bar
                Click on 'qwen3-vl' link from the results,
                Click on 'qwen3-vl:235b' link from the models list,`
		await page.goto('https://ollama.com')
		const snapshotElements = (await page.ariaSnapshot({ mode: 'ai' })).split('\n').map((line) => line.trim())
		console.log(snapshotElements.length)
		console.log(snapshotElements.join('\n').length)

		type models = 'snowflake/snowflake-arctic-embed-xs' | 'Xenova/all-MiniLM-L6-v2'
		const scoredElements: { element: string; score: number }[] = []

		const startTime = performance.now()
		const startMemory = process.memoryUsage().heapUsed
		let memoryPeak = 0

		const pipe = await pipeline('feature-extraction', 'snowflake/snowflake-arctic-embed-xs' satisfies models, {
			dtype: 'int8',
		})
		const queryOutput = await pipe(llmQuery, { pooling: 'mean', normalize: true })
		const queryEmbedding = queryOutput.data

		await Promise.all(
			snapshotElements.map(async (element) => {
				const elementOutput = await pipe(element.replaceAll(/\s*\[[^\]]*\]\s*/gm, ''), {
					pooling: 'mean',
					normalize: true,
				})
				const elementEmbedding = elementOutput.data

				const similarity = cos_sim(queryEmbedding as number[], elementEmbedding as number[])
				scoredElements.push({
					element,
					score: Math.round(similarity * 100) / 100,
				})

				const memoryDelta = process.memoryUsage().heapUsed - startMemory
				memoryPeak = memoryPeak < memoryDelta ? memoryDelta : memoryPeak
			})
		)
		const endTime = performance.now()
		console.log(`Total time: ${endTime - startTime} ms`)
		console.log(`Heaps peak: ${memoryPeak / 1024 / 1024} MB`)
		scoredElements.sort((a, b) => b.score - a.score)

		const topElements = scoredElements.slice(0, snapshotElements.length / 2)
		topElements.map((item) => console.log(item.element, item.score))
		console.log(topElements.join().length)
	})
})
