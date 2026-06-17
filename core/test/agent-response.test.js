const { describe, it } = require('node:test');
const assert = require('node:assert');

const { withAgentResponseFields } = require('../agent-response');

describe('agent response fields', () => {
  it('adds stable weak-agent fields to ready responses', () => {
    const result = withAgentResponseFields({
      ok: true,
      status: 'ready_to_distribute',
      nextCommand: 'node bin/cli.js distribute --check --json'
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'ready_to_distribute');
    assert.equal(result.nextActionCode, 'ready_to_distribute');
    assert.equal(result.requiresUserAction, false);
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.allowedCommands, ['node bin/cli.js distribute --check --json']);
    assert.ok(result.userMessage);
  });

  it('marks blocked and review responses as requiring user action', () => {
    const blocked = withAgentResponseFields({
      ok: false,
      status: 'blocked',
      blockers: ['browser_cdp_unavailable']
    });
    assert.equal(blocked.requiresUserAction, true);
    assert.equal(blocked.nextActionCode, 'fix_blockers');
    assert.deepEqual(blocked.allowedCommands, []);

    const review = withAgentResponseFields({
      ok: true,
      status: 'needs_review',
      mustReview: true,
      nextCommand: 'node bin/cli.js flow export --json'
    });
    assert.equal(review.requiresUserAction, true);
    assert.equal(review.nextActionCode, 'review_required');
    assert.deepEqual(review.allowedCommands, ['node bin/cli.js flow export --json']);
  });

  it('marks login-required payloads as manual user action', () => {
    const result = withAgentResponseFields({
      ok: false,
      status: 'login_required',
      blockers: ['sycm_login_required']
    });

    assert.equal(result.requiresUserAction, true);
    assert.equal(result.nextActionCode, 'manual_action_required');
    assert.match(result.userMessage, /登录|login/i);
  });

  it('marks slider-required payloads as manual user action', () => {
    const result = withAgentResponseFields({
      ok: false,
      status: 'slider_required',
      blockers: ['sycm_slider_required']
    });

    assert.equal(result.requiresUserAction, true);
    assert.equal(result.nextActionCode, 'manual_action_required');
    assert.match(result.userMessage, /滑块|slider/i);
  });
});
