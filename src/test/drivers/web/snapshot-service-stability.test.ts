import { describe, expect, it, vi } from 'vitest'
import { Page } from 'playwright'
import { SnapshotService } from '../../../drivers/web/tools/snapshot-service'
import { silentLogger } from '../../../logging/types'

function pageWithHtmlReads(...reads: string[]): Page {
	let call = 0
	return {
		locator: vi.fn().mockReturnValue({
			innerHTML: vi.fn().mockImplementation(async () => reads[Math.min(call++, reads.length - 1)]),
		}),
		waitForTimeout: vi.fn().mockResolvedValue(undefined),
		ariaSnapshot: vi.fn().mockResolvedValue('- text: stable'),
		url: vi.fn(() => 'https://example.com'),
		title: vi.fn().mockResolvedValue('Example'),
	} as unknown as Page
}

describe('SnapshotService stability wait', () => {
	it('resolves once two consecutive reads match, using an ordinary wait rather than a Playwright assertion', async () => {
		const page = pageWithHtmlReads('<html>a</html>', '<html>a</html>')
		const service = new SnapshotService(page, { snapshotFilter: false, snapshotTopPercent: 10 }, silentLogger)

		await expect(service.get()).resolves.toBeTruthy()
	})

	it('polls again rather than failing immediately when the first two reads disagree', async () => {
		const page = pageWithHtmlReads('<html>a</html>', '<html>b</html>', '<html>c</html>', '<html>c</html>')
		const service = new SnapshotService(page, { snapshotFilter: false, snapshotTopPercent: 10 }, silentLogger)

		await expect(service.get()).resolves.toBeTruthy()
		expect((page.locator('html').innerHTML as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(4)
	})
})
