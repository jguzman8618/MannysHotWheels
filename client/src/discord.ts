import { DiscordSDK } from '@discord/embedded-app-sdk';

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;

// True only when this page is actually loaded inside Discord's Activity
// iframe (Discord adds a frame_id query param). Lets the same build run
// as a plain browser app during dev and as a real Activity in Discord.
export function isInsideDiscord(): boolean {
  return new URLSearchParams(window.location.search).has('frame_id');
}

export async function authenticateWithDiscord(): Promise<{ discordAccessToken: string }> {
  if (!CLIENT_ID) throw new Error('VITE_DISCORD_CLIENT_ID is not set');

  const discordSdk = new DiscordSDK(CLIENT_ID);
  await discordSdk.ready();

  const { code } = await discordSdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });

  // Exchange the short-lived code for an access token server-side —
  // the client secret required for this step must never reach the browser.
  const res = await fetch('/api/discord/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error('Discord token exchange failed');
  const { access_token } = await res.json();

  await discordSdk.commands.authenticate({ access_token });

  return { discordAccessToken: access_token };
}
