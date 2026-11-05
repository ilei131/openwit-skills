# Icon Design Guide

How to go from a one-line brief to a mark that survives 1024 px and 20 px.

## Process

1. **One metaphor.** Pick the single object/letter/abstract shape that names the app's job (bolt = speed, layers = stack, bubble = chat, spark = AI). Two elements maximum.
2. **Silhouette first.** Sketch the filled silhouette; if it's not recognizable as a shadow, no detail will save it.
3. **Structure the SVG in two layers** and keep them as separate files — that's what enables Android adaptive + monochrome and iOS dark variants:
   - `fg`: transparent canvas, mark roughly centered (the build trims the margins and re-fits the content to 50% of the Android canvas, so exact padding in the source doesn't matter).
   - `--bg`: solid color, 2-stop `linear-gradient(<angle>deg,#a,#b)`, or an image.
4. **Render, then shrink-test**: view the 1024 master and the 20/29 px outputs. Judge at arm's length.
5. **Iterate the source, not the outputs.** Never hand-edit generated PNGs; edit the SVG and rebuild.

## Geometry rules

- Stroke weight ≥ 1/12 of canvas (≥ 85 px on 1024) or it vanishes at 29 px.
- Keep 8–12% optical margin inside the safe zone; optically center (visual mass), not just geometrically.
- Rounded caps and rounded joins read friendlier and survive downscaling; sharp spikes alias.
- **Never** put the background, rounded corners, or drop shadows in the foreground file. Systems mask and light the icon themselves; baked effects double up and look muddy.
- Gradients: only on filled shapes. A zero-height `<line>` has an undefined bounding box and its gradient silently disappears — use `<rect rx>` bars instead.

## SVG recipes

### Rounded glyph from bars

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(512 512)" fill="#FFFFFF">
    <rect x="-206" y="-56" width="412" height="112" rx="56"/>
    <rect x="-206" y="-56" width="412" height="112" rx="56" transform="rotate(60)"/>
    <rect x="-206" y="-56" width="412" height="112" rx="56" transform="rotate(120)"/>
  </g>
</svg>
```

### Knocked-out details (dots in a bubble)

One `<path fill-rule="evenodd">`: outer shape clockwise, holes counter-clockwise — holes stay transparent so the background shows through.

### Letterform marks

Convert text to paths (any vector tool) before shipping; do not rely on installed fonts. Keep one character, weight ≥ Bold, centered with the same optical margins.

## Palettes that pass contrast checks

- **Deep start → vivid end** gradients: `#1E1B4B→#6D28D9`, `#0F172A→#2563EB`, `#052E16→#16A34A`, `#431407→#EA580C`.
- White/off-white marks (`#FFFFFF→#E0E7FF`) on saturated backgrounds give the best small-size contrast.
- Avoid mid-gray-on-mid-gray and yellow-on-white; check the tinted (grayscale) variant still separates figure from ground.
- Dark appearance: darken the background (×0.5), keep the mark light; never just invert.

## AI-generated master art (ImageGen mode)

Use when the brief wants illustration/3D rather than flat geometry:

- Prompt for: "app icon, single centered symbol, flat solid background #hex, no text, no rounded corners, no drop shadow, bold minimal, vector style, square".
- Generate ≥ 1024 px, then `--master art.png --bg <dominant color>`; the pipeline flattens alpha and cuts every size.
- Weaknesses to check: stray text, baked corners/shadows, off-center subjects, muddy 20 px result. If the master is flat art without layers, adaptive foreground falls back to whole-image scaling and monochrome is skipped — say so in delivery.

## Small-size test protocol

Look at (or compose) these before delivery: 1024 hero, 180 home-screen, 60 spotlight, 29 settings, 20 notification, Android circle mask, Android themed silhouette. If the 20 px reads, everything between reads.
