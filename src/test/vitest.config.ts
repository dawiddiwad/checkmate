import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts'],
            exclude: [
                'test/**',
                'node_modules/**',
            ],
            thresholds: {
                lines: 40,
                functions: 50,
                branches: 35,
                statements: 40,
                'src/step/tool/browser-tool.ts': {
                    lines: 95,
                    functions: 95,
                    branches: 90,
                    statements: 95,
                },
                'src/step/tool/step-tool.ts': {
                    lines: 95,
                    functions: 95,
                    branches: 90,
                    statements: 95,
                },
                'src/step/openai/openai-test-manager.ts': {
                    lines: 95,
                    functions: 95,
                    branches: 90,
                    statements: 95,
                },
                'src/step/openai/openai-client.ts': {
                    lines: 95,
                    functions: 95,
                    branches: 90,
                    statements: 95,
                },
                'src/step/configuration-manager.ts': {
                    lines: 95,
                    functions: 95,
                    branches: 90,
                    statements: 95,
                },
                'src/step/openai/token-tracker.ts': {
                    lines: 95,
                    functions: 95,
                    branches: 85,
                    statements: 95,
                },
                'src/step/tool/loop-detector.ts': {
                    lines: 95,
                    functions: 95,
                    branches: 90,
                    statements: 95,
                },
                'src/step/openai/history-manager.ts': {
                    lines: 95,
                    functions: 95,
                    branches: 95,
                    statements: 95,
                },
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
})
