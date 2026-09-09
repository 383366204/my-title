import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const script of ['workflow-hook-races.mjs', 'workflow-session-races.mjs', 'workflow-studio-ui.mjs']) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
    stdio: 'inherit', env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
