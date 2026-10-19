# Narration discovery correction

Verified against OpenRouter's public API: `/api/v1/models` omits ElevenLabs speech models, while `/api/v1/models?output_modalities=speech` returns the implemented Flash v2.5 and Turbo v2 routes, supported voice names and positive character rates. The old discovery query therefore made supported narration appear unavailable. Earlier tests mistakenly placed speech models in the default catalog.

Voice discovery now explicitly requests speech models. Transcription discovery likewise requests its own modality. Catalog caches are keyed by the full request endpoint, so a previous text lookup cannot hide speech/transcription models. No provider, pricing, narration requirement or credit approval was bypassed.

The regression fixture now excludes speech from the default list and requires the real filtered URL. Tests cover discovery/cache separation, character-based pricing, supported voices, nonzero wallet quotes, legacy draft repair and story-to-production planning. Live verification reads only public catalog/pricing; no speech generation or production wallet change.

Reference: https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties

Live check passed through the compiled application service after loading the text catalog first: both implemented ElevenLabs routes were verified for speech, the selected voice was present, and character pricing was available. Backend TypeScript build passed.
