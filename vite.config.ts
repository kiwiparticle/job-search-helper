import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: 'web',
    plugins: [react()],
    define: { __BUILD__: JSON.stringify(Date.now().toString()) },
    build: { outDir: '../dist', emptyOutDir: true },
    test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'], setupFiles: ['src/test-setup.ts'] },
});
