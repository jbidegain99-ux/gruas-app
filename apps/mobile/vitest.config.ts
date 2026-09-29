import { defineConfig } from 'vitest/config';

// Only covers pure TS utilities under lib/. React Native component tests
// would need jest-expo, which is a separate setup.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
