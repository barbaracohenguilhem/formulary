# Formulary

**Registro para retomar:** [HANDOFF.md](./HANDOFF.md) — mudanças concluídas,
validações, pendências e bloqueios de publicação ao encerrar em 07/10/2026.

**Direção atual:** hospedagem gratuita; Vercel descartada pela usuária.
**Publicado no Cloudflare Pages:** [formulary-bfk.pages.dev](https://formulary-bfk.pages.dev/).
O endereço novo exige parear os dispositivos novamente. O teste com Carla e
Barbara em dispositivos reais ainda está pendente; detalhes em [HANDOFF.md](./HANDOFF.md).
As configurações Vercel abaixo ficam apenas como histórico.

O Pages está ligado à branch `copilot/summarize-last-3-merged-prs`, com framework
None, comando `node scripts/stage-static.mjs`, saída `dist` e
`SKIP_DEPENDENCY_INSTALL=true`. Ele publica o pacote estático commitado: mudanças
na fonte exigem executar `npm run build:site` e incluir os bundles atualizados.

Formulary gives Carla a short email briefing and a prepared response or next action.
She reviews it, files irrelevant work, approves it, or gives free-form instructions
to the robot by text or dictation. Barbara receives approvals and explicit
delegations in her own queue; robot change requests stay with the robot.

## The first workflow fix

Carla keeps the existing **Today / Upcoming / Archive** briefing and its content.
Barbara's authenticated device opens **From Carla** with only these incomplete lots:

| Shared lot state | What Barbara sees |
| --- | --- |
| `review: approved`, `completed: false` | Carla's approval and the full prepared proposal |
| `review: barbara`, `completed: false` | Carla's saved instructions or dictation transcript |
| `review: changes`, `completed: false` | Nothing: this is the robot's revision queue |

Barbara can edit a proposal and return it for Carla's approval. Marking approved work
handled records work Barbara already performed. Approval is distinct from completion.
Opening a feedback editor, starting dictation, or cancelling it creates no handoff.
New instructions default to the robot. Switching to **Hand to Barbara instead**
only selects a recipient; submitting saves the instructions. A robot request
returns through the existing revision engine for Carla's approval.
Email approval requires a non-empty prepared proposal without a draft
failure or queued/in-progress robot work. All approval controls and the save-time
validator enforce this; manual tasks can still be approved without a proposal.
An earlier triage failure does not block approval of a successfully prepared or
returned proposal.
Failed writes keep the user's draft visible. Each action re-reads the lot and rejects
an outdated decision before writing.

Identity comes from the existing Supabase session and `people.who`. The old second
role picker and the separate `formulary/review-queue` document are no longer used.
Older `formulary.role` and `formulary.review` browser data are ignored, not deleted.
Malformed placeholder feedback from the former wrapper cannot be recovered as real
instructions; actual approvals and feedback in `lots/*` are used directly.

Barbara's two subscriptions are independent of Carla's 200-lot archive, with a
1,000-item limit per status. The existing Supabase adapter refreshes after Realtime
events, when the phone becomes visible, and every minute. The queue refresh button
only reloads handoffs; it does not trigger the email robot.

## Current boundaries

- The current Gmail integration is read-only. Opening the original thread does
  not create a reply in Gmail. Preparing an actual Gmail reply with attachments
  remains required work on the server integration, not a completed capability.
- Speech input is browser dictation. Its transcript and input mode are saved on the
  shared lot; no playable audio recording is currently stored.
- File uploads and workspace document search are not implemented. Feedback-file
  types in the source do not provide storage, extraction, or robot consumption.
- The briefing must filter by Carla's responsibility, not just a work category.
  Other people's pending actions stay accessible in the all-mail view. Existing
  explicit human decisions and history are preserved. Matching changes to any
  separately deployed triage worker are still required before release.
  New triage records use `actionFor` to distinguish Carla, another person, no
  action, or uncertainty. Older records with an action but no `actionFor` need
  reclassification; a person's name alone is not used to hide a possible task.
- UI and action guards enforce the two experiences in the app. Existing backend
  membership/RLS remains unchanged; this is not a server-side authorization migration
  or an atomic compare-and-swap upgrade to `doc_merge`.
- Existing devices must already be paired with the correct person. An old local
  role-picker choice does not override their authenticated identity.
- The deployed scheduled robot is preserved: when the server reports no Gmail
  connection, new draft requests queue for the routine rather than calling the
  inactive server robot. Queued proposals cannot be approved until prepared.

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

Release-artifact follow-up for the feedback-save lock, unsaved-proposal guard,
and email approval-readiness guard:
this source/test patch leaves the committed static release unchanged. A local
`npm run build` without production configuration checks compilation only; its
output is not a publishable release. Before releasing these fixes, an authorized
maintainer must run `npm run build:site` with the existing valid public Supabase
configuration and review/commit the generated assets and headers. Do not use the
browser-test fixture configuration for a release build. No deployment is part
of this patch.

`npm run dev` serves the frontend on port 5178. `npm run build` emits `dist`;
`npm run build:site` also refreshes the static files at the repository root and
generates matching CSP hashes. Neither command publishes the site. Frontend
environment files are ignored by Git. Use only public browser credentials.

[vercel.json](./vercel.json) publishes the committed static release using
[scripts/stage-static.mjs](./scripts/stage-static.mjs). It copies only the built
site into the deployment output and carries the security headers that Vercel
does not read from `_headers`. This avoids rebuilding the frontend on the host
without its local cloud configuration. Build locally and commit the generated
assets before deploying. The configuration does not connect or publish a project
by itself.

Without cloud configuration, development uses the original fictional seed data.
`/#inbox` on the dev server enables the existing fictional inbox fixture.
Browser integration tests create their own local server, two independent user
sessions, a fictional shared store, and mocked cloud/voice services. They block
external requests and never read email or write production data. Browser tests
need a locally available Chromium browser; see the test runner for discovery.
