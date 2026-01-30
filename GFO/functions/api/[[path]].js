export async function onRequest({ request, params }) {
  const upstreamBase = "https://clinicon-stellenplan.maarten-koomen.workers.dev";
  const url = new URL(request.url);
  const path = params.path || "";
  const target = new URL(`${upstreamBase}/api/${path}`);
  target.search = url.search;

  const headers = new Headers(request.headers);
  let accessEmail =
    headers.get("cf-access-authenticated-user-email") ||
    headers.get("CF-Access-Authenticated-User-Email") ||
    "";

  if (!accessEmail) {
    try {
      const identityRes = await fetch("https://app.clinicon.de/cdn-cgi/access/get-identity", {
        headers: {
          cookie: request.headers.get("cookie") || "",
          "user-agent": request.headers.get("user-agent") || ""
        }
      });
      if (identityRes.ok) {
        const identity = await identityRes.json();
        accessEmail = identity && identity.email ? String(identity.email) : "";
      }
    } catch (err) {
      // ignore
    }
  }

  if (accessEmail) {
    headers.set("cf-access-authenticated-user-email", accessEmail);
    headers.set("CF-Access-Authenticated-User-Email", accessEmail);
  }

  const init = {
    method: request.method,
    headers,
    redirect: "manual"
  };

  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = await request.arrayBuffer();
  }

  return fetch(target, init);
}
