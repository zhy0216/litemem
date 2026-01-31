/**
 * Verify benchmark setup
 *
 * Usage: bun run benchmark/verify.ts
 */

import { existsSync, readFileSync } from 'fs';
import { LiteMemory, createDefaultConfig } from '../src';
import { loadLocomoData, getDatasetStats } from './convert';

async function verify(): Promise<void> {
  const checks: Array<{ name: string; pass: boolean; message?: string }> = [];

  // 1. Check config file
  const configPath = 'benchmark/config.json';
  let config: any = null;
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
      checks.push({ name: 'Config loaded', pass: true });
    } catch (err) {
      checks.push({
        name: 'Config loaded',
        pass: false,
        message: `Invalid JSON: ${err}`,
      });
    }
  } else {
    checks.push({
      name: 'Config loaded',
      pass: false,
      message: 'benchmark/config.json not found. Copy from src/config.example.json',
    });
  }

  // 2. Check LoCoMo data
  const dataPath = 'benchmark/locomo/data/locomo10.json';
  if (existsSync(dataPath)) {
    try {
      const data = loadLocomoData(dataPath);
      const stats = getDatasetStats(data);
      checks.push({
        name: 'LoCoMo data found',
        pass: true,
        message: `${stats.conversations} conversations, ${stats.totalQA} QA pairs`,
      });
    } catch (err) {
      checks.push({
        name: 'LoCoMo data found',
        pass: false,
        message: `Error parsing: ${err}`,
      });
    }
  } else {
    checks.push({
      name: 'LoCoMo data found',
      pass: false,
      message: 'Run: git clone https://github.com/snap-research/locomo.git benchmark/locomo',
    });
  }

  // Skip remaining checks if config missing
  if (!config) {
    printResults(checks);
    return;
  }

  // 3. Initialize LiteMemory
  try {
    const liteMem = new LiteMemory(
      createDefaultConfig({
        ...config,
        turso: { url: 'file:./benchmark/verify_test.db' },
      })
    );
    await liteMem.initialize();
    checks.push({ name: 'LiteMemory initialized', pass: true });

    // 4. Test database
    const count = await liteMem.getMemoryCount();
    checks.push({
      name: 'Database connection OK',
      pass: true,
      message: `${count} existing memories`,
    });

    // 5. Test LLM (simple call)
    try {
      // @ts-ignore - accessing internal for test
      const llmManager = liteMem['llmManager'];
      const result = await llmManager.generateResponse([
        { role: 'user', content: 'Reply with just the word "OK"' },
      ]);
      if (result.response.toLowerCase().includes('ok')) {
        checks.push({ name: 'LLM connection OK', pass: true });
      } else {
        checks.push({
          name: 'LLM connection OK',
          pass: false,
          message: `Unexpected response: ${result.response}`,
        });
      }
    } catch (err) {
      checks.push({
        name: 'LLM connection OK',
        pass: false,
        message: `${err}`,
      });
    }

    // 6. Test embedder
    try {
      // @ts-ignore - accessing internal for test
      const embedder = liteMem['embedder'];
      const embedding = await embedder.embed('test');
      if (Array.isArray(embedding) && embedding.length > 0) {
        checks.push({
          name: 'Embedder connection OK',
          pass: true,
          message: `${embedding.length} dimensions`,
        });
      } else {
        checks.push({
          name: 'Embedder connection OK',
          pass: false,
          message: 'Empty embedding returned',
        });
      }
    } catch (err) {
      checks.push({
        name: 'Embedder connection OK',
        pass: false,
        message: `${err}`,
      });
    }

    await liteMem.close();

    // Cleanup test db
    const { unlinkSync } = await import('fs');
    try {
      unlinkSync('benchmark/verify_test.db');
    } catch {}
  } catch (err) {
    checks.push({
      name: 'LiteMemory initialized',
      pass: false,
      message: `${err}`,
    });
  }

  printResults(checks);
}

function printResults(
  checks: Array<{ name: string; pass: boolean; message?: string }>
): void {
  console.log('\nBenchmark Setup Verification');
  console.log('────────────────────────────────────────────────');

  let allPass = true;
  for (const check of checks) {
    const icon = check.pass ? '[✓]' : '[✗]';
    const msg = check.message ? ` (${check.message})` : '';
    console.log(`${icon} ${check.name}${msg}`);
    if (!check.pass) allPass = false;
  }

  console.log('────────────────────────────────────────────────');
  if (allPass) {
    console.log('Ready to run benchmark!');
    console.log('\nRun: bun run benchmark/run.ts');
  } else {
    console.log('Fix the issues above before running benchmark.');
  }
}

verify().catch(console.error);
