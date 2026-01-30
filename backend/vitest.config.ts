import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.test.ts'],
      testTimeout: 60000, // 60 seconds global timeout
      env,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: ['node_modules/', 'dist/', '**/*.test.ts'],
      },
    },
  };
});
