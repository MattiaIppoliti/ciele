#!/usr/bin/env node
// Local evidence is a truthful commit status, never a fabricated Actions check.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const CONTEXT = 'local/software-and-overlay-v1';
export function accept(statuses, { owner, base, tree }) {
  // GitHub returns newest first. Never reuse an older success after a failure.
  const status = statuses.find(s => s.context === CONTEXT);
  return Boolean(status && status.state === 'success' && status.creator?.login === owner
    && status.description === `base=${base} tree=${tree}`);
}
export function same(a, b) {
  return ['head', 'base', 'tree', 'node', 'pnpm'].every(k => a[k] === b[k]);
}
export function run(args, cwd = process.cwd()) {
  const command = (bin, argv, inherited = false) => execFileSync(bin, argv,
    { cwd, encoding: inherited ? undefined : 'utf8', stdio: inherited ? 'inherit' : 'pipe', maxBuffer: 256 * 1024 * 1024 });
  const git = argv => command('git', argv).trim();
  const api = endpoint => JSON.parse(command('gh', ['api', endpoint]));
  const root = git(['rev-parse', '--show-toplevel']);
  if (resolve(cwd) !== root) throw new Error('Run from the repository root.');
  const receipt = resolve(root, git(['rev-parse', '--git-path', 'local-validation-v1.json']));
  const clean = () => { if (git(['status', '--porcelain'])) throw new Error('Commit all changes first; untracked files invalidate validation.'); };
  const snapshot = () => {
    clean();
    const head = git(['rev-parse', 'HEAD']);
    const base = git(['rev-parse', 'origin/main']);
    command('git', ['merge-base', '--is-ancestor', base, head]);
    if (process.versions.node.split('.')[0] !== '22') throw new Error('Use Node 22, matching CI, before local validation.');
    return { head, base, tree: git(['rev-parse', 'HEAD^{tree}']), node: process.version, pnpm: command('pnpm', ['--version']).trim() };
  };
  const checked = () => {
    const current = snapshot();
    if (!existsSync(receipt) || !same(JSON.parse(readFileSync(receipt)), current)) throw new Error('Missing or stale local receipt. Run verify again.');
    return current;
  };
  if (args[0] === 'gate') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH));
    const repo = process.env.GITHUB_REPOSITORY;
    const owner = repo.split('/')[0];
    let head, base;
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      head = event.pull_request.head.sha;
      base = event.pull_request.base.sha;
      if (event.pull_request.head.repo.full_name !== repo) throw new Error('External PR: use remote CI mode.');
      if (git(['rev-parse', 'origin/main']) !== base) throw new Error('Base advanced: refresh and validate locally.');
    } else if (process.env.GITHUB_EVENT_NAME === 'push') {
      base = event.before;
      const merged = api(`repos/${repo}/commits/${process.env.GITHUB_SHA}/pulls`).filter(p => p.merge_commit_sha === process.env.GITHUB_SHA && p.base.ref === 'main');
      if (merged.length !== 1) throw new Error('Local mode requires a validated PR merge; direct pushes use remote mode.');
      head = merged[0].head.sha;
    } else throw new Error('Manual verification must run in remote mode.');
    const tree = git(['rev-parse', 'HEAD^{tree}']);
    const statuses = api(`repos/${repo}/commits/${head}/status?per_page=100`).statuses;
    if (!accept(statuses, { owner, base, tree })) throw new Error('No owner-issued local validation for this exact head/tree/base. Refresh local evidence or disable local mode to run remote CI.');
    writeFileSync(process.env.GITHUB_OUTPUT, 'skip=true\n', { flag: 'a' });
    console.log('Accepted local software/overlay evidence. Docker, release and deployment health are separate gates.');
    return;
  }
  if (args[0] === 'verify') {
    rmSync(receipt, { force: true });
    command('git', ['fetch', '--no-tags', 'origin', 'main'], true);
    const before = snapshot();
    command('pnpm', ['install', '--frozen-lockfile'], true);
    command('pnpm', ['verify'], true);
    if (!same(before, snapshot())) throw new Error('Revision/environment changed during checks; no receipt issued.');
    writeFileSync(receipt, JSON.stringify({ ...before, finished: new Date().toISOString(), coverage: 'software; excludes Docker and platform packaging' }, null, 2));
    console.log(`Local receipt saved for ${before.head}. Changes to head, tree, base or runtime invalidate it.`);
    return;
  }
  if (args[0] === 'status') { console.log(JSON.stringify(checked(), null, 2)); return; }
  if (args[0] === 'attest') {
    const repo = command('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
    const login = api('user').login;
    if (login !== repo.split('/')[0]) throw new Error('Only the repository owner may issue evidence.');
    command('git', ['fetch', '--no-tags', 'origin', 'main'], true);
    const result = checked();
    const branch = git(['branch', '--show-current']);
    if (!branch || branch === 'main') throw new Error('Use an isolated feature branch and a draft PR.');
    const prs = JSON.parse(command('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'isDraft,headRefOid,baseRefName']));
    if (prs.length !== 1 || !prs[0].isDraft || prs[0].headRefOid !== result.head || prs[0].baseRefName !== 'main') throw new Error('Push this exact head to one draft PR targeting main before attesting.');
    command('gh', ['api', '--method', 'POST', `repos/${repo}/statuses/${result.head}`,
      '-f', 'state=success', '-f', `context=${CONTEXT}`, '-f', `description=base=${result.base} tree=${result.tree}`], true);
    console.log('Recorded truthful local evidence. Ready triggers still run remote CI unless LOCAL_SOFTWARE_MODE is explicitly enabled.');
    return;
  }
  throw new Error('Usage: node scripts/local-validation.mjs verify|status|attest|gate');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
