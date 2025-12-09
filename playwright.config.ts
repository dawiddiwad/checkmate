import { defineConfig } from '@playwright/test'
import { config as envConfig } from "dotenv"

envConfig({ quiet: true })

export default defineConfig({
  projects: [
    {
      name: 'salesforce',
      testDir: './test/specs/salesforce'
    },
    {
      name: 'web',
      testDir: './test/specs/web'
    },
    {
      name: 'live',
      testDir: './test/specs/live'
    },
    {
      name: 'aria',
      testDir: './test/specs/aria-playground'
    }
  ],
  outputDir: process.env.CI ? undefined : './test-reports/results',
  reporter: [
    ['junit', { outputFile: './test-reports/junit/results.xml' }],
    ['html', { outputFolder: './test-reports/html' }],
    ['list']
  ],
  timeout: 5 * 60000,
  repeatEach: 1,
  retries: 1,
  workers: 1,
  expect: {
    timeout: 1 * 10000
  },
  use: {
    browserName: 'chromium',
    actionTimeout: 1 * 5000,
    navigationTimeout: 1 * 30000,
    screenshot: 'only-on-failure',
    video: 'on'
  }
})