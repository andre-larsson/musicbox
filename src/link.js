// Listen links: a whole score inside a URL, so an agent working anywhere can hand the user a
// page that plays it, and the user can send edits back the same way. The score is
// raw-deflated and base64url-encoded into the hash (#score=…), which never reaches a server.
// Browser code (CompressionStream); the CLI does the same with node:zlib.

export const EDITOR_URL = 'https://a403.space/musicbox/editor/';

function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(code) {
  const s = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
async function through(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function encodeScore(text) {
  return toB64url(await through(new TextEncoder().encode(text), new CompressionStream('deflate-raw')));
}

export async function decodeScore(code) {
  return new TextDecoder('utf-8', { fatal: true }).decode(await through(fromB64url(code), new DecompressionStream('deflate-raw')));
}

/** A link to the editor at `base` that opens `text`. */
export async function scoreLink(text, base = EDITOR_URL) {
  return base.replace(/#.*$/, '') + '#score=' + await encodeScore(text);
}

/** The encoded score in a URL or hash (#score=…), or null. */
export function scoreCode(urlOrHash) {
  const m = /[#&]score=([A-Za-z0-9_-]+)/.exec(String(urlOrHash || ''));
  return m ? m[1] : null;
}
