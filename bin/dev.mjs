import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../apps/web/node_modules/vite/dist/node/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const backend = fork(fileURLToPath(new URL('./server.js', import.meta.url)), [], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'development' },
  stdio: ['inherit', 'inherit', 'inherit', 'ipc']
});
let frontend;
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // 退出开发入口时同时回收两个服务，避免留下旧端口。
  const deadline = setTimeout(() => {
    backend.kill('SIGKILL');
    frontend?.httpServer?.closeAllConnections();
    // Vite 的依赖预构建可能仍在收尾；用户主动退出保持正常退出码。
    process.exit(code);
  }, 5000);
  try {
    let exited;
    if (backend.exitCode === null && backend.signalCode === null) {
      exited = new Promise(resolve => backend.once('exit', resolve));
      backend.kill('SIGTERM');
    }
    frontend?.httpServer?.closeAllConnections();
    await frontend?.close();
    await exited;
  } finally {
    clearTimeout(deadline);
    process.exit(code);
  }
}

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
backend.on('exit', code => { if (!stopping) void stop(code || 1); });

try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend startup timed out')), 30000);
    const cleanup = () => { clearTimeout(timer); backend.off('message', ready); backend.off('error', failed); };
    const ready = message => {
      if (message?.type !== 'server-ready') return;
      cleanup(); resolve(message.port);
    };
    const failed = error => { cleanup(); reject(error); };
    backend.on('message', ready);
    backend.once('error', failed);
  });
  frontend = await createServer({
    root: fileURLToPath(new URL('../apps/web/', import.meta.url)),
    server: {
      host: '127.0.0.1',
      port: Number(process.env.WEB_PORT || 5173),
      proxy: { '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: true, ws: true } }
    }
  });
  if (!stopping) {
    await frontend.listen();
    console.log('\n开发页面（请打开下方地址；前端热更新，后端修改后重启 npm run dev）：');
    frontend.printUrls();
    process.send?.({ type: 'dev-ready', backendPort: port, frontendUrl: frontend.resolvedUrls.local[0] });
  } else await frontend.close();
} catch (error) {
  console.error(error.message);
  await stop(1);
}
