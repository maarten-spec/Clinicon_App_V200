export async function onRequest({ request, params }) {
  const upstreamBase = "https://clinicon-stellenplan.maarten-koomen.workers.dev";
  const url = new URL(request.url);
  const path = params.path || "";
  const target = new URL(`${upstreamBase}/api/${path}`);
  target.search = url.search;

  const headers = new Headers(request.headers);
  const accessEmail =
    headers.get("cf-access-authenticated-user-email") ||
    headers.get("CF-Access-Authenticated-User-Email") ||
    "";
  if (accessEmail) {
    headers.set("x-user-email", accessEmail);
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
