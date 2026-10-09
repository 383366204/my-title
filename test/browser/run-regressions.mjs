import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const script of [
  'workflow-hook-races.mjs',
  'workflow-session-races.mjs',
  'workflow-studio-ui.mjs',
  'keyword-filter.mjs',
  'distribution-categories.mjs',
  'distribution-job-refresh.mjs',
  'distribution-copy-formats.mjs',
  'distribution-shops.mjs',
  'distribution-list-confirmation.mjs',
  'supplemental-products.mjs',
  'unified-selection.mjs',
  'discovery-direction.mjs',
  'inspiration-root-review.mjs',
  'distribution-completion-integration.mjs',
  'copy-text-fallback.mjs',
  'run-switch-isolation.mjs'
]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
    stdio: 'inherit', env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
