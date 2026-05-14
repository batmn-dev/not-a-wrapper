# AI SDK Video Generation — Feature Analysis & Implementation Readiness

> **Purpose:** Research the new AI SDK video generation capabilities announced via Vercel AI Gateway and assess NaW's readiness to implement them
>
> **Created:** February 20, 2026
>
> **Status:** Research Complete — Ready for Implementation Planning
>
> **Sources:**
> - [Blog post: Video Generation with AI Gateway](https://vercel.com/blog/video-generation-with-ai-gateway) (Feb 19, 2026)
> - [Docs: Video Generation Capabilities](https://vercel.com/docs/ai-gateway/capabilities/video-generation)
> - [Docs: Video Generation Quickstart](https://vercel.com/docs/ai-gateway/getting-started/video)
> - [Docs: Text-to-Video](https://vercel.com/docs/ai-gateway/capabilities/video-generation/text-to-video)
> - [Docs: Image-to-Video](https://vercel.com/docs/ai-gateway/capabilities/video-generation/image-to-video)
> - [Docs: Reference-to-Video](https://vercel.com/docs/ai-gateway/capabilities/video-generation/reference-to-video)
> - [Docs: Video Editing](https://vercel.com/docs/ai-gateway/capabilities/video-generation/video-editing)
> - [AI Gateway Models (video filter)](https://vercel.com/ai-gateway/models?type=video)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [What Was Announced](#what-was-announced)
   - Core API
   - Supported Models
   - Generation Types
   - Common Parameters
3. [API Reference](#api-reference)
   - `experimental_generateVideo`
   - Output Format
   - Provider Options
   - Timeout Configuration
4. [Model Comparison](#model-comparison)
5. [NaW Readiness Assessment](#naw-readiness-assessment)
   - Strengths
   - Gaps
   - Readiness Score
6. [Implementation Considerations](#implementation-considerations)
   - Architecture Options
   - Storage Strategy
   - UI Components Needed
   - Model Registry Changes
7. [Related Research](#related-research)
8. [Open Questions](#open-questions)

---

## Executive Summary

Vercel announced **video generation support** for AI Gateway on February 19, 2026, exposing it through AI SDK v6's new `experimental_generateVideo` function. The feature supports 4 providers (17 model variations) with 5 generation types: text-to-video, image-to-video, first+last frame, reference-to-video, and video editing.

**Key takeaway for NaW:** Our codebase (AI SDK `^6.0.78`) is architecturally compatible. The main work is additive — new model entries, a video rendering component, storage handling, and a generation API route. Existing patterns for image generation scaffolding and the part-based message system provide clear templates.

**Availability:** Beta. Requires Vercel Pro/Enterprise plan or paid AI Gateway access. Videos are generated via AI Gateway (not direct provider API keys), which is a significant architectural consideration for BYOK users.

---

## What Was Announced

### Core API

A new `experimental_generateVideo` function in AI SDK v6 that follows the same pattern as `generateText` and `experimental_generateImage`:

```typescript
import { experimental_generateVideo as generateVideo } from 'ai';

const { videos } = await generateVideo({
  model: 'xai/grok-imagine-video',
  prompt: 'A golden retriever catching a frisbee mid-air at the beach',
});
```

### Supported Models (4 Providers, 17 Variations)

| Provider | Model Examples | Key Strengths |
|----------|--------------|---------------|
| **Google Veo** | `google/veo-3.1-generate-001` | High visual fidelity, physics realism, native audio, cinematic lighting |
| **Kling** | `klingai/kling-v2.6-t2v`, `klingai/kling-v3.0-i2v` | Image-to-video, multishot with auto scene transitions, native audio |
| **Alibaba Wan** | `alibaba/wan-v2.6-i2v`, `alibaba/wan-v2.6-r2v-flash` | Reference-based generation, multi-shot storytelling, identity preservation |
| **xAI Grok Imagine** | `xai/grok-imagine-video` | Fast generation, style transfer, video editing |

Model naming convention uses capability tags: `t2v` (text-to-video), `i2v` (image-to-video), `r2v` (reference-to-video).

### Generation Types

| Type | Input | Description | Providers |
|------|-------|-------------|-----------|
| **Text-to-video** | Text prompt | Describe a scene, get a video | All 4 |
| **Image-to-video** | Image + optional text | Animate a still image with motion cues | All 4 |
| **First & last frame** | 2 images + optional text | Define start/end states, model fills transition | Kling |
| **Reference-to-video** | Reference images/videos | Extract characters, place in new scenes | Wan |
| **Video editing** | Source video + text prompt | Style transfer on existing videos | Grok Imagine |

### Common Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | `string \| { image, text }` | Text description or object with image + text for i2v |
| `duration` | `number` | Video length in seconds (varies by model) |
| `aspectRatio` | `string` | e.g. `'16:9'`, `'9:16'` |
| `resolution` | `string` | e.g. `'1920x1080'`, `'1280x720'` |

---

## API Reference

### `experimental_generateVideo`

```typescript
import { experimental_generateVideo as generateVideo } from 'ai';

// Text-to-video
const { videos } = await generateVideo({
  model: 'google/veo-3.1-generate-001',
  prompt: 'A serene mountain landscape at sunset',
  aspectRatio: '16:9',
  duration: 8,
});

// Image-to-video
const { videos } = await generateVideo({
  model: 'klingai/kling-v2.6-i2v',
  prompt: {
    image: imageUrl,        // URL or buffer
    text: 'The scene slowly comes to life with gentle movement',
  },
  duration: 5,
  providerOptions: {
    klingai: { mode: 'pro' },
  },
});

// Reference-to-video (multi-character)
const { videos } = await generateVideo({
  model: 'alibaba/wan-v2.6-r2v-flash',
  prompt: 'character1 and character2 playing on the beach',
  resolution: '1280x720',
  duration: 5,
  providerOptions: {
    alibaba: {
      referenceUrls: [character1Image, character2Image],
    },
  },
});

// Video editing (style transfer)
const { videos } = await generateVideo({
  model: 'xai/grok-imagine-video',
  prompt: 'Transform into watercolor painting style',
  providerOptions: {
    xai: {
      videoUrl: sourceVideoUrl,
    },
  },
});

// First and last frame
const { videos } = await generateVideo({
  model: 'klingai/kling-v3.0-i2v',
  prompt: {
    image: startFrameDataUrl,
    text: 'Smooth cinematic transition between scenes',
  },
  duration: 5,
  providerOptions: {
    klingai: {
      lastFrameImage: endFrameDataUrl,
      mode: 'std',
    },
  },
});
```

### Output Format

Videos are returned on `result.videos[]`. Each video object contains:

| Property | Type | Description |
|----------|------|-------------|
| `base64` | `string` | Base64-encoded video data |
| `uint8Array` | `Uint8Array` | Raw video data |

```typescript
import fs from 'node:fs';

// Save to file
fs.writeFileSync('output.mp4', result.videos[0].uint8Array);
```

### Provider-Specific Options (`providerOptions`)

| Provider | Option | Type | Description |
|----------|--------|------|-------------|
| `klingai` | `mode` | `'std' \| 'pro'` | Generation quality mode |
| `klingai` | `sound` | `'on' \| 'off'` | Enable audio |
| `klingai` | `lastFrameImage` | `string \| Buffer` | End frame for interpolation |
| `alibaba` | `referenceUrls` | `string[]` | Character reference images |
| `alibaba` | `shotType` | `'single' \| 'multi'` | Scene composition |
| `xai` | `videoUrl` | `string` | Source video for editing |

### Timeout Configuration

Video generation takes **minutes** (not seconds). Node.js default `fetch` has a 5-minute timeout via Undici which may be insufficient.

**Custom gateway with extended timeouts:**

```typescript
import { createGateway } from 'ai';
import { Agent } from 'undici';

export const gateway = createGateway({
  fetch: (url, init) =>
    fetch(url, {
      ...init,
      dispatcher: new Agent({
        headersTimeout: 15 * 60 * 1000, // 15 minutes
        bodyTimeout: 15 * 60 * 1000,
      }),
    } as RequestInit),
});

// Usage
const { videos } = await generateVideo({
  model: gateway.video('google/veo-3.1-generate-001'),
  prompt: 'A timelapse of a flower blooming',
  duration: 8,
});
```

**Global default provider (Next.js `instrumentation.ts`):**

```typescript
import { createGateway } from 'ai';
import { Agent } from 'undici';

export async function register() {
  globalThis.AI_SDK_DEFAULT_PROVIDER = createGateway({
    fetch: (url, init) =>
      fetch(url, {
        ...init,
        dispatcher: new Agent({
          headersTimeout: 15 * 60 * 1000,
          bodyTimeout: 15 * 60 * 1000,
        }),
      } as RequestInit),
  });
}
```

---

## Model Comparison

| Feature | Google Veo 3.1 | Kling v2.6/v3.0 | Alibaba Wan v2.6 | xAI Grok Imagine |
|---------|---------------|-----------------|-----------------|-----------------|
| Text-to-video | Yes | Yes | Yes | Yes |
| Image-to-video | Yes | Yes | Yes | Yes |
| First+last frame | No | Yes (v3.0) | No | No |
| Reference-to-video | No | No | Yes | No |
| Video editing | No | No | No | Yes |
| Native audio | Yes | Yes | Yes | Yes |
| Multi-shot | No | Yes (v3.0) | Yes | No |
| Speed | Moderate | Moderate | Moderate | Fast |
| Visual quality | Highest | High | High | Good |
| Physics realism | Excellent | Good | Good | Good |

---

## NaW Readiness Assessment

### Strengths (What's Already in Place)

| Asset | Location | Relevance |
|-------|----------|-----------|
| AI SDK v6 (`^6.0.78`) | `package.json` | `experimental_generateVideo` available with latest version |
| Streaming architecture | `app/api/chat/route.ts` | `streamText` + `toUIMessageStreamResponse()` pattern established |
| Image component | `components/ui/image.tsx` | Handles `base64` + `uint8Array` — direct template for video component |
| Convex file storage | `convex/files.ts` | `generateUploadUrl`, `saveAttachment`, `getUrl` patterns ready |
| File upload pipeline | `lib/file-handling.ts` | `uploadFileToConvex`, `processFiles` patterns established |
| Image gen scaffolding | `app/components/chat/use-loading-state.ts` | `showImageGenProgress` and `imageGeneration` tool detection already exist |
| Model registry | `lib/models/types.ts` | Extensible `ModelConfig` with capability flags (`vision`, `tools`, `audio`) |
| Part-based messages | `app/components/chat/conversation.tsx` | Already handles `text`, `reasoning`, `source-url`, tool parts |
| Provider abstraction | `lib/openproviders/index.ts` | Factory pattern for multi-provider support |

### Gaps to Address

| Gap | Effort | Impact | Notes |
|-----|--------|--------|-------|
| No `video` capability flag | Low | Model registry | Add `video?: boolean` to `ModelConfig` in `lib/models/types.ts` |
| No video model entries | Low | Model registry | Add Veo, Kling, Wan, Grok Imagine to `lib/models/data/` |
| No video rendering component | Medium | UI | Create `components/ui/video.tsx` (mirror `image.tsx` pattern) |
| No video part handling | Medium | Message rendering | Extend message rendering to handle video parts |
| No video generation route | Medium | API | New `/api/video/route.ts` or extend chat route |
| No `createGateway` setup | Low | Infrastructure | Required for extended timeouts; possibly useful beyond video |
| No video storage pattern | Medium | Backend | Extend Convex storage for larger files (video > image) |
| No video progress UI | Low–Medium | UX | Extend `use-loading-state.ts` for video generation (multi-minute waits) |
| **AI Gateway dependency** | **High** | **Architecture** | Video requires AI Gateway, not direct provider keys — conflicts with BYOK model |

### Readiness Score: 7/10

The architecture is well-positioned. Implementation is primarily additive (new components, model entries, capability flags) rather than requiring refactoring. The largest open question is the **AI Gateway dependency** and how it interacts with our BYOK model.

---

## Implementation Considerations

### Architecture Options

**Option A: Standalone Video Route**
- New `app/api/video/route.ts` dedicated to video generation
- Separates video generation from chat streaming
- Simpler to implement; cleaner separation of concerns
- Progress polling or WebSocket for long-running generation

**Option B: Chat-Integrated Tool**
- Video generation as a tool invocation within the chat flow
- User asks "generate a video of X" → tool call → video rendered inline
- More natural UX but adds complexity to the streaming pipeline
- Requires handling multi-minute tool execution

**Option C: Hybrid**
- Standalone route handles generation
- Chat integrates as a tool that delegates to the route
- Best of both worlds but more moving parts

**Recommendation:** Start with **Option A** (standalone route) for initial implementation. Add chat integration (Option C) as a follow-up once the generation pipeline is proven.

### Storage Strategy

Video files are significantly larger than images. Considerations:

| Approach | Pros | Cons |
|----------|------|------|
| **Convex storage** | Consistent with existing pattern | File size limits, cost |
| **Vercel Blob** | Recommended by Vercel docs, URL-based | New dependency, separate billing |
| **Client-side download** | Simple, no storage cost | No persistence, no sharing |

Some video models require URLs (not raw buffers) for input media. [Vercel Blob](https://vercel.com/docs/vercel-blob) is recommended by the official docs for hosting input media.

### UI Components Needed

1. **`components/ui/video.tsx`** — Video renderer supporting `base64`, `uint8Array`, and URL sources. Mirror the `image.tsx` pattern with `<video>` element, controls, and loading state.

2. **Video generation progress** — Multi-minute generation needs a progress indicator beyond the existing dots/spinner. Consider a progress card with estimated time remaining.

3. **Video part in messages** — Extend the part rendering system to display videos inline in chat messages.

4. **Generation form** — UI for configuring video generation (model selection, generation type, duration, aspect ratio, optional image input for i2v).

### Model Registry Changes

Add to `lib/models/types.ts`:

```typescript
type ModelConfig = {
  // ... existing fields
  video?: boolean           // Can generate video
  videoCapabilities?: {
    t2v?: boolean           // Text-to-video
    i2v?: boolean           // Image-to-video
    r2v?: boolean           // Reference-to-video
    editing?: boolean       // Video editing
    firstLastFrame?: boolean // First and last frame interpolation
    audio?: boolean         // Native audio generation
  }
}
```

### BYOK Compatibility Concern

Video generation routes through **AI Gateway**, not direct provider APIs. This has significant implications:

- BYOK users with their own Kling/Veo/etc. API keys cannot use them directly through this API
- Requires a Vercel AI Gateway API key (`AI_GATEWAY_API_KEY`)
- This is a **platform-level feature**, not a provider-level feature
- May require a separate billing/access model for NaW users

This is the biggest architectural decision to resolve before implementation.

---

## Related Research

| Document | Relevance |
|----------|-----------|
| [AI SDK Upgrade Research](ai-sdk-upgrade-research.md) | v6 migration path (complete) |
| [AI Video Generator macOS App Evaluation](ai-video-generator-macos-app-evaluation.md) | Broader video generation API landscape and NLE design research |
| [Latest Models — February 2026](latest-models-february-2026.md) | Current model registry state |
| [Competitive Feature Analysis](competitive-feature-analysis.md) | How competitors handle media generation |

---

## Open Questions

1. **AI Gateway vs BYOK** — How do we handle video generation for BYOK users? Is AI Gateway the only path, or can we support direct provider APIs (Kling API, Veo API) independently?

2. **Pricing model** — Video generation is expensive. How do we meter/limit usage? Per-video limits vs token-based vs credit system?

3. **Storage and persistence** — Do generated videos persist in chat history? If so, what's the storage cost model? Convex storage vs Vercel Blob vs external?

4. **Streaming vs polling** — Video generation takes minutes. Do we poll for completion, use WebSockets, or implement a job queue pattern?

5. **Content moderation** — Video generation needs content safety guardrails. Do the providers handle this, or do we need additional moderation?

6. **Mobile/responsive** — Video playback and generation UI on mobile devices — what's the UX?

7. **Export/download** — Do users need to download generated videos? What formats and quality options?

8. **Chaining** — Can users chain generation types (e.g., text-to-video → video editing → style transfer)?

---

*Last updated: February 20, 2026*
