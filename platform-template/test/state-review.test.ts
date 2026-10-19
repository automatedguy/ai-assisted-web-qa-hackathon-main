import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { requestFindings } from '../src/agents/model-check.js';
import { executeWithRenderedChecks } from '../src/agents/rendered-checks.js';
import { linksAgent } from '../src/agents/links.js';
import type { AgentContext, Agent } from '../src/agents/types.js';

test('state and semantic-link reviews validate element ownership, destination quotes and retained findings', async t => {
  let mode = 'valid';
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); const input = JSON.parse(body.input);
    const item = input.observations?.[0]; const link = input.links?.[0];
    const issues = mode === 'clean' ? [] : [{ element_id: mode === 'wrong-element' ? 'nonexistent' : item?.id ?? link?.id ?? 'first',
      severity: 'minor', description: 'The observed copy conflicts with its intended meaning.',
      evidence: mode === 'wrong-quote' ? 'Invented quote' : item?.text ?? link?.link.text ?? 'Rendered only',
      expected: 'Correct localized copy', suggested_fix: 'Correct localized copy', confidence: 0.9,
      ...(link ? { destination_evidence: mode === 'wrong-destination' ? 'Invented destination' : link.destination.text } : {}),
    }];
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'mock', object: 'response', model: 'mock', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [
      { type: 'output_text', text: JSON.stringify({ issues }), annotations: [] },
    ] }], usage: { input_tokens: 30, output_tokens: 20 } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address === 'object');
  const previous = { key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL };
  process.env.OPENAI_API_KEY = 'mock'; process.env.OPENAI_BASE_URL = `http://127.0.0.1:${address.port}`;
  const context = (): AgentContext => {
    const page = { url: 'https://example.test/', status: 200, title: 'Test', language: 'fr', text: 'Initial static content', links: [], images: [], tracks: [], videos: [],
      rendered: { status: 'completed' as const, states: 2, resources: [], limitations: [], observations: [
        { id: 'first', selector: '#counter', text: 'Rendered only', tag: 'p', context: '', reproduction: { viewport: {width:390,height:844}, steps: [{action:'click' as const,selector:'#menu'}] } },
      ] } };
    return { page, crawl: { startUrl:page.url, pages:[page], responses:[], errors:[],limitReached:false }, profile: {locale:{target_locale:'fr-FR'}}, model:'mock',
      report: {id:'test',agent:'locale',categories:['locale_rules'],status:'running',attempts:0,durationMs:0,issueCount:0,inputTokens:0,outputTokens:0,estimatedCostUsd:null,usageComplete:true} };
  };
  try {
    await t.test('new evidence can come from a captured state but never another element or invented text', async () => {
      const ctx = context(); mode = 'valid';
      const result = await requestFindings(ctx, { name:'state',instructions:'Test',input:{},evidenceItems:{first:'Rendered only'} });
      assert.equal(result.length,1);
      for (const invalid of ['wrong-element','wrong-quote']) {
        mode = invalid;
        await assert.rejects(requestFindings(ctx,{name:'state',instructions:'Test',input:{},evidenceItems:{first:'Rendered only'}}));
      }
      assert.equal(ctx.report.modelCalls,3);
    });
    await t.test('rendered checks stay in the existing Locale agent and retain replay metadata', async () => {
      mode = 'valid'; const ctx = context();
      const agent: Agent = {id:'locale',categories:['locale_rules'],scope:'page',execute:async()=>[]};
      const issues = await executeWithRenderedChecks(agent,ctx);
      assert.equal(issues[0].category,'locale_rules'); assert.equal(issues[0].location.selector_or_xpath,'#counter');
      assert.equal(issues[0].reproduction?.viewport.width,390); assert.equal(issues[0].reproduction?.steps[0].selector,'#menu');
      mode = 'clean'; assert.deepEqual(await executeWithRenderedChecks(agent,context()),[]);
    });
    await t.test('semantic links require paired destination evidence and preserve deterministic failures', async () => {
      const ctx = context();
      ctx.page!.links = [{text:'View plan table',href:'https://example.test/#products',selector:'#semantic'}, {text:'Missing',href:'https://example.test/missing',selector:'#broken'}];
      ctx.page!.sections = {products:'Device descriptions',plans:'Plan comparison table'};
      ctx.crawl.responses = [{url:ctx.page!.url,status:200,contentType:'text/html'},{url:'https://example.test/missing',status:404,contentType:'text/html'}];
      mode = 'valid'; const issues = await linksAgent.execute(ctx);
      assert.equal(issues.length,2); assert.match(issues[1].evidence,/Destination content: Device descriptions/);
      mode = 'wrong-destination';
      await assert.rejects(linksAgent.execute(ctx), (error: any) => error.message.includes('destination') && error.issues.length === 1 && error.issues[0].assessment.method === 'deterministic');
    });
  } finally {
    if (previous.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous.key;
    if (previous.base === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = previous.base;
    await new Promise<void>(resolve => server.close(()=>resolve()));
  }
});
