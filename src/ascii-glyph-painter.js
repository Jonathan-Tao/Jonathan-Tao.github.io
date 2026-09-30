// Adjacent cells with identical paint and displacement can share one text
// draw. Keep the original glyphs, fractional positions, font and opacity;
// displaced ripple/reveal cells naturally fall back to individual draws.
export function createGlyphPainter(context, font, cellWidth) {
  context.font = font;
  const canBatch = 'letterSpacing' in context;
  const spacing = `${cellWidth - context.measureText('M').width}px`;
  let text = '';
  let startX = 0;
  let nextX = 0;
  let rowY = 0;
  let color = '';
  let alpha = -1;
  // Canvas state setters parse their values (CSS colours and lengths), so
  // only touch them when the value actually changes.
  let appliedColor = '';
  let appliedAlpha = -1;
  let spacingApplied = false;

  function applyStyle(nextColor, nextAlpha) {
    if (nextColor !== appliedColor) {
      context.fillStyle = nextColor;
      appliedColor = nextColor;
    }
    if (nextAlpha !== appliedAlpha) {
      context.globalAlpha = nextAlpha;
      appliedAlpha = nextAlpha;
    }
  }

  function flush() {
    if (!text) return;
    applyStyle(color, alpha);
    context.fillText(text, startX, rowY);
    text = '';
  }

  return {
    paint(glyph, nextColor, nextAlpha, x, y) {
      if (!canBatch) {
        applyStyle(nextColor, nextAlpha);
        context.fillText(glyph, x, y);
        return;
      }
      if (!spacingApplied) {
        context.letterSpacing = spacing;
        spacingApplied = true;
      }
      if (text && (nextColor !== color || nextAlpha !== alpha
        || y !== rowY || Math.abs(x - nextX) > 0.000001)) flush();
      if (!text) {
        startX = x;
        rowY = y;
        color = nextColor;
        alpha = nextAlpha;
      }
      text += glyph;
      nextX = x + cellWidth;
    },
    finish() {
      flush();
      if (canBatch) context.letterSpacing = '0px';
      spacingApplied = false;
      context.globalAlpha = 1;
      // Other code draws between frames, so re-apply state next frame.
      color = '';
      alpha = -1;
      appliedColor = '';
      appliedAlpha = -1;
    },
  };
}
