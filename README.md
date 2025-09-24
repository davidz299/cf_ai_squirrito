# Squirrito 🐿️

Capture the moment, but with humour!

Meet Squirrito 🐿️, your very human-like squirrel best-friend that makes the best jokes based on where you are and what you are doing, to brighten up your day! Squirrito hoards your memories, instead of nuts.

Squirrito is an AI-powered app on Cloudflare that remembers the location of where jokes were generated and plots them on a map you can share. It is always worth a while down memory lane, but instead of your camera roll, why not a map with all the places you have been and adventures you had, captured in hilarious jokes!

Check out the live deployment at [https://cf_ai_squirrito.davidzhuang29.workers.dev/](https://cf_ai_squirrito.davidzhuang29.workers.dev/).

<img width="1631" height="964" alt="Demo5" src="https://github.com/user-attachments/assets/96caed83-c5fc-4009-b079-92b8af24262a" />

<img width="1611" height="963" alt="Demo1" src="https://github.com/user-attachments/assets/f144c03e-9d55-4c84-aa06-5b2517489ad9" />

<img width="1605" height="964" alt="Demo4" src="https://github.com/user-attachments/assets/63877285-f6bf-41b2-981a-1150808cd9e6" />

This project satisfies all the assignment requirements:

- **LLM**: Uses Workers AI (Llama 3.3) to generate context-aware jokes.
- **Workflow / coordination**: Demonstrates Cloudflare Workflows and Workers, and an Agent with callable methods.
- **User input via chat**: Visually-appealing UI for the user to interact with Squirrito and check out the map of previous jokes and their locations.
- **Memory or state**: Durable Objects.

Live components can be deployed with `wrangler`. You can also run locally as well, see instructions below.

---

## Quick Start for Running Locally

### 1) Prerequisites
- Node 18+
- `npm i wrangler` (or use `npx wrangler`)
- Cloudflare account

### 2) Install
```bash
npm install
```

### 3) Run locally
```bash
npx wrangler dev
```

### 4) Deploy
```bash
npx wrangler deploy
```

---

## Repository Layout

```
cf_ai_squirrito/
├─ src/
│  └─ index.ts                
├─ PROMPTS.md                
├─ wrangler.toml             
├─ package.json              
├─ tsconfig.json
└─ README.md
```
