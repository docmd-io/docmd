import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  parseRemoteUrl,
  buildRemoteUrls,
  getEditUrl,
  getBlobUrl,
  getHistoryUrl,
  getCommitUrl,
  resolveGitAuth,
  createCredentialHelper,
  getAuthArgs,
  sanitizeGitUrl,
  createGitClient
} from '../src/api.ts';

describe('parseRemoteUrl', () => {
  test('parses github https url with .git suffix', () => {
    const res = parseRemoteUrl('https://github.com/docmd-io/docmd.git');
    assert.equal(res.provider, 'github');
    assert.equal(res.hostname, 'github.com');
    assert.equal(res.owner, 'docmd-io');
    assert.equal(res.repo, 'docmd');
    assert.equal(res.fullPath, 'docmd-io/docmd');
    assert.equal(res.isHttps, true);
    assert.equal(res.isSsh, false);
  });

  test('parses github ssh url (scp format)', () => {
    const res = parseRemoteUrl('git@github.com:docmd-io/docmd.git');
    assert.equal(res.provider, 'github');
    assert.equal(res.hostname, 'github.com');
    assert.equal(res.owner, 'docmd-io');
    assert.equal(res.repo, 'docmd');
    assert.equal(res.fullPath, 'docmd-io/docmd');
    assert.equal(res.isSsh, true);
    assert.equal(res.isHttps, false);
  });

  test('parses gitlab nested subgroup url', () => {
    const res = parseRemoteUrl('https://gitlab.com/enterprise/tools/docs/project.git');
    assert.equal(res.provider, 'gitlab');
    assert.equal(res.hostname, 'gitlab.com');
    assert.equal(res.owner, 'enterprise/tools/docs');
    assert.equal(res.repo, 'project');
    assert.equal(res.fullPath, 'enterprise/tools/docs/project');
  });

  test('parses self-hosted gitlab instance', () => {
    const res = parseRemoteUrl('git@gitlab.internal.corp:engineering/core.git');
    assert.equal(res.provider, 'gitlab');
    assert.equal(res.hostname, 'gitlab.internal.corp');
    assert.equal(res.owner, 'engineering');
    assert.equal(res.repo, 'core');
  });

  test('parses bitbucket url', () => {
    const res = parseRemoteUrl('https://bitbucket.org/team/docs-portal.git');
    assert.equal(res.provider, 'bitbucket');
    assert.equal(res.hostname, 'bitbucket.org');
    assert.equal(res.owner, 'team');
    assert.equal(res.repo, 'docs-portal');
  });

  test('parses generic git url', () => {
    const res = parseRemoteUrl('ssh://git@code.custom-vcs.com:2222/org/repo.git');
    assert.equal(res.provider, 'generic');
    assert.equal(res.hostname, 'code.custom-vcs.com');
    assert.equal(res.repo, 'repo');
  });
});

describe('remote link URL generation', () => {
  test('generates github edit, blob, history, and commit URLs', () => {
    const remote = parseRemoteUrl('https://github.com/docmd-io/docmd');
    const urls = buildRemoteUrls(remote, 'docs/guide.md', { branch: 'main' });

    assert.equal(urls.editUrl, 'https://github.com/docmd-io/docmd/edit/main/docs/guide.md');
    assert.equal(urls.blobUrl, 'https://github.com/docmd-io/docmd/blob/main/docs/guide.md');
    assert.equal(urls.historyUrl, 'https://github.com/docmd-io/docmd/commits/main/docs/guide.md');
    assert.equal(urls.commitUrl('abc1234'), 'https://github.com/docmd-io/docmd/commit/abc1234');
  });

  test('generates gitlab edit, blob, and history URLs with /-/ syntax', () => {
    const remote = parseRemoteUrl('https://gitlab.com/acme/infra/docs');
    const urls = buildRemoteUrls(remote, 'src/api.md', { branch: 'v2' });

    assert.equal(urls.editUrl, 'https://gitlab.com/acme/infra/docs/-/edit/v2/src/api.md');
    assert.equal(urls.blobUrl, 'https://gitlab.com/acme/infra/docs/-/blob/v2/src/api.md');
    assert.equal(urls.historyUrl, 'https://gitlab.com/acme/infra/docs/-/commits/v2/src/api.md');
    assert.equal(urls.commitUrl('fedcba9'), 'https://gitlab.com/acme/infra/docs/-/commit/fedcba9');
  });

  test('generates bitbucket edit and history URLs', () => {
    const remote = parseRemoteUrl('https://bitbucket.org/team/repo');
    const urls = buildRemoteUrls(remote, 'index.md', { branch: 'master' });

    assert.equal(urls.editUrl, 'https://bitbucket.org/team/repo/src/master/index.md?mode=edit');
    assert.equal(urls.blobUrl, 'https://bitbucket.org/team/repo/src/master/index.md');
    assert.equal(urls.historyUrl, 'https://bitbucket.org/team/repo/history-node/master/index.md');
  });

  test('convenience getters work directly with string URLs', () => {
    const edit = getEditUrl('https://github.com/foo/bar', 'page.md', { branch: 'main' });
    assert.equal(edit, 'https://github.com/foo/bar/edit/main/page.md');

    const blob = getBlobUrl('https://github.com/foo/bar', 'page.md', { branch: 'main' });
    assert.equal(blob, 'https://github.com/foo/bar/blob/main/page.md');

    const history = getHistoryUrl('https://github.com/foo/bar', 'page.md', { branch: 'main' });
    assert.equal(history, 'https://github.com/foo/bar/commits/main/page.md');

    const commit = getCommitUrl('https://github.com/foo/bar', 'a1b2c3d');
    assert.equal(commit, 'https://github.com/foo/bar/commit/a1b2c3d');
  });
});

describe('resolveGitAuth and credential helpers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.DOCMD_GIT_TOKEN;
    delete process.env.DOCMD_THREADS_GIT_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITLAB_TOKEN;
    delete process.env.GL_TOKEN;
    delete process.env.GIT_TOKEN;
  });

  after(() => {
    process.env = originalEnv;
  });

  test('prefers explicit token from options', () => {
    process.env.DOCMD_GIT_TOKEN = 'env-token';
    const auth = resolveGitAuth({ token: 'opt-token', provider: 'github' });
    assert.equal(auth.token, 'opt-token');
    assert.equal(auth.username, 'x-access-token');
    assert.equal(auth.source, 'options');
  });

  test('resolves DOCMD_GIT_TOKEN', () => {
    process.env.DOCMD_GIT_TOKEN = 'secret-docmd-token';
    const auth = resolveGitAuth({ provider: 'github' });
    assert.equal(auth.token, 'secret-docmd-token');
    assert.equal(auth.envVar, 'DOCMD_GIT_TOKEN');
    assert.equal(auth.source, 'env');
  });

  test('resolves GITHUB_TOKEN for github provider', () => {
    process.env.GITHUB_TOKEN = 'ghp_xyz';
    const auth = resolveGitAuth({ provider: 'github' });
    assert.equal(auth.token, 'ghp_xyz');
    assert.equal(auth.username, 'x-access-token');
    assert.equal(auth.envVar, 'GITHUB_TOKEN');
  });

  test('resolves GITLAB_TOKEN with oauth2 default username', () => {
    process.env.GITLAB_TOKEN = 'glpat_123';
    const auth = resolveGitAuth({ provider: 'gitlab' });
    assert.equal(auth.token, 'glpat_123');
    assert.equal(auth.username, 'oauth2');
    assert.equal(auth.envVar, 'GITLAB_TOKEN');
  });

  test('createCredentialHelper produces secure subshell helper', () => {
    const helper = createCredentialHelper('MY_VAR', 'my-user');
    assert.equal(helper, '!f(){ echo username=my-user; echo "password=$MY_VAR"; }; f');
  });

  test('getAuthArgs produces git credential options', () => {
    const args = getAuthArgs('TOKEN_VAR', 'x-access-token');
    assert.deepEqual(args, [
      '-c',
      'credential.helper=',
      '-c',
      'credential.helper=!f(){ echo username=x-access-token; echo "password=$TOKEN_VAR"; }; f'
    ]);
  });

  test('sanitizeGitUrl masks credentials in URLs', () => {
    assert.equal(sanitizeGitUrl('https://user:password@github.com/repo.git'), 'https://***@github.com/repo.git');
    assert.equal(sanitizeGitUrl('https://token@github.com/repo.git'), 'https://***@github.com/repo.git');
    assert.equal(sanitizeGitUrl('https://github.com/repo.git'), 'https://github.com/repo.git');
  });
});

describe('createGitClient local repo operations', () => {
  let tmpDir: string;
  const runGit = (args: string[]) => {
    return execFileSync('git', args, {
      cwd: tmpDir,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
    });
  };

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docmd-git-test-'));
    runGit(['init', '-b', 'main']);
    runGit(['config', 'user.name', 'Docmd Tester']);
    runGit(['config', 'user.email', 'test@docmd.invalid']);
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  test('inspects repository properties', async () => {
    const client = createGitClient({ cwd: tmpDir });
    assert.equal(await client.isInstalled(), true);
    assert.equal(await client.isRepository(), true);
    const root = await client.getRoot();
    assert.equal(path.resolve(root), fs.realpathSync(tmpDir));
  });

  test('tracks staged and untracked files', async () => {
    const client = createGitClient({ cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'hello');
    fs.writeFileSync(path.join(tmpDir, 'file2.txt'), 'world');

    let status = await client.getStatus();
    assert.equal(status.clean, false);
    assert.equal(status.untracked.includes('file1.txt'), true);

    await client.stage('file1.txt');
    status = await client.getStatus();
    assert.equal(status.staged.includes('file1.txt'), true);
    assert.equal(status.untracked.includes('file2.txt'), true);

    const hash = await client.commit('Initial commit', {
      author: { name: 'Alice Author', email: 'alice@example.com' },
      committer: { name: 'Bot Committer', email: 'bot@example.com' }
    });
    assert.match(hash, /^[0-9a-f]{40}$/);

    const log = await client.getLog({ maxCommits: 1 });
    assert.equal(log.length, 1);
    assert.equal(log[0].author, 'Alice Author');
    assert.equal(log[0].email, 'alice@example.com');
    assert.equal(log[0].message, 'Initial commit');
  });

  test('validates remotes and branches against command line injection', async () => {
    const client = createGitClient({ cwd: tmpDir });
    await assert.rejects(async () => {
      await client.fetch('--upload-pack=touch /tmp/bad', 'main');
    }, /Invalid git remote/);

    await assert.rejects(async () => {
      await client.fetch('origin', '-b');
    }, /Invalid git branch/);

    await assert.rejects(async () => {
      await client.push('origin', '--force-with-lease');
    }, /Invalid git branch/);
  });
});
