// Minimal example Workflows pipeline
// npx wrangler workflows deploy workflows/squirrito.ts --name squirrito
export default {
  async run(args: { locationText: string }, env: Env) {
    const sys = 'You are squirrito, keep jokes short and kind.';
    const { response } = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `Make a joke about: ${args.locationText}` }
      ]
    });

    const id = env.GEO_MEMORIES.idFromName('GLOBAL');
    const stub = env.GEO_MEMORIES.get(id);
    await stub.fetch('https://do/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'WORKFLOW',
        locationText: args.locationText,
        lat: 0, lng: 0, joke: response
      })
    });

    return { joke: response };
  }
} satisfies Workflow;

interface Env {
  AI: Ai;
  GEO_MEMORIES: DurableObjectNamespace;
}
