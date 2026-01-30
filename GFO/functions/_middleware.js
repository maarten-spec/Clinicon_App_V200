export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname || "/";

  const reserved = new Set(["pages", "assets", "api", "cdn-cgi"]);
  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const segments = path.split("/").filter(Boolean);
  const first = segments[0] ? normalize(segments[0]) : "";

  if (first && !reserved.has(first)) {
    return next();
  }

  if (!(path === "/" || path.startsWith("/pages/"))) {
    return next();
  }

  const cookieHeader = request.headers.get("cookie") || "";
  const tenantCookieMatch = cookieHeader.match(/(?:^|;\s*)clinicon_tenant=([^;]+)/);
  const tenantCookie = tenantCookieMatch ? decodeURIComponent(tenantCookieMatch[1]) : "";
  if (tenantCookie) {
    let target = path;
    if (path === "/") {
      target = `/${tenantCookie}/pages/start.html`;
    } else if (path.startsWith("/pages/")) {
      target = `/${tenantCookie}${path}`;
    }
    if (target !== path) {
      return Response.redirect(`${url.origin}${target}${url.search}`, 302);
    }
  }

  let accessEmail =
    request.headers.get("cf-access-authenticated-user-email") ||
    request.headers.get("CF-Access-Authenticated-User-Email") ||
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

  if (!accessEmail) {
    return next();
  }

  let tenantData;
  try {
    const tenantRes = await fetch(`${url.origin}/api/tenants`, {
      headers: {
        "cf-access-authenticated-user-email": accessEmail,
        "CF-Access-Authenticated-User-Email": accessEmail,
        Accept: "application/json"
      }
    });
    if (!tenantRes.ok) {
      return next();
    }
    tenantData = await tenantRes.json();
  } catch (err) {
    return next();
  }
  const tenant = tenantData && tenantData.tenant ? tenantData.tenant : (Array.isArray(tenantData.tenants) ? tenantData.tenants[0] : null);
  const slug = normalize(tenant ? (tenant.code || tenant.name) : "");
  if (!slug) {
    return next();
  }

  let target = path;
  if (path === "/") {
    target = `/${slug}/pages/start.html`;
  } else if (path.startsWith("/pages/")) {
    target = `/${slug}${path}`;
  }

  if (target !== path) {
    const headers = new Headers({ Location: `${url.origin}${target}${url.search}` });
    headers.append("Set-Cookie", `clinicon_tenant=${slug}; Max-Age=3600; Path=/; SameSite=Lax`);
    return new Response(null, { status: 302, headers });
  }

  return next();
}
