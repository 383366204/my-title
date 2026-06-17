const test = require('node:test');
const assert = require('node:assert/strict');

const { createWorkflowRunner } = require('../index');

test('workflow stops before submit and requires confirmation', async () => {
  const runner = createWorkflowRunner({
    sycm: async () => ({ ok: true, category: '饰品', keywords: ['陶瓷摆件'] }),
    selectProducts: async () => ({ ok: true, products: [{ offerId: '1' }] }),
    prepareDistribution: async () => ({ ok: true, canSubmit: true, file: '/tmp/distribution-batch.txt' })
  });

  const result = await runner.run({ keyword: '陶瓷摆件' });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'awaiting_user_confirmation');
  assert.equal(result.requiresUserAction, true);
  assert.equal(result.nextActionCode, 'confirm_before_submit');
});

test('workflow returns manual action when sycm login is required', async () => {
  const runner = createWorkflowRunner({
    sycm: async () => ({
      ok: false,
      status: 'login_required',
      blockers: ['sycm_login_required']
    })
  });

  const result = await runner.run({ keyword: '陶瓷摆件' });

  assert.equal(result.ok, false);
  assert.equal(result.requiresUserAction, true);
  assert.equal(result.nextActionCode, 'manual_action_required');
});
