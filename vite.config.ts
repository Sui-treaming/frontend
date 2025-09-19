import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    plugins: [react()],
    publicDir: 'public',
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        cssCodeSplit: true,
        rollupOptions: {
            input: {
                background: resolve(rootDir, 'src/background/index.ts'),
                content: resolve(rootDir, 'src/content/index.tsx'),
                'content-loader': resolve(rootDir, 'src/content/loader.ts'),
                options: resolve(rootDir, 'options.html'),
                popup: resolve(rootDir, 'popup.html'),
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
