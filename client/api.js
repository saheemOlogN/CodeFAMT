export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json().catch(() => ({
    error: 'The API is offline. Start the server and connect MongoDB and Redis.',
  }));
  if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
  return data;
}
export const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
