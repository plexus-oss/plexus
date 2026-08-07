# Thermal camera rendering

Thermal cameras arrive as ordinary `VideoFrame`s (see `video-store.ts`) — the
`frame` field is a colorized JPEG you draw like any other frame. Thermal frames
carry extra fields (`video_type: "thermal"`, `sensor_width/height`,
`temp_min/max`, and an optional `temps` array). This doc covers what to do with
them. The wire format itself is documented in the gateway repo's `FRONTEND.md`.

## Routing to the thermal renderer

A camera's `video_type` is known from `online_sources`/`device_status` (via
`CameraInfo.video_type`) before the first frame arrives. Build a registry from
those events and fall back to the per-frame field for late joins:

```ts
const videoType =
  cameraTypes.get(frame.camera_id) ?? frame.video_type ?? "normal";
if (videoType === "thermal") renderThermal(frame);
else renderNormal(frame);
```

## Temperature scale bar

`temp_min` and `temp_max` are present on every thermal frame — use them to label
a color gradient bar alongside the image:

```ts
function renderThermal(frame: VideoFrame) {
  const img = new Image();
  img.src = `data:image/jpeg;base64,${frame.frame}`;
  img.onload = () => ctx.drawImage(img, 0, 0);

  if (frame.temp_min != null && frame.temp_max != null) {
    drawScaleBar(canvas, frame.temp_min, frame.temp_max);
  }
}
```

## Pixel-level temperature queries (small sensors)

When `temps` is present (small I2C sensors, ≤ 4096 px), map a cursor position on
the displayed image back to a Celsius value. The image is upscaled from the
sensor resolution, so scale cursor coords by `sensor_width / width`:

```ts
function getTempAtCursor(
  frame: VideoFrame,
  cursorX: number,
  cursorY: number,
): number | null {
  if (!frame.temps || !frame.sensor_width || !frame.sensor_height) return null;
  const col = Math.floor(cursorX * (frame.sensor_width / frame.width));
  const row = Math.floor(cursorY * (frame.sensor_height / frame.height));
  return frame.temps[row * frame.sensor_width + col] ?? null;
}
```

Large USB thermal cameras omit `temps` (too many pixels to ship per frame) — the
scale bar still works from `temp_min`/`temp_max`, but pixel-level hover does not.
