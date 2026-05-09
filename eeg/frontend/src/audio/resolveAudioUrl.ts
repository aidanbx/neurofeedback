import { BACKEND_HTTP_ORIGIN } from '../config/appConfig';

export function resolveAudioUrl(url: string): string {
  if (!url || url === 'silence') return '';
  if (/^https?:\/\//.test(url)) return url;
  const apiUrl = url.startsWith('/api/') ? url : `/api${url}`;
  if (window.location.protocol === 'file:') return `${BACKEND_HTTP_ORIGIN}${apiUrl}`;
  return apiUrl;
}
