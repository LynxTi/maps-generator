export function roundCoordinate(value: number, precision = 4): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function formatCoordinateKey(value: number, precision = 4): string {
  return roundCoordinate(value, precision).toFixed(precision);
}

export function toCoordinateKey(lat: number, lon: number, precision = 4) {
  return {
    latKey: formatCoordinateKey(lat, precision),
    lonKey: formatCoordinateKey(lon, precision),
  };
}

export function coordinateSeed(latKey: string, lonKey: string, renderVersion: string): string {
  return `${latKey}:${lonKey}:${renderVersion}`;
}

export function buildPublicUrl(publicBaseUrl: string, urlPath: string): string {
  const base = publicBaseUrl.replace(/\/+$/, '');
  const path = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
  return `${base}${path}`;
}

export function storageUrlPath(filename: string): string {
  return `/storage/${filename}`;
}

const UUID_WEBP =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

export function isPublicStorageFilename(filename: string): boolean {
  return UUID_WEBP.test(filename) && !filename.includes('/') && !filename.includes('\\');
}
