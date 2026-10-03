import { openDefaultStore } from './store.js';
import { createApp } from './http.js';

const portText = process.env.PORT?.trim();
const requestedPort = portText ? Number(portText) : 0;
if (portText && (!Number.isSafeInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535)) {
  console.error('PORT 必须是 0 到 65535 的整数；0 表示由系统选择空闲端口');
  process.exit(2);
}

const store = await openDefaultStore();
const server = createApp(store);

server.listen(requestedPort, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法读取监听端口');
  console.log(`素数区间服务已启动: http://127.0.0.1:${address.port}`);
  console.log('按 Ctrl+C 停止。');
});

function shutdown(): void {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
