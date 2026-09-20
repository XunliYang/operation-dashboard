const assert = require('assert');
const path = require('path');

// Mock config.json for testing
const originalReadFileSync = require('fs').readFileSync;
const originalExistsSync = require('fs').existsSync;

function mockConfig(configObj) {
  const fs = require('fs');
  const originalRead = fs.readFileSync;
  const originalExists = fs.existsSync;
  fs.readFileSync = function(p, ...args) {
    if (String(p).endsWith('config.json')) {
      return JSON.stringify(configObj);
    }
    return originalRead.call(fs, p, ...args);
  };
  fs.existsSync = function(p) {
    if (String(p).endsWith('config.json')) return true;
    return originalExists.call(fs, p);
  };
  
  // Also mock dotenv to prevent it from loading .env file
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function(id) {
    if (id === 'dotenv') {
      return { config: () => {} };
    }
    return originalRequire.apply(this, arguments);
  };
  
  return () => {
    fs.readFileSync = originalRead;
    fs.existsSync = originalExists;
    Module.prototype.require = originalRequire;
  };
}

// Clear module cache to reload configLoader with mocked config
function freshRequire() {
  delete require.cache[require.resolve('../src/configLoader')];
  return require('../src/configLoader');
}

// Test 1: Default values when project is absent
{
  const restore = mockConfig({ keywords: ['TestKW'] });
  const cl = freshRequire();
  const proj = cl.getProjectConfig();
  assert.strictEqual(proj.name, 'sentiment-monitor');
  assert.strictEqual(proj.displayName, '舆情监控');
  assert.strictEqual(proj.userAgent, 'SentimentMonitor/1.0');
  assert.strictEqual(proj.timezone, 'Asia/Shanghai');
  assert.strictEqual(proj.emailFrom, 'Monitor <noreply@example.com>');
  restore();
  console.log('PASS: defaults when project absent');
}

// Test 2: Custom project config overrides defaults
{
  const restore = mockConfig({
    project: {
      name: 'my-monitor',
      displayName: 'My Brand',
      userAgent: 'MyBot/2.0',
      timezone: 'US/Eastern',
      defaultKeywords: ['Alpha'],
      emailFrom: 'Bot <bot@test.com>',
      emailSubject: '{displayName} Report {date}',
      reportTitle: '{displayName} Daily',
      discordTitle: '{displayName} Alert {date}',
      pdfFilename: '{name}-daily-{date}.pdf'
    },
    keywords: ['Beta']
  });
  const cl = freshRequire();
  const proj = cl.getProjectConfig();
  assert.strictEqual(proj.name, 'my-monitor');
  assert.strictEqual(proj.displayName, 'My Brand');
  assert.strictEqual(proj.userAgent, 'MyBot/2.0');
  assert.strictEqual(proj.timezone, 'US/Eastern');
  assert.strictEqual(proj.emailFrom, 'Bot <bot@test.com>');
  restore();
  console.log('PASS: custom project config');
}

// Test 3: getKeywords returns config.keywords when present
{
  const savedKeywords = process.env.KEYWORDS;
  delete process.env.KEYWORDS;
  const restore = mockConfig({ keywords: ['KW1', 'KW2'] });
  delete require.cache[require.resolve('../src/configLoader')];
  const cl = require('../src/configLoader');
  const kws = cl.getKeywords();
  assert.deepStrictEqual(kws, ['KW1', 'KW2']);
  restore();
  if (savedKeywords) process.env.KEYWORDS = savedKeywords;
  console.log('PASS: getKeywords from config');
}

// Test 4: getKeywords falls back to project.defaultKeywords
{
  const savedKeywords = process.env.KEYWORDS;
  delete process.env.KEYWORDS;
  const restore = mockConfig({ project: { defaultKeywords: ['Fallback'] } });
  delete require.cache[require.resolve('../src/configLoader')];
  const cl = require('../src/configLoader');
  const kws = cl.getKeywords();
  assert.deepStrictEqual(kws, ['Fallback']);
  restore();
  if (savedKeywords) process.env.KEYWORDS = savedKeywords;
  console.log('PASS: getKeywords fallback');
}

// Test 4.5: getKeywords prioritizes KEYWORDS env var
{
  const savedKeywords = process.env.KEYWORDS;
  process.env.KEYWORDS = 'EnvKW1,EnvKW2';
  const restore = mockConfig({ keywords: ['ConfigKW'] });
  delete require.cache[require.resolve('../src/configLoader')];
  const cl = require('../src/configLoader');
  const kws = cl.getKeywords();
  assert.deepStrictEqual(kws, ['EnvKW1', 'EnvKW2']);
  restore();
  if (savedKeywords) {
    process.env.KEYWORDS = savedKeywords;
  } else {
    delete process.env.KEYWORDS;
  }
  console.log('PASS: getKeywords from env var');
}

// Test 5: renderTemplate
{
  delete require.cache[require.resolve('../src/configLoader')];
  const cl = require('../src/configLoader');
  const result = cl.renderTemplate('{displayName} Report — {date}', { displayName: 'OpenAN', date: '2026-07-03' });
  assert.strictEqual(result, 'OpenAN Report — 2026-07-03');
  console.log('PASS: renderTemplate');
}

// Test 6: buildKeywordMatcher
{
  delete require.cache[require.resolve('../src/configLoader')];
  const cl = require('../src/configLoader');
  const matcher = cl.buildKeywordMatcher('OpenAN');
  assert.strictEqual(matcher('I love OpenAN!'), true);
  assert.strictEqual(matcher('openan is great'), true);
  assert.strictEqual(matcher('OpenANa should not match'), false);
  assert.strictEqual(matcher('not related'), false);
  console.log('PASS: buildKeywordMatcher');
}

// Test 7: buildBroadMatcher with extra patterns
{
  delete require.cache[require.resolve('../src/configLoader')];
  const cl = require('../src/configLoader');
  const matcher = cl.buildBroadMatcher('OpenAN', ['autonomous network', 'agent.to.agent']);
  assert.strictEqual(matcher('OpenAN release'), true);
  assert.strictEqual(matcher('new autonomous network spec'), true);
  assert.strictEqual(matcher('agent-to-agent protocol'), true);
  assert.strictEqual(matcher('unrelated text'), false);
  console.log('PASS: buildBroadMatcher');
}

// Test 8: getKeywordFilter
{
  const restore = mockConfig({
    keywordFilter: {
      OpenAN: { exactPatterns: ['openan'], broadPatterns: ['autonomous network'] }
    }
  });
  const cl = freshRequire();
  const filter = cl.getKeywordFilter('OpenAN');
  assert.deepStrictEqual(filter.exactPatterns, ['openan']);
  assert.deepStrictEqual(filter.broadPatterns, ['autonomous network']);
  const empty = cl.getKeywordFilter('Unknown');
  assert.deepStrictEqual(empty, { exactPatterns: [], broadPatterns: [] });
  restore();
  console.log('PASS: getKeywordFilter');
}

console.log('\nAll configLoader tests passed!');
