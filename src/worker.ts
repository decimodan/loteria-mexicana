import { handle } from '@astrojs/cloudflare/handler';
import { DurableObject } from 'cloudflare:workers';

export class DeckRoom extends DurableObject {
	async fetch(request: Request) {
		if (request.method === 'GET') {
			const state = await this.ctx.storage.get('deck-state');
			if (!state) return new Response(null, { status: 404 });
			return Response.json(state);
		}

		if (request.method === 'PUT') {
			const state = await request.json();
			await this.ctx.storage.put('deck-state', state);
			return Response.json(state);
		}

		return new Response('Method Not Allowed', { status: 405 });
	}
}

export default {
	async fetch(request, env, ctx) {
		if (new URL(request.url).pathname === '/api/deck') {
			const room = env.DECK_ROOM.get(env.DECK_ROOM.idFromName('shared-deck'));
			return room.fetch(request);
		}

		return handle(request, env, ctx);
	}
} satisfies ExportedHandler;
