// Cliente mínimo de Microsoft Graph (fetch crudo, sin SDK) — reutiliza las
// mismas credenciales de app (tenant de Grecka, permiso Sites.Read.All ya
// consentido) que usa grecka-despacho/src/utils/microsoft-graph.ts.

async function gfetch(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  return Promise.race([
    fetch(url, options),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout ${timeoutMs / 1000}s: ${url.slice(0, 80)}`)), timeoutMs)
    ),
  ]);
}

export async function getGraphToken(): Promise<string> {
  const tenantId = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Faltan env vars: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET");
  }
  const res = await gfetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error obteniendo token de Microsoft: ${res.status} — ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("Token vacío en respuesta de Microsoft");
  return data.access_token as string;
}

/**
 * Descarga un archivo de un sitio de SharePoint (o de un OneDrive personal,
 * que Graph expone como un sitio más) dado su site-path y su ruta dentro de
 * la biblioteca por defecto.
 */
export async function descargarArchivoSharePoint(sitePath: string, filePath: string): Promise<Buffer> {
  const token = await getGraphToken();
  const headers = { Authorization: `Bearer ${token}` };

  const siteRes = await gfetch(`https://graph.microsoft.com/v1.0/sites/${sitePath}`, { headers, cache: "no-store" });
  if (!siteRes.ok) {
    const err = await siteRes.json().catch(() => ({}));
    throw new Error(`No se pudo acceder al sitio SharePoint: ${err?.error?.message ?? siteRes.status}`);
  }
  const site = await siteRes.json();
  const siteId = site.id as string;

  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const fileRes = await gfetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodedPath}:/content`,
    { headers, cache: "no-store" },
    30000
  );
  if (!fileRes.ok) {
    const err = await fileRes.json().catch(() => ({}));
    throw new Error(`No se pudo descargar el archivo: ${err?.error?.message ?? fileRes.status}`);
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
