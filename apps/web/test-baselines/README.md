# Visual Baseline Reference Images

## Directory Structure

```
test-baselines/screenshots/
├── desktop/    # 1440×1000
├── tablet/     # 980×800, 981×800, 760×800, 759×800
└── mobile/     # 390×844
```

## Breakpoints to Verify (both sides)

| Breakpoint | Below | Above | CSS File |
|-----------|-------|-------|----------|
| 980px | 979×800 | 981×800 | responsive-workspace, theme-overrides, platform-status |
| 900px | 899×800 | 901×800 | watermark-studio |
| 760px | 759×800 | 761×800 | responsive-workspace, manual-input |
| 700px | 699×800 | 701×800 | configuration |
| 600px | 599×800 | 601×800 | node-workbench, artifacts |
| 480px | 479×844 | 481×844 | overlays |

## Conditions for Stable Screenshots

- `animations: 'disabled'` in Playwright
- `reducedMotion: 'reduce'` on page
- Fixed test data (no timestamps, no random values)
- Font loading complete before capture
- Wait for network idle

## Comparison Rules

- Pixel-perfect for layout geometry
- Anti-aliased text may differ across OS/GPU — use structural comparison
- Color values must match exactly (no gamma differences)
- Scroll position normalized to top before capture

## Approval Process

1. Generate reference images with `npm run test:workflow-browser`
2. Copy approved images to this directory
3. Future runs compare against these references
4. Differences require human review and explicit approval
