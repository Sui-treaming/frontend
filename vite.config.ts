import { resolve } from 'node:path';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    publicDir: 'public',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        cssCodeSplit: true,
        rollupOptions: {
            input: {
                background: resolve(__dirname, 'src/background/index.ts'),
                content: resolve(__dirname, 'src/content/index.tsx'),
                options: resolve(__dirname, 'options.html'),
            },
            output: {
                entryFileNames: 'assets/[name].js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: 'assets/[name][extname]',
            },
        },
        chunkSizeWarningLimit: 1000,
        sourcemap: true,
    },
});
