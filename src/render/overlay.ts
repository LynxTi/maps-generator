export function createOverlaySvg(
  width: number,
  height: number,
  markerX: number,
  markerY: number,
): string {
  const scale = width / 1232;

  const markerOuter = 42 * scale;
  const markerInner = 18 * scale;
  const markerColor = '#C8A96B';

  return `
    <g>
      <circle cx="${markerX}" cy="${markerY}" r="${markerOuter}" fill="${markerColor}" opacity="0.4" />
      <circle cx="${markerX}" cy="${markerY}" r="${markerInner}" fill="${markerColor}" />
    </g>
  `;
}

export function createStandaloneOverlaySvg(
  width: number,
  height: number,
  markerX: number,
  markerY: number,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${createOverlaySvg(width, height, markerX, markerY)}
  </svg>`;
}
