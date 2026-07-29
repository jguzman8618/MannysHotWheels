// In dev, the client (5173) and server (3001) run separately, so this
// points at the server explicitly via .env.local. In production the
// server serves the built client itself, so requests are same-origin
// and this stays empty (relative paths).
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export interface CropConfig {
  id: string;
  name: string;
  growTimeMs: number;
  yieldAmount: number;
  sellPrice: number;
  seedCost: number;
}

export interface Player {
  id: string;
  username: string;
  money: number;
  created_at: number;
}

export interface ClientTile {
  x: number;
  y: number;
  ownerId: string | null;
  cropType: string | null;
  plantedAt: number | null;
  ready: boolean;
}

export interface GameState {
  player: Player;
  crops: Record<string, CropConfig>;
  mapSize: number;
  tilePrice: number;
  tiles: ClientTile[];
}

async function handle(res: Response) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
}

export async function login(username: string): Promise<{ token: string; player: Player }> {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  return handle(res);
}

export async function loginWithDiscord(discordAccessToken: string): Promise<{ token: string; player: Player }> {
  const res = await fetch(`${API_BASE}/api/login/discord`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: discordAccessToken }),
  });
  return handle(res);
}

export async function getState(token: string): Promise<GameState> {
  const res = await fetch(`${API_BASE}/api/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handle(res);
}

export async function buyTile(token: string, x: number, y: number) {
  return post(token, `/api/tiles/${x}/${y}/buy`);
}

export async function plantTile(token: string, x: number, y: number, cropType: string) {
  return post(token, `/api/tiles/${x}/${y}/plant`, { cropType });
}

export async function harvestTile(token: string, x: number, y: number) {
  return post(token, `/api/tiles/${x}/${y}/harvest`);
}

export async function sellTile(token: string, x: number, y: number) {
  return post(token, `/api/tiles/${x}/${y}/sell`);
}

async function post(token: string, path: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handle(res);
}
