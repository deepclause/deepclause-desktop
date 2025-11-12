import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs'; // 引入 Node.js 的文件系统模块

// --- 辅助函数：递归复制目录 ---
function copyDir(src: string, dest: string) {
  // 确保目标目录存在
  fs.mkdirSync(dest, { recursive: true });
  
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      // 递归调用复制子目录
      copyDir(srcPath, destPath);
    } else {
      // 复制文件
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
// ---------------------------------

// 定义自定义插件
const copyAssetsPlugin: Plugin = {
  name: 'copy-custom-assets',
  // 使用 closeBundle 钩子确保在 Vite 完成打包后执行复制
  closeBundle() {
    console.log('[Custom Asset Copy] Starting asset copy...');
    
    // 1. 定义源目录 (相对于 vite.config.ts 所在的项目根目录)
    const sourceDir = path.resolve(__dirname, 'src/electron/assets');
    
    // 2. 定义目标目录 (相对于 vite.config.ts 所在的项目根目录)
    // 这里的 destDir 必须根据你的 outDir 设置来计算：
    // outDir: '../../../dist/renderer' -> 实际是 ${__dirname}/dist/renderer
    const destDir = path.resolve(__dirname, 'dist/renderer/assets'); 

    try {
      if (fs.existsSync(sourceDir)) {
        copyDir(sourceDir, destDir);
        console.log(`[Custom Asset Copy] Assets copied from ${path.basename(sourceDir)} to ${path.relative(__dirname, destDir)}`);
      } else {
        console.warn(`[Custom Asset Copy] Warning: Source asset directory not found at ${path.relative(__dirname, sourceDir)}`);
      }
    } catch (error) {
      console.error('[Custom Asset Copy] Error copying assets:', error);
    }
  }
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    copyAssetsPlugin // 注入自定义插件
  ],
  base: './', // 保持相对路径，这对 Electron 生产环境至关重要
  root: './src/electron/renderer',
  publicDir: 'public',
  build: {
    outDir: '../../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/electron/renderer/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/electron/renderer/src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
