# Formulary

Formulary gives Carla a short email briefing and a prepared response or next action.
She reviews it, files irrelevant work, approves it, or gives quick feedback. Barbara
receives the resulting handoffs and corrections in her own queue.

## The first workflow fix

Carla keeps the existing **Today / Upcoming / Archive** briefing and its content.
Barbara's authenticated device opens **From Carla** with only these incomplete lots:

| Shared lot state | What Barbara sees |
| --- | --- |
| `review: approved`, `completed: false` | Carla's approval and the full prepared proposal |
| `review: barbara`, `completed: false` | Carla's saved instructions or dictation transcript |
| `review: changes`, `completed: false` | Older feedback already sent through the previous robot workflow |

Barbara can edit a proposal and return it for Carla's approval. Marking approved work
handled records work Barbara already performed. Approval is distinct from completion.
Opening a feedback editor, starting dictation, or cancelling it creates no handoff.
Failed writes keep the user's draft visible. Each action re-reads the lot and rejects
an outdated decision before writing.

Identity comes from the existing Supabase session and `people.who`. The old second
role picker and the separate `formulary/review-queue` document are no longer used.
Older `formulary.role` and `formulary.review` browser data are ignored, not deleted.
Malformed placeholder feedback from the former wrapper cannot be recovered as real
instructions; actual approvals and feedback in `lots/*` are used directly.

Barbara's three subscriptions are independent of Carla's 200-lot archive, with a
1,000-item limit per status. The existing Supabase adapter refreshes after Realtime
events, when the phone becomes visible, and every minute. The queue refresh button
only reloads handoffs; it does not trigger the email robot.

## Current boundaries

- Gmail is read-only. This frontend does not send messages or attachments. Barbara
  opens the original Gmail thread to act, then records completion here.
- Speech input is browser dictation. Its transcript and input mode are saved on the
  shared lot; no playable audio recording is currently stored.
- Workspace document search, attachment preparation, and automated sending are
  separate future work. Classification and robot prompts are unchanged in this fix.
- UI and action guards enforce the two experiences in the app. Existing backend
  membership/RLS remains unchanged; this is not a server-side authorization migration
  or an atomic compare-and-swap upgrade to `doc_merge`.
- Existing devices must already be paired with the correct person. An old local
  role-picker choice does not override their authenticated identity.

## Editable source and static output

The initial repository contained only a flattened production export. The frontend
source was recovered from the original local Formulary repository at commit
`2c318ba`. Before modifications, building it reproduced both original bundles
**byte for byte**, including their SHA-256 digests:

- JavaScript: `7ebce993ccd239d16ed66313fb37ba19df2909e1bd370fc68c5e5daa24dc7684`
- CSS: verified against the original `index-Covz3XYt.css` during recovery.

[frontend/src](./frontend/src) is now the editable React/TypeScript source.
The root [index.html](./index.html) and [assets](./assets) are generated static output
for the existing hosting layout. Avoid editing those bundles by hand.

```sh
npm ci
cp frontend/.env.example frontend/.env.production
# Set the existing Supabase URL and public publishable key in that local file.
npm run dev
npm run typecheck
npm test
npm run test:browser
npm run build:site
```

`npm run dev` serves the frontend on port 5178. `npm run build` emits `dist`;
`npm run build:site` also refreshes the static files at the repository root and
generates matching CSP hashes. Neither command publishes the site. Frontend
environment files are ignored by Git. Use only public browser credentials.

Without cloud configuration, development uses the original fictional seed data.
`/#inbox` on the dev server enables the existing fictional inbox fixture.
Browser integration tests create their own local server, two independent user
sessions, a fictional shared store, and mocked cloud/voice services. They block
external requests and never read email or write production data. Browser tests
need a locally available Chromium browser; see the test runner for discovery.
