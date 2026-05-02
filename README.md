# EngageGuard

EngageGuard is a Chrome extension that highlights YouTube videos whose visible public engagement looks unusually low for their view count.

It is an anomaly signal, not a fraud detector. The extension does not claim that a video bought views, used bots, or manipulated engagement.

## What It Does

- Runs automatically on normal YouTube watch pages: `youtube.com/watch?v=...`
- Reads public, visible page data from the YouTube DOM.
- Calculates visible engagement from views, likes, and comments when available.
- Shows an in-page warning only for low-engagement classifications.
- Adds a colored border to the player while a warning is active.
- Does not send data outside the browser.
- Does not use the YouTube Data API.

## Score

When views, likes, and comments are available:

```ts
likeRate = likes / views;
commentRate = comments / views;
engagementRate = (likes + comments) / views;
```

When comments are not available yet:

```ts
engagementRate = likes / views;
```

Videos with missing views or likes are not analyzed. Videos under `1,000` views are currently treated as insufficient data.

## Classification

| Classification   | Engagement rate | UI      |
| ---------------- | --------------: | ------- |
| Very strong      |       `>= 4.5%` | Silent  |
| Strong           |       `>= 3.5%` | Silent  |
| Normal           |       `>= 2.5%` | Silent  |
| Low              |   `1.0% - 2.5%` | Warning |
| Suspiciously low |   `0.5% - 1.0%` | Warning |
| Highly unusual   |        `< 0.5%` | Warning |

The warning copy intentionally uses calm language, for example:

```text
This video has unusually low visible engagement for its view count · Engagement: 0.8%
Comments unavailable; using likes/views only.
```

## Current Limitations

- YouTube lazy-loads some values. Comment count may appear only after scrolling to the comments section.
- Like counts can be hidden or unavailable on some videos.
- YouTube DOM selectors change over time, so extraction may need maintenance.
- The MVP targets normal watch pages only, not Shorts, embeds, search results, home pages, channel pages, or recommendation cards.
- The benchmark is tuned for tech/dev-style videos and should not be generalized to every YouTube category.

## Development

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run build
```

Run checks:

```bash
npm run lint
npm run format:check
```

Watch-build during development:

```bash
npm run dev
```

## Load In Chrome

1. Build the project with `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the `dist/` folder.
6. Open a YouTube watch page and refresh it.

If you rebuild, reload the extension in `chrome://extensions` and refresh the YouTube tab.

## Dev Bypass

For visual testing, force the warning UI from the YouTube page console:

```js
localStorage.setItem("engageguard:forceWarning", "true");
```

Disable it:

```js
localStorage.removeItem("engageguard:forceWarning");
```

The bypass is for development only and should be removed or hidden before a
polished release.

## Project Structure

```text
manifest.json          Chrome extension manifest
src/content.ts         YouTube page detector, metric extraction, scoring, warning UI
src/popup/             Minimal extension popup
vite.config.ts         Build config and manifest copy step
plan/mvp.md            MVP plan and implementation roadmap
```
