import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    execArgv: ['--disable-warning=ExperimentalWarning'],
    env: { LOG_LEVEL: 'silent' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/scripts/**', 'src/demo/transcript.ts'],
      reporter: ['text', 'html'],
    },
  },
})
