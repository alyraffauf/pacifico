# Pacifico

Pacifico is a Bun, Vite, React, and TypeScript frontend for Tranquil PDS. It is intended to share a public origin with Tranquil while the reverse proxy sends backend routes directly to Tranquil.

The site mark is cropped from [Wallhaven wallpaper k875o6](https://wallhaven.cc/w/k875o6).

## Develop and verify

Use Bun 1.3.13 or a compatible newer release.

```sh
bun install --frozen-lockfile
bun run dev
bun run check
bun run test
bun run build
```

Account creation, email verification, OAuth consent, TOTP, passkeys, sessions, settings, and the same-origin routing contract need verification against the disposable Tranquil stack before a release is considered safe.

## Runtime configuration

- `PUBLIC_ORIGIN` defines the canonical public HTTPS origin. Set it in production. Requests with a different host are rejected. HTTP is accepted only for localhost development.
- `PORT` selects the Bun server port and defaults to `3000`.
- `VITE_API_URL` selects the Vite development proxy target.
- `VITE_PDS_URL` overrides the PDS URL at build time when the browser hostname is not the correct public PDS hostname.

Start the production server after building:

```sh
PUBLIC_ORIGIN=https://pds.example.com bun run start
```

## Same-origin routing contract

The ingress or reverse proxy owns the split. Pacifico does not proxy backend traffic at runtime.

Send these paths to Tranquil:

- `/xrpc`
- `/oauth`
- `/.well-known`
- `/u`
- `/health`
- `/favicon.ico`
- wildcard handle hosts used by the PDS

Send these paths to Pacifico:

- `/`
- `/app`
- `/assets`
- public image and manifest files
- `/oauth-client-metadata.json`

Pacifico keeps Tranquil's browser-storage semantics. Registration recovery data expires after one hour, and password material is never written to browser storage.

This repository does not contain deployment manifests. Route Pacifico and Tranquil as separate services at the ingress.
