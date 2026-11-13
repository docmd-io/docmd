/**
 * --------------------------------------------------------------------
 * docmd : the zero-config documentation engine.
 *
 * Doctor command & diagnostic health check contract.
 * Tests docmd doctor, config auto-discovery, --json report output,
 * navigation integrity checks, and plugin health check hooks.
 * --------------------------------------------------------------------
 */

import {
  DOCMD,
  setup,
  writeFile,
  exitCodeOf,
  runTestFile
} from '../shared.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) {
    failed++;
    failures.push(message);
    console.log(`    ❌ ${message}`);
  } else {
    passed++;
    console.log(`    ✅ ${message}`);
  }
}

export const test = runTestFile({
  name: 'Doctor Pre-Flight Diagnostics Contract',
  emoji: '🩺',
  run: async () => {

    // 1. Zero-config project: doctor succeeds and identifies zero-config mode
    {
      const dir = setup('doctor-zero-config');
      writeFile(dir, 'docs/index.md', '# Welcome\n');
      const out = execFileSync(process.execPath, [DOCMD, 'doctor', '--json'], { cwd: dir, encoding: 'utf8' });
      const report = JSON.parse(out);

      assert(report.environment && report.environment.node, 'DOCTOR-1: environment node version detected');
      assert(report.environment.packageManager, 'DOCTOR-1: packageManager detected');
      assert(report.project.documentCount >= 1, 'DOCTOR-1: documentCount >= 1');
      assert(report.project.configStatus === 'warn', 'DOCTOR-1: zero-config emits warn status for config');
      assert(report.core.status === 'ok', 'DOCTOR-1: core package resolved');
    }

    // 2. Config auto-discovery and plugin diagnostics hook
    {
      const dir = setup('doctor-config-and-plugins');
      writeFile(dir, 'docs/index.md', '# Welcome\n');
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'Doctor Test Site',
        url: 'https://docs.example.com',
        plugins: {
          seo: {}
        }
      }));

      const out = execFileSync(process.execPath, [DOCMD, 'doctor', '--json'], { cwd: dir, encoding: 'utf8' });
      const report = JSON.parse(out);

      assert(report.project.configPath === 'docmd.config.json', 'DOCTOR-2: auto-discovers docmd.config.json');
      assert(report.project.configStatus === 'ok', 'DOCTOR-2: valid config has status ok');
      assert(report.pluginDiagnostics && report.pluginDiagnostics.seo, 'DOCTOR-2: plugin onDoctorCheck hook invoked');
      
      const seoChecks = report.pluginDiagnostics.seo || [];
      const canonicalCheck = seoChecks.find(c => c.name.includes('SEO Site URL') || c.name.includes('Canonical'));
      assert(canonicalCheck && canonicalCheck.status === 'ok', 'DOCTOR-2: seo onDoctorCheck verifies canonical URL');
    }

    // 3. Navigation target integrity check
    {
      const dir = setup('doctor-navigation-check');
      writeFile(dir, 'docs/index.md', '# Welcome\n');
      writeFile(dir, 'docmd.config.json', JSON.stringify({
        title: 'Broken Nav Test',
        navigation: [
          { title: 'Home', path: 'index.md' },
          { title: 'Missing Page', path: 'guide/nonexistent-page.md' }
        ]
      }));

      const out = execFileSync(process.execPath, [DOCMD, 'doctor', '--json'], { cwd: dir, encoding: 'utf8' });
      const report = JSON.parse(out);

      const navIssue = report.project.diagnostics.find(d => d.name === 'Navigation Target');
      assert(navIssue && navIssue.status === 'warn', 'DOCTOR-3: missing navigation file detected as warning');
      assert(navIssue && navIssue.message.includes('nonexistent-page'), 'DOCTOR-3: diagnostic specifies missing file path');
    }

    // 4. Human-readable terminal output formatting
    {
      const dir = setup('doctor-terminal-output');
      writeFile(dir, 'docs/index.md', '# Terminal\n');
      const text = execFileSync(process.execPath, [DOCMD, 'doctor'], { cwd: dir, encoding: 'utf8' });

      assert(text.toUpperCase().includes('PRE-FLIGHT DIAGNOSTICS'), 'DOCTOR-4: section header present in terminal output');
      assert(text.toUpperCase().includes('ENVIRONMENT'), 'DOCTOR-4: environment group present');
      assert(text.toUpperCase().includes('PROJECT & CONTENT'), 'DOCTOR-4: project & content group present');
    }
  }
});

export const results = {
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return [...failures]; }
};
