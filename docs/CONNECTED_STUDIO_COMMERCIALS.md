# Connected Studio, commercials and asset packs

## Working changes

- AI Studio keeps its project/scene panel and central preview, with the existing streaming OpenRouter assistant beside it. Activity has a bounded scrolling area. Paid production submissions identify their approved credit ceilings; shared timeline assembly is labeled free.
- Product Commercials uploads a real product reference, prepares a quoted script through the existing durable script worker, preserves its job ID for reconnection, and links to scene review/approval. Commercial scripts retain their product brief in project settings. The approved Studio plan validates ownership and supplies those product images to every image step. It requires a reference-capable image model; generated product fidelity remains model dependent.
- Commercial script pricing and media production pricing are separate approvals using the existing wallet. No images or videos are generated automatically during script writing. Admin Automatic Pricing controls commercial availability and maximum script duration. Disabled commercials cannot create scripts, prepare plans or approve prepared plans.
- The manual editor exposes its existing backend editing-command assistant beside the preview. Manual timeline commands remain free; paid export retains the existing quote confirmation. Returning to Studio preserves the existing production/edit association.
- Studio and Editor continue using the same `VideoEdit` document, revision checks, preview data and FFmpeg render path. Preset applications update that document rather than creating another edit. AI Director can list licensed packs and apply a requested preset with timeline-edit permission.
- A persistence defect in cinematic commands was found during integration testing: optional color values set to `undefined` could become BSON `null`, making later edits invalid. New saves omit undefined fields; shared clip validation accepts the legacy cleared color values as unset.
- Script Builder now offers configured, compatible free, and credit-priced continuation modes using the same model-selection service as the shared assistant. Timeline commands that do not call a model do not have a misleading paid-model selector.

## Background removal

Image Studio now has a free solid-color remover that removes matching, edge-connected pixels and saves an actual transparent PNG as a new asset. Users choose the background color and tolerance, and can undo the asset selection. Enclosed matching colors are preserved. This is a color-based tool, not semantic subject/hair segmentation. Detailed-background AI cutout remains enabled only for models with verified transparency/reference capabilities. It is not represented as available for unsupported models.

## Assets and administrator controls

The existing admin sidebar has an Asset Packs section. Administrators can upload owned/licensed images and music, create packs, edit packs and disable availability. Changes are stored in MongoDB and audited. Media is stored through the existing R2 service. No third-party tracks are shipped.

Supported packs:

| Pack | Actual behavior |
| --- | --- |
| Music / brand assets | Copy licensed media into the user's owned library; the copy has its own storage key. |
| Effects | Apply supported color looks to existing clips. |
| Transitions | Apply cut or fade to existing clips. |
| Caption styles | Apply supported fonts, sizes, positions and clean/boxed/bold styles to existing captions. |
| Templates | Combine supported look, transition and caption settings on an existing timeline. |

Users can upload music, product images, logos, overlays and other brand images. Studio can add library images/music to its shared saved edit; Editor uses its existing media/timeline controls. Pending manual edits must be saved before applying a saved pack. Importing an asset alone does not silently add it to a production.

Image overlays/logos can be stored and used as visual clips. Arbitrary compositing over simultaneous video tracks is not implemented here. Pack templates are editing configurations, not motion-graphics projects. Caption presets style existing captions rather than claiming to transcribe speech. Permanent pack deletion and commercial bulk rendering are not added.

## Verification

Non-billable backend tests cover transparent alpha output, enclosed-color preservation, administrator-only pack publishing, audit records, distinct owned imports, preset application to the same edit, revision conflicts, no wallet charges, commercial reference propagation, and actual Director preset tool execution. Existing regression tests cover script recovery, quota limits, Studio production persistence/billing and FFmpeg MP4 rendering, verified test R2 upload, download, audio timing and captions.

Mocked browser tests cover desktop/mobile workspaces, editor controls, Studio handoff, commercial upload/quote/approval and free background removal. Production build and TypeScript checks are run without paid generation.

The live public OpenRouter model catalog was queried on 2026-10-17 without sending a credential or making a generation request. Compatible zero-priced, structured-output listings included `xingchen-agi/xing4.0-29b-a4b:free`, `nvidia/nemotron-3.5-super-vl:free`, and `google/gemma-4-31b-it:free`. This verifies catalog metadata, not account authorization, endpoint availability, output quality, or successful image/video generation. Those require an approved live test. No new API secret is needed for this change.

## Main files

Workspaces: `AIStudioPage.tsx`, `ProductCommercial.tsx`, `VideoEditorPage.tsx`, `ScriptBuilderPage.tsx`, `TextToImagePage.tsx`, `styles.css`.

Asset administration/library: `AdminPage.tsx`, `AssetPacks.tsx`, `AdminOperationsPanel.tsx`, `appendLibraryAsset.ts`, backend `routes/assetPacks.ts`, and mounts in `routes/admin.ts`/`routes/studio.ts`.

Services/data: `backgroundRemoval.ts`, `assistantRouting.ts`, `scriptProduction.ts`, `studioPlan.ts`, `studioExecution.ts`, `creditPricingEngine.ts`, `models/VideoEdit.ts`, `shared/src/editor.ts`; route extensions in `scripts.ts`, `researchAgent.ts`, and `imageStudio.ts`.
