import sharp from 'sharp'
import { Page } from '@playwright/test'

export class ScreenshotProcessor {
	constructor(private readonly page: Page) {}

	async getCompressedScreenshot(): Promise<{ mimeType?: string; data: string }> {
		try {
			const screenshot = await this.page.screenshot()
			const compressedBuffer = await sharp(screenshot)
				.resize({ width: 768, height: 768, fit: 'inside' })
				.toBuffer()
			if (!compressedBuffer) {
				throw new Error('Failed to compress screenshot')
			}
			return {
				mimeType: 'image/png',
				data: compressedBuffer.toString('base64'),
			}
		} catch (error) {
			throw new Error(`Failed to get compressed screenshot:\n${error}`)
		}
	}
}
