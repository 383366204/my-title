#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_SKILLS = ['1688-distribution', 'keyword-mining', 'pipeline-flow', 'title-gen'];
const DEFAULT_MODE = 'copy';

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function defaultHermesSkillsDir() {
  return process.env.HERMES_SKILLS_DIR
    || path.join(os.homedir(), '.hermes', 'skills', 'ecommerce');
}

function ensureInside(base, target) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Refusing to write outside ${resolvedBase}: ${resolvedTarget}`);
  }
}

function copyDir(src, dest) {
  const stat = fs.lstatSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyDir(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  fs.copyFileSync(src, dest);
}

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function wslRepoRoot(root = repoRoot()) {
  const normalized = toPosixPath(path.resolve(root));
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (drive) {
    return `/mnt/${drive[1].toLowerCase()}/${drive[2]}`;
  }
  return normalized;
}

function skillTitle(skillName) {
  if (skillName === '1688-distribution') return '张飞搬家多店复制铺货自动化';
  if (skillName === 'keyword-mining') return '每日蓝海候选词挖掘';
  if (skillName === 'pipeline-flow') return '选词到铺货流水线';
  return skillName;
}

function wrapperBody(skillName, options = {}) {
  const projectRoot = options.projectRoot || wslRepoRoot();
  const syncMode = options.mode || 'wrapper';
  const syncModeLine = syncMode === 'copy'
    ? 'Sync mode: copy. Codex changes require running `node bin/cli.js sync-hermes-skills --apply --json` before Hermes sees updates.'
    : 'Sync mode: wrapper. This skill delegates to the live repository path, so Codex changes are visible immediately.';
  if (skillName === '1688-distribution') {
    return [
      '---',
      'name: 1688-distribution',
      'description: "Distribution wrapper that calls the live my-title project checkout."',
      'version: 1.0.0-wrapper',
      'platforms: [linux, macos, windows]',
      '---',
      '',
      '# 1688-distribution',
      '',
      'This is a Hermes wrapper skill. The implementation lives in the my-title repository.',
      syncModeLine,
      '',
      '## Fixed Project Directory',
      '',
      '```bash',
      `cd ${projectRoot}`,
      '```',
      '',
      '## Fixed Commands',
      '',
      '```bash',
      `cd ${projectRoot}`,
      'node bin/cli.js doctor --json',
      'node bin/cli.js doctor --deep --json',
      'node bin/cli.js distribute --input-file data/pipeline/runs/<runId>/distribution-batch.txt --dry-run --json',
      'node bin/cli.js distribute --input-file data/pipeline/runs/<runId>/distribution-batch.txt --check --json',
      'node bin/cli.js distribute --input-file data/pipeline/runs/<runId>/distribution-batch.txt --submit --json',
      '```',
      '',
      '## Weak Agent Rules',
      '',
      '- This is a final submit action. Show the concrete product list and wait for explicit user confirmation before `--submit`.',
      '- If `doctor --json` reports blockers, fix them before running distribution.',
      '- Read `nextActionCode`, `requiresUserAction`, `blockers`, and `userMessage` literally.',
      '- For login/authorization troubleshooting, run `node bin/cli.js doctor --deep --json`.',
      '- If item.jnesoft.com reports expired login, run `distribute --check --json`; the CLI can click `重新登录`, fall back to `重新授权`, click Taobao `授权并登录`, then return to readiness checks.',
      '- If JSON reports QR code, SMS, password, captcha, slider, or another manual challenge, stop and show `userMessage`.',
      '- Always run dry-run, then check, then submit.',
      '- Do not manually click page buttons unless the CLI is unavailable.',
      '- Do not open a new business tab for every batch; the CLI reuses the existing item.jnesoft.com tab.',
      '- Submit succeeds only when JSON `ok` is true and every batch has `status: confirmed`.',
      '- `confirmation.missingOfferIds` must be empty.',
      '- `confirmation.perOfferId` may show `batch` or `single`; both are acceptable.',
      '- If status is `partial_confirmed` or `not_confirmed`, stop and report missing ids. Do not submit again automatically.',
      ''
    ].join('\n');
  }
  if (skillName === 'pipeline-flow') {
    return [
      '---',
      'name: pipeline-flow',
      'description: "Daily keyword-to-distribution wrapper that calls the live my-title project checkout."',
      'version: 1.0.0-wrapper',
      'platforms: [linux, macos, windows]',
      '---',
      '',
      '# pipeline-flow',
      '',
      'This is a Hermes wrapper skill. The implementation lives in the my-title repository.',
      syncModeLine,
      '',
      '## Fixed Project Directory',
      '',
      '```bash',
      `cd ${projectRoot}`,
      '```',
      '',
      '## Fixed Commands',
      '',
      '```bash',
      `cd ${projectRoot}`,
      'node bin/cli.js doctor --json',
      'node bin/cli.js flow daily --mine 50 --verify 20 --generate 10 --export 20 --json',
      'node bin/cli.js flow mine --limit 50 --json',
      'node bin/cli.js flow verify --run <runId> --limit 20 --json',
      'node bin/cli.js flow generate --run <runId> --limit 10 --products-per-keyword 3 --json',
      'node bin/cli.js flow export --run <runId> --limit 20 --json',
      '```',
      '',
      '## Weak Agent Rules',
      '',
      '- Follow returned `status`, `blockers`, and `nextCommand`. Do not invent the next step.',
      '- If `doctor --json` reports blockers, fix them before running the flow.',
      '- Read `nextActionCode`, `requiresUserAction`, `blockers`, and `userMessage` literally.',
      '- Do not run SYCM queries in parallel.',
      '- If status is `manual_action_required` or `verified_partial_manual_required`, stop and ask the user to finish the browser action.',
      '- `flow generate --limit` is keyword count; `--products-per-keyword` is product count per keyword.',
      '- Do not call `node bin/cli.js "<keyword>" --count 10` as a substitute for flow generate.',
      '- The flow exports a batch file only. It does not submit distribution.',
      '- Before distribution, show the batch to the user and use `1688-distribution`.',
      ''
    ].join('\n');
  }
  if (skillName === 'keyword-mining') {
    return [
      '---',
      'name: keyword-mining',
      'description: "Keyword mining wrapper that calls the live my-title project checkout."',
      'version: 1.0.0-wrapper',
      'platforms: [linux, macos, windows]',
      '---',
      '',
      '# keyword-mining',
      '',
      'This is a Hermes wrapper skill. The implementation lives in the my-title repository.',
      syncModeLine,
      '',
      '## Fixed Project Directory',
      '',
      '```bash',
      `cd ${projectRoot}`,
      '```',
      '',
      '## Fixed Commands',
      '',
      '```bash',
      `cd ${projectRoot}`,
      'node bin/cli.js doctor --json',
      'node bin/cli.js mine-keywords --limit 50 --mode balanced --json',
      'node bin/cli.js mine-keywords --limit 80 --mode explore --json',
      '```',
      '',
      '## Weak Agent Rules',
      '',
      '- Mining output is only a candidate list, not proof of blue-ocean value.',
      '- If `doctor --json` reports blockers, fix them before running browser-dependent steps.',
      '- Read `nextActionCode`, `requiresUserAction`, `blockers`, and `userMessage` literally.',
      '- Use SYCM verification before title generation.',
      '- Read `decision`, `nextAction`, and `opportunityScore` literally.',
      '- Do not distribute from mining output directly.',
      ''
    ].join('\n');
  }
  if (skillName === 'title-gen') {
    return [
      '---',
      'name: title-gen',
      'description: "Title generation wrapper that calls the live my-title project checkout."',
      'version: 1.0.0-wrapper',
      'platforms: [linux, macos, windows]',
      '---',
      '',
      '# title-gen',
      '',
      'This is a Hermes wrapper skill. The implementation lives in the my-title repository.',
      syncModeLine,
      '',
      '## Fixed Project Directory',
      '',
      '```bash',
      `cd ${projectRoot}`,
      '```',
      '',
      '## Fixed Commands',
      '',
      '```bash',
      `cd ${projectRoot}`,
      'node bin/cli.js doctor --json',
      'node bin/cli.js "<keyword>" --length 60 --json',
      'node bin/cli.js "<keyword>" --length 60 --count 3 --json',
      'node bin/cli.js "<keyword>" --length 60 --count 3 --run-timeout-ms 180000 --json',
      'node bin/cli.js --keywords "<keyword1>,<keyword2>" --length 60 --json',
      '```',
      '',
      '## Weak Agent Rules',
      '',
      '- `--count` means candidate title count, not product count.',
      '- If `doctor --json` reports blockers, fix them before relying on browser-dependent peer-title search.',
      '- Read `nextActionCode`, `requiresUserAction`, `blockers`, and `userMessage` literally.',
      '- Do not use `--count 10` or `--count 15` to mean select 10 products.',
      '- If one title command times out, retry once with `--count 3 --run-timeout-ms 180000`.',
      '- If JSON code is `title_generation_timeout`, report title-generation timeout. Do not call it GLM rate limit.',
      '- If JSON includes `retryWith`, follow it literally. Do not invent GLM/1688 rate-limit causes from timeout alone.',
      '- Only report 1688 rate limit when JSON has `source: "1688"` or `code: "1688_rate_limited"`.',
      '- Do not run multiple full title-generation commands in parallel.',
      '- For keyword -> SYCM -> title -> distribution batch, prefer `pipeline-flow`.',
      '- Do not distribute products directly from title-gen output; show the concrete list and use `1688-distribution` after user confirmation.',
      ''
    ].join('\n');
  }
  const title = skillTitle(skillName);
  const common = [
    '---',
    `name: ${skillName}`,
    `description: "${title} — wrapper skill，实际逻辑直接调用 my-title 项目中的最新代码"`,
    'version: 1.0.0-wrapper',
    'platforms: [linux, macos, windows]',
    '---',
    '',
    `# ${title}`,
    '',
    '这是一个 Hermes wrapper skill。不要在 Hermes skill 目录里寻找业务代码；业务代码、规则、测试和数据都以项目仓库为准。',
    syncModeLine,
    '',
    '## 固定项目目录',
    '',
    '```bash',
    `cd ${projectRoot}`,
    '```',
    '',
    '所有命令都必须先进入上面的目录执行。这样项目代码更新后，Hermes 会自动使用最新逻辑，不需要复制整份 skill。',
    ''
  ];

  const sections = {
    '1688-distribution': [
      '## 固定流程',
      '',
      '```bash',
      `cd ${projectRoot}`,
      'node bin/cli.js doctor --deep --json',
      'node bin/cli.js distribute --input-file data/pipeline/runs/<runId>/distribution-batch.txt --dry-run --json',
      'node bin/cli.js distribute --input-file data/pipeline/runs/<runId>/distribution-batch.txt --check --json',
      'node bin/cli.js distribute --input-file data/pipeline/runs/<runId>/distribution-batch.txt --submit --json',
      '```',
      '',
      '## 弱模型规则',
      '',
      '- 不要手动推理网页按钮，优先调用 CLI。',
      '- 登录/授权排查先跑 `node bin/cli.js doctor --deep --json`。',
      '- 如 item.jnesoft.com 登录过期，运行 `distribute --check --json`；CLI 会尝试点击 `重新登录`，失败时退到 `重新授权`，再点击淘宝 `授权并登录`。',
      '- 如遇二维码、短信、密码、验证码、滑块或其它人工挑战，停止并展示 `userMessage`。',
      '- distribute 是最终提交动作；必须先展示具体铺货清单并拿到用户明确确认。',
      '- 铺货前必须做版权/IP 预排查；风险库见项目 `skills/1688-distribution/references/ip-copyright-risk-db.md`。',
      '- 输入文件优先使用 `URL<TAB>标题<TAB>类目`；没有类目时退回 `URL<TAB>标题`。',
      '- 类目来自 `node bin/cli.js sycm "<关键词>" --mode blue --json` 的 `categoryAnalysis.recommendation.recommended.category`。',
      '- 不要在 bash 命令行里直接传 `URL$$标题` 或 `URL$$标题$$类目`，因为 `$$` 会展开成进程号。',
      '- 提交前必须先跑 `--dry-run` 和 `--check`。',
      '- 提交后必须以复制记录确认为准；只有全部 offerId 都出现才是 `confirmed`。',
      '- 如果返回 `partial_confirmed` 或 `not_confirmed`，停止并报告缺失商品 ID。',
      '- 如遇 missingOfferIds，先看项目 `skills/1688-distribution/references/missing-offerids-false-positive-bug.md`，不要把推测当结论。',
      '- 日常每批建议不超过 50 个商品；100 个以上必须拆批。',
      '- 不要重复点击 `开始批量复制`。',
      '- 不要每批新开 tab，CLI 会复用已有浏览器页。'
    ],
    'keyword-mining': [
      '## 固定流程',
      '',
      '```bash',
      `cd ${projectRoot}`,
      'node bin/cli.js mine-keywords --limit 50 --mode balanced --json',
      'node bin/cli.js mine-keywords --limit 80 --mode explore --json',
      '```',
      '',
      '## 验证规则',
      '',
      '- 正向挖词只用于找市场入口词，不直接等同蓝海。',
      '- 先执行返回结果里的 `hotCheck`，确认有人搜。',
      '- 再执行 `blueExplore`，从 Blue 模式结果中挑高 DSR、无品牌和违禁风险的关联词。',
      '- `demandSupplyRatio = 需求 / 供给`，数值越高越偏蓝海，`>= 1` 才表示需求大于供给。',
      '- `directKeywords` 是足够具体的入口词，可直接选品或先做 hot/blue 双验证。'
    ],
    'pipeline-flow': [
      '## 固定流程',
      '',
      '```bash',
      `cd ${projectRoot}`,
      'node bin/cli.js flow daily --mine 50 --verify 20 --generate 10 --export 20 --json',
      'node bin/cli.js flow status --json',
      '```',
      '',
      '## 验证规则',
      '',
      '- 不自动铺货，先产出 `distribution-batch.txt`。',
      '- `verifyMode=blue` 才是严格蓝海；`blue_relaxed` 是中等信心；`hot` 只能作为趋势参考。',
      '- 如果 SYCM 类目分析有推荐类目，`distribution-batch.txt` 会导出 `URL$$标题$$类目`。',
      '- 如果返回 `status=needs_review` 或 `mustReview=true`，先读 `distribution-review.md`，不要铺货。',
      '- 铺货前交给 `1688-distribution` wrapper 执行 dry-run/check/submit。'
    ]
  };

  return [...common, ...(sections[skillName] || [
    '## 执行',
    '',
    '```bash',
    `cd ${projectRoot}`,
    'node bin/cli.js --help',
    '```'
  ]), ''].join('\n');
}

function writeWrapperSkill(skillName, target, options = {}) {
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), wrapperBody(skillName, options), 'utf8');
  fs.writeFileSync(path.join(target, 'WRAPPER.md'), [
    '# Wrapper Skill',
    '',
    'This directory intentionally contains only Hermes-facing wrapper docs.',
    'The implementation lives in the my-title repository and is executed through `node bin/cli.js`.',
    ''
  ].join('\n'), 'utf8');
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    if (err && err.code === 'EISDIR') {
      return {
        isDirectory: () => true,
        isSymbolicLink: () => false
      };
    }
    throw err;
  }
}

function removePath(target) {
  const stat = lstatOrNull(target);
  if (!stat) return;
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    fs.rmSync(target, { recursive: true, force: true });
  } else {
    fs.unlinkSync(target);
  }
}

function syncSkill(skillName, options = {}) {
  const sourceRoot = options.sourceRoot || path.join(repoRoot(), 'skills');
  const targetRoot = options.targetRoot || defaultHermesSkillsDir();
  const source = path.join(sourceRoot, skillName);
  const target = path.join(targetRoot, skillName);
  const targetStat = lstatOrNull(target);
  const mode = options.mode || DEFAULT_MODE;

  if (!lstatOrNull(source)) throw new Error(`Skill source not found: ${source}`);
  if (mode !== 'copy' && mode !== 'wrapper') throw new Error(`Unsupported sync mode: ${mode}`);
  ensureInside(targetRoot, target);

  const plan = {
    skillName,
    source,
    target,
    mode,
    action: targetStat ? 'replace' : 'create',
    wasSymlink: targetStat ? targetStat.isSymbolicLink() : false,
    projectRoot: options.projectRoot || wslRepoRoot()
  };

  if (options.dryRun) return plan;

  fs.mkdirSync(targetRoot, { recursive: true });
  if (targetStat) removePath(target);
  if (mode === 'wrapper') writeWrapperSkill(skillName, target, plan);
  else copyDir(source, target);
  plan.completed = true;
  plan.isSymlink = fs.lstatSync(target).isSymbolicLink();
  return plan;
}

function parseArgs(argv) {
  const args = {
    dryRun: true,
    mode: DEFAULT_MODE,
    skills: [],
    targetRoot: defaultHermesSkillsDir()
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.dryRun = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--mode') args.mode = argv[++i];
    else if (arg === '--project-root') args.projectRoot = argv[++i];
    else if (arg === '--target') args.targetRoot = argv[++i];
    else if (arg === '--skill') args.skills.push(argv[++i]);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else args.skills.push(arg);
  }
  if (args.skills.length === 0) args.skills = DEFAULT_SKILLS.slice();
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/sync-hermes-skills.js [--apply] [--mode copy|wrapper] [--target <dir>] [--skill <name>]

Copies project skills into Hermes' trusted skill directory as real files.
Default is dry-run. Use --apply to replace existing symlinks/directories.
Use --mode wrapper to write a small Hermes skill that calls the live project checkout.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const results = args.skills.map(skillName => syncSkill(skillName, args));
  console.log(JSON.stringify({
    ok: true,
    dryRun: args.dryRun,
    targetRoot: args.targetRoot,
    results
  }, null, 2));
}

if (require.main === module) {
  main().catch(err => {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  });
}

module.exports = {
    syncSkill,
  wrapperBody,
  wslRepoRoot,
  defaultHermesSkillsDir
};
