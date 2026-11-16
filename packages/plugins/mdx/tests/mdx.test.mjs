import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onBeforeParse } from '../dist/index.js';

test('MDX plugin: preserves docmd.config.json and JS code blocks in standard .md files', () => {
  const input = `# Setup Guide

Configure your docmd setup below:

\`\`\`json "docmd.config.json"
{
  "navigation": [
    { "title": "Home", "path": "/", "icon": "home" }
  ]
}
\`\`\`

\`\`\`javascript "docmd.config.js"
module.exports = {
  title: "My Site"
};
\`\`\`
`;

  const output = onBeforeParse(input, {}, 'theming/icons.md');
  assert.equal(output, input);
});

test('MDX plugin: preserves code blocks even when page contains JSX components', () => {
  const input = `# Features

<Tag text="New" variant="success" />

\`\`\`json "docmd.config.json"
{
  "plugins": {
    "iconify": {
      "enabled": true
    }
  }
}
\`\`\`
`;

  const output = onBeforeParse(input, {}, 'plugins/overview.md');
  assert.ok(output.includes('docmd-tag'));
  assert.ok(output.includes('New'));
  assert.ok(output.includes('"plugins": {'));
  assert.ok(output.includes('"iconify": {'));
  assert.ok(output.includes('"enabled": true'));
});

test('MDX plugin: handles .mdx files with code blocks and text expressions', () => {
  const input = `# Welcome {frontmatter.title}

\`\`\`json "docmd.config.json"
{
  "title": "Config"
}
\`\`\`
`;

  const output = onBeforeParse(input, { title: 'Docmd' }, 'page.mdx');
  assert.ok(output.includes('# Welcome Docmd'));
  assert.ok(output.includes('"title": "Config"'));
});
