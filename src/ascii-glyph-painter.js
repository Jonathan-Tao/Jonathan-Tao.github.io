// Adjacent cells with identical paint and displacement can share one text
// draw. Keep the original glyphs, fractional positions, font and opacity;
// displaced ripple/reveal cells naturally fall back to individual draws.
export function createGlyphPainter(context, font, cellWidth) {
  context.font = font;
  const canBatch = 'letterSpacing' in context;
  const spacing = cellWidth - context.measureText('M').width;
  let text = '';
  let startX = 0;
  let nextX = 0;
  let rowY = 0;
  let color = '';
  let alpha = -1;

  function flush() {
    if (!text) return;
    context.fillStyle = color;
    context.globalAlpha = alpha;
    context.fillText(text, startX, rowY);
    text = '';
  }

  return {
    paint(glyph, nextColor, nextAlpha, x, y) {
      if (!canBatch) {
        if (nextColor !== color) context.fillStyle = nextColor;
        if (nextAlpha !== alpha) context.globalAlpha = nextAlpha;
        color = nextColor;
        alpha = nextAlpha;
        context.fillText(glyph, x, y);
        return;
      }
      if (!text) context.letterSpacing = `${spacing}px`;
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
      context.globalAlpha = 1;
      color = '';
      alpha = -1;
    },
  };
}
