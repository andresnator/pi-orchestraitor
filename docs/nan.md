# NaN provider

The harness bundles NAN as an additional native Pi provider in `extensions/nan.ts`. It uses Pi's existing OpenAI Chat Completions transport and API-key authentication. No NAN CLI, extra dependency, custom OAuth flow, or personal `models.json` is required.

Installing or reloading the package only registers the provider and its static model catalog. It does not log in, select NAN, change defaults, or contact NAN's account/model APIs.

## Sign in and choose a model

1. Sign in to [NAN Cloud](https://cloud.nan.builders/dashboard).
2. Generate a personal key in **user settings → API Keys**. NAN membership is required; the key is shown only once.
3. In Pi, run:

   ```text
   /reload
   /login nan
   ```

4. Paste the key into Pi's native secret-input prompt, not into a conversation or repository file.
5. Run `/model` and select **NaN → GLM 5.3 Flash** for coding, or **DeepSeek V4 Flash** for general tasks.

`/login nan` stores an API-key credential in Pi's private `auth.json` under the active agent directory (normally `~/.pi/agent`). It is not NAN's website/email login or a browser OAuth flow. Entering a key does not validate it with NAN; only an authenticated request proves service access. Never commit, share, or sync that credential file unintentionally.

Your existing default provider/model remain unchanged. Selecting a model changes the current session; use Pi's explicit save-default action only if you want that change to persist. The upstream NAN guide's default-setting step is unnecessary when you select the model explicitly.

## Environment-variable alternative

Provide `NAN_API_KEY` through your shell or secret manager **before starting Pi**. The extension reads it through Pi's native auth resolver without writing it to disk. Do not put a real key in a command you share, repository config, or chat.

With the variable available, start the local CLI explicitly on NAN:

```bash
pnpm exec pi --provider nan --model glm5.3-flash
```

A stored NAN credential takes precedence over `NAN_API_KEY`. `/logout nan` removes the stored credential, but an inherited environment key remains usable and logout does not revoke keys at NAN. Revoke a key through NAN's API Keys dashboard if needed.

## Bundled chat models

The catalog follows [NAN's Pi guide](https://nan.builders/docs/pi), checked on 2026-10-07. It is a static snapshot, not a live list of models authorized for your account.

| ID | Context window | Maximum answer |
| --- | ---: | ---: |
| `deepseek-v4-flash` | 1,048,576 | 32,768 |
| `glm5.3-flash` | 1,048,576 | 32,768 |
| `qwen3.8-flash` | 1,048,576 | 32,768 |
| `mimo-v2.6-flash` | 1,048,576 | 32,768 |
| `gemma4` | 262,144 | 65,536 |
| `qwen3.6` | 262,144 | 65,536 |
| `glm5.3` (premium) | 1,048,576 | 32,768 |

All entries support text/image input and advertise reasoning, as documented by NAN. Pi's chat schema does not expose NAN's audio/video inputs. `maxTokens` is an answer budget, including reasoning, not the context window.

The endpoint is `https://api.nan.builders/v1`; requests use Bearer authentication and Pi's `openai-completions` API. The documented developer-role compatibility flag is retained. Transport, tools, usage, errors, and cancellation remain Pi-owned; no stream implementation is copied.

`glm5.3` requires premium membership. Other models have plan-specific quotas and concurrency limits; consult [NAN's current model limits](https://nan.builders/docs/models). Pi's cost display uses zero per-token rates because this integration cannot account for flat membership fees. **Zero displayed cost does not mean free service or unlimited quota.**

## Overrides and disabling

Existing personal `models.json` NAN overrides remain supported by Pi. Use `providers.nan.modelOverrides` to adjust a known model's metadata, or a provider override to change the endpoint. Keep secrets outside this repository. If NAN's CLI already wrote personal configuration, it can override the bundled catalog, endpoint, or credentials; inspect your own overrides when troubleshooting.

Exclude `extensions/nan.ts` from this package through `pi config` to disable the bundled provider, then reload. Independent NAN entries in personal `models.json` or another extension remain separate and must be disabled there too. Disabling the extension does not remove or revoke credentials.

## Troubleshooting

- **NAN is absent from `/login`:** reload the package and verify `extensions/nan.ts` is enabled. The current tested host is Pi 1.0.4.
- **NAN models are absent from `/model`:** provide a stored key or `NAN_API_KEY`; unconfigured models remain unavailable.
- **401:** check the key and requested model's membership tier. The premium model may fail while Flash models work.
- **402 / 429:** check quota, request rate, and concurrent work rather than repeatedly logging in.
- **Unexpected model/endpoint:** check personal `models.json` overrides; the bundled provider never overwrites them.

## Verification and references

`node --test tests/nan.test.mjs` covers catalog metadata, native secret login/logout, environment fallback, cancellation, mocked native text/tool streaming, usage and request fields, reload/default preservation, and personal overrides. Package tests exercise NAN from extracted pnpm/npm tarballs. These checks use synthetic keys and mocked responses, not real NAN credentials or membership.

The implementation follows installed Pi 1.0.4 provider/auth contracts. Context7 did not offer an indexed 1.0.4 version; installed documentation and types were the version-specific authority.

- [NAN Pi setup](https://nan.builders/docs/pi)
- [NAN API keys and getting started](https://nan.builders/docs/getting-started)
- [NAN model capabilities and limits](https://nan.builders/docs/models)
- [Pi custom providers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)
