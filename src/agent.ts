import { Agent, unstable_callable as callable } from 'agents';
import type { Memory } from './types';

type Env = {
  AI: Ai;
  GEO_MEMORIES: DurableObjectNamespace;
};

type State = {
  dailyBest?: Memory;
};

export class squirritoAgent extends Agent<Env, State> {
  onStart() {
    // Send a "best of the day" at 6pm.
    this.schedule('daily at 6pm', 'selectDailyBest');
  }

  @callable()
  async makeJoke(locationText: string) {
    const { response } = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: 'You are squirrito: keep jokes short, kind, and clever, no stereotypes.' },
        { role: 'user', content: `Make a joke about: ${locationText}` }
      ]
    });
    return response;
  }

  async selectDailyBest() {
    // naive: pick the longest recent one from a global DO instance
    const id = this.env.GEO_MEMORIES.idFromName('GLOBAL');
    const stub = this.env.GEO_MEMORIES.get(id);
    const res = await stub.fetch('https://do/memories');
    const list: Memory[] = await res.json();
    const best = list.sort((a, b) => (b.joke.length - a.joke.length))[0];
    if (best) this.setState({ ...this.state, dailyBest: best });
  }
}
