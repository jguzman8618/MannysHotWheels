import { useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  API_BASE,
  ClientTile,
  GameState,
  buyTile,
  getState,
  harvestTile,
  login,
  loginWithDiscord,
  plantTile,
  sellTile,
} from './api';
import { authenticateWithDiscord, isInsideDiscord } from './discord';

// The server only recalculates and broadcasts a tile's `ready` flag when
// another action (buy/plant/sell/harvest) happens to it — it doesn't push
// updates on a timer. So we recompute readiness ourselves on every render
// using the crop's grow time, rather than trusting that stale snapshot.
function isTileReady(tile: ClientTile | undefined, state: GameState): boolean {
  if (!tile || !tile.cropType || !tile.plantedAt) return false;
  const cfg = state.crops[tile.cropType];
  if (!cfg) return false;
  return Date.now() - tile.plantedAt >= cfg.growTimeMs;
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('ef_token'));
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ClientTile | null>(null);
  const [, setTick] = useState(0);
  const inDiscord = useMemo(() => isInsideDiscord(), []);
  const [discordAuthing, setDiscordAuthing] = useState(inDiscord);

  // Running inside the Discord Activity iframe: authenticate with
  // Discord automatically, no username screen needed.
  useEffect(() => {
    if (!inDiscord || token) return;
    authenticateWithDiscord()
      .then(({ discordAccessToken }) => loginWithDiscord(discordAccessToken))
      .then(({ token: t }) => {
        localStorage.setItem('ef_token', t);
        setToken(t);
      })
      .catch((e) => setError(e.message))
      .finally(() => setDiscordAuthing(false));
  }, [inDiscord, token]);

  // re-render every second so "ready in Ns" countdowns stay live
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // load state once we have a token
  useEffect(() => {
    if (!token) return;
    getState(token)
      .then(setState)
      .catch((e) => {
        setError(e.message);
        setToken(null);
        localStorage.removeItem('ef_token');
      });
  }, [token]);

  // live tile updates from other players (and our own actions)
  useEffect(() => {
    if (!token) return;
    const socket: Socket = io(API_BASE || undefined);
    socket.on('tileUpdate', (tile: ClientTile) => {
      setState((prev) => {
        if (!prev) return prev;
        const tiles = prev.tiles.map((t) => (t.x === tile.x && t.y === tile.y ? tile : t));
        return { ...prev, tiles };
      });
    });
    return () => {
      socket.disconnect();
    };
  }, [token]);

  const tileMap = useMemo(() => {
    const m = new Map<string, ClientTile>();
    state?.tiles.forEach((t) => m.set(`${t.x},${t.y}`, t));
    return m;
  }, [state]);

  async function refresh() {
    if (!token) return;
    const s = await getState(token);
    setState(s);
  }

  async function handleTileClick(x: number, y: number) {
    if (!token || !state) return;
    const tile = tileMap.get(`${x},${y}`);
    setError(null);
    try {
      if (!tile || !tile.ownerId) {
        await buyTile(token, x, y);
        await refresh();
        return;
      }
      if (tile.ownerId !== state.player.id) return; // someone else's land
      if (isTileReady(tile, state)) {
        await harvestTile(token, x, y);
        await refresh();
        return;
      }
      setSelected(tile); // owned, not ready yet: plant (if empty) and/or sell
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handlePlant(cropId: string) {
    if (!token || !selected) return;
    setError(null);
    try {
      await plantTile(token, selected.x, selected.y, cropId);
      setSelected(null);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function handleLogout() {
    localStorage.removeItem('ef_token');
    setToken(null);
    setState(null);
    setError(null);
  }

  async function handleSell() {
    if (!token || !selected) return;
    setError(null);
    try {
      await sellTile(token, selected.x, selected.y);
      setSelected(null);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (!token || !state) {
    if (inDiscord) {
      return (
        <div className="login-screen">
          <h1>Extreme Frontier</h1>
          <p>{discordAuthing ? 'Signing you in with Discord…' : 'Loading…'}</p>
          {error && <div className="error-banner">{error}</div>}
        </div>
      );
    }
    return <LoginScreen onLoggedIn={(t) => { localStorage.setItem('ef_token', t); setToken(t); }} error={error} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Extreme Frontier</h1>
        <div className="stats">
          <span>{state.player.username}</span>
          <span className="money">${state.player.money}</span>
          {!inDiscord && (
            <button className="logout" onClick={handleLogout}>Log out</button>
          )}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="grid" style={{ gridTemplateColumns: `repeat(${state.mapSize}, 32px)` }}>
        {Array.from({ length: state.mapSize }).map((_, y) =>
          Array.from({ length: state.mapSize }).map((_, x) => {
            const tile = tileMap.get(`${x},${y}`);
            const mine = tile?.ownerId === state.player.id;
            const owned = !!tile?.ownerId;
            const ready = isTileReady(tile, state);
            const cls = [
              'tile',
              !owned && 'tile-empty',
              owned && !mine && 'tile-other',
              mine && !tile?.cropType && 'tile-mine',
              mine && tile?.cropType && !ready && 'tile-growing',
              mine && ready && 'tile-ready',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={`${x},${y}`}
                className={cls}
                title={tileTitle(tile, state)}
                onClick={() => handleTileClick(x, y)}
              />
            );
          })
        )}
      </div>

      <div className="legend">
        <span><i className="tile tile-empty" /> unclaimed (${state.tilePrice} to buy)</span>
        <span><i className="tile tile-mine" /> yours, empty</span>
        <span><i className="tile tile-growing" /> growing</span>
        <span><i className="tile tile-ready" /> ready to harvest</span>
        <span><i className="tile tile-other" /> someone else's</span>
      </div>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Manage this tile</h3>
            {!selected.cropType && Object.values(state.crops).map((c) => (
              <button
                key={c.id}
                className="crop-option"
                disabled={state.player.money < c.seedCost}
                onClick={() => handlePlant(c.id)}
              >
                {c.name} — ${c.seedCost} seed, grows {Math.round(c.growTimeMs / 1000)}s,
                sells for ${c.yieldAmount * c.sellPrice}
              </button>
            ))}
            {selected.cropType && (
              <p className="modal-note">
                {state.crops[selected.cropType].name} is still growing — selling this tile now
                will lose the crop.
              </p>
            )}
            <button className="sell-option" onClick={handleSell}>
              Sell land back for ${Math.floor(state.tilePrice * 0.5)}
            </button>
            <button className="cancel" onClick={() => setSelected(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function tileTitle(tile: ClientTile | undefined, state: GameState): string {
  if (!tile || !tile.ownerId) return `Empty — click to buy for $${state.tilePrice}`;
  if (tile.ownerId !== state.player.id) return "Someone else's land";
  if (!tile.cropType) return 'Your land — click to plant';
  if (isTileReady(tile, state)) return 'Ready — click to harvest';
  const cfg = state.crops[tile.cropType];
  const remainingMs = cfg.growTimeMs - (Date.now() - (tile.plantedAt ?? 0));
  return `Growing ${cfg.name} — ready in ${Math.max(0, Math.ceil(remainingMs / 1000))}s`;
}

function LoginScreen({ onLoggedIn, error }: { onLoggedIn: (token: string) => void; error: string | null }) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setLocalError(null);
    try {
      const { token } = await login(username);
      onLoggedIn(token);
    } catch (e: any) {
      setLocalError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <h1>Extreme Frontier</h1>
      <p>Your Land. Your Legacy.</p>
      <input
        placeholder="Pick a username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button disabled={busy || username.trim().length < 2} onClick={submit}>
        {busy ? 'Loading…' : 'Enter the Frontier'}
      </button>
      {(localError || error) && <div className="error-banner">{localError || error}</div>}
    </div>
  );
}
