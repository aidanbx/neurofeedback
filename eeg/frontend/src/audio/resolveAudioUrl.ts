export function resolveAudioUrl(url: string): string {
  if (!url || url === 'silence') return '';
  if (/^https?:\/\//.test(url)) return url;
  const apiUrl = url.startsWith('/api/') ? url : `/api${url}`;
  if (window.location.protocol === 'file:') return `http://127.0.0.1:8765${apiUrl}`;
  return apiUrl;
}
