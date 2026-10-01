# OSSR on Nostr

Profile: [Open Stacks Sponsor Relay](https://njump.me/npub1qwfn9nmjysrycvn3xzqjvxucvgn9y83enl0p8lc5czv65l6szyrqmx8pkm)  
First post: [Introducing OSSR](https://njump.me/note1u9yrdugp7jc7p7l8uh0rjd2f27gl2krxrczun9s8s9vlahnhqruqx2cy54)

Public key:

```text
npub1qwfn9nmjysrycvn3xzqjvxucvgn9y83enl0p8lc5czv65l6szyrqmx8pkm
```

The profile uses the existing OSSR logo, describes the testnet sBTC sponsorship
prototype, and links to the source repository and documentation. Its public
metadata is in [nostr/profile.json](nostr/profile.json).

## Credentials

`NOSTR_NPUB` and `NOSTR_NSEC` are stored in the repository root's ignored
`.env.local`, with permissions `600`. `NOSTR_NSEC` controls this identity;
back it up privately and import it into a trusted Nostr client to edit the
profile or publish future posts. Never commit it, put it in the UI environment,
or give it a `NEXT_PUBLIC_` prefix. The public UI link lives in
`ossr-ui/lib/social.ts`.

## Publication and verification

[nostr/events.json](nostr/events.json) contains the signed public profile
(kind 0), relay list (kind 10002), and first post (kind 1). No secret key is
included. The advertised relays are:

- wss://relay.damus.io
- wss://nos.lol
- wss://relay.primal.net

With Node.js 22 or newer, republish the same events and verify relay readback:

```sh
npm install
npm run nostr:publish
```

The command verifies signatures and identity before publishing, then requests
the exact event IDs back from each relay. It writes acknowledgments and
readback results to [nostr/publication.json](nostr/publication.json) and exits
successfully only when a relay returns all three signed events. Retrying does
not create a second first post. Relay availability and client indexing can vary.

After changing the profile in a client, avoid republishing the old kind-0 event
as an update; export the newer signed metadata event if updating these artifacts.
