const HUAMAI_API_BASE = "https://api.huamaihome.com";
const BOS_ENDPOINT = "https://sxxfjd.su.bcebos.com";
const BOS_BUCKET = "sxxfjd";

const FAKE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0",
  accept: "application/json, text/plain, */*",
  "accept-language": "zh-CN,zh;q=0.9",
  origin: "https://www.longehuanxinjs.com",
  referer: "https://www.longehuanxinjs.com/"
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
      "access-control-allow-headers": "content-type,token,authorization",
      ...(init.headers || {})
    }
  });
}

function textResponse(data, init = {}) {
  return new Response(data, {
    ...init,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
      "access-control-allow-headers": "content-type,token,authorization",
      ...(init.headers || {})
    }
  });
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function encodeRFC3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(signature);
}

async function getPayloadSha256Hex(payload) {
  if (!payload) {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array());
    return toHex(digest);
  }
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

function canonicalizeHeaders(headersMap) {
  const entries = Object.entries(headersMap)
    .map(([k, v]) => [k.trim().toLowerCase(), String(v).trim()])
    .sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalHeaders = entries.map(([k, v]) => `${k}:${v}`).join("\n");
  const signedHeaders = entries.map(([k]) => k).join(";");
  return { canonicalHeaders, signedHeaders };
}

function canonicalizeQuery(searchParams) {
  const pairs = [];
  for (const [key, value] of searchParams.entries()) {
    pairs.push([encodeRFC3986(key), encodeRFC3986(value)]);
  }
  pairs.sort((a, b) => {
    if (a[0] === b[0]) return a[1].localeCompare(b[1]);
    return a[0].localeCompare(b[0]);
  });
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

async function signBceBosRequest({ method, url, headers, ak, sk }) {
  const urlObj = new URL(url);
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const authStringPrefix = `bce-auth-v1/${ak}/${timestamp}/1800`;
  const signingKey = await hmacSha256Hex(sk, authStringPrefix);

  const normalizedHeaders = {
    host: urlObj.host,
    ...headers
  };

  const { canonicalHeaders, signedHeaders } = canonicalizeHeaders(normalizedHeaders);
  const canonicalUri = urlObj.pathname
    .split("/")
    .map((part) => encodeRFC3986(part))
    .join("/")
    .replace(/%2F/g, "/");
  const canonicalQuery = canonicalizeQuery(urlObj.searchParams);
  const canonicalRequest = [method.toUpperCase(), canonicalUri || "/", canonicalQuery, canonicalHeaders].join("\n");
  const signature = await hmacSha256Hex(signingKey, canonicalRequest);
  const authorization = `${authStringPrefix}/${signedHeaders}/${signature}`;

  return {
    ...normalizedHeaders,
    authorization,
    "x-bce-date": timestamp
  };
}

async function proxyToHuamai(request, pathname) {
  const url = new URL(request.url);
  const targetPath = pathname.replace(/^\/api\/huamai/, "") || "/";
  const targetUrl = `${HUAMAI_API_BASE}${targetPath}${url.search}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(FAKE_HEADERS)) {
    headers.set(key, value);
  }

  const token = request.headers.get("token");
  const authorization = request.headers.get("authorization");
  const contentType = request.headers.get("content-type");

  if (token) headers.set("token", token);
  if (authorization) headers.set("authorization", authorization);
  if (contentType) headers.set("content-type", contentType);

  const init = {
    method: request.method,
    headers
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const response = await fetch(targetUrl, init);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("access-control-allow-origin", "*");
  responseHeaders.set("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
  responseHeaders.set("access-control-allow-headers", "content-type,token,authorization");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}

async function createStsToken(userToken) {
  const stsParams = JSON.stringify({
    accessControlList: [
      {
        service: "bce:bos",
        region: "_",
        effect: "Allow",
        resource: ["undefined/_"],
        permission: ["READ", "WRITE"]
      }
    ]
  });

  const stsUrl = `${HUAMAI_API_BASE}/sxxf_sts/baidu/createSTSToken?sts=${encodeURIComponent(stsParams)}`;
  const response = await fetch(stsUrl, {
    headers: {
      ...FAKE_HEADERS,
      token: userToken
    }
  });

  const data = await response.json();
  if (data.code !== 0 || !data.data) {
    throw new Error(`STS 凭证获取失败：${data.msg || "未知错误"}`);
  }
  return data.data;
}

async function uploadToBos({ objectKey, file, credentials }) {
  const bosUrl = `${BOS_ENDPOINT}/${encodeRFC3986(objectKey).replace(/%2F/g, "/")}`;
  const payload = new Uint8Array(await file.arrayBuffer());
  const payloadSha256 = await getPayloadSha256Hex(payload);

  const signedHeaders = await signBceBosRequest({
    method: "PUT",
    url: bosUrl,
    headers: {
      "content-length": String(payload.byteLength),
      "content-type": file.type || "application/octet-stream",
      "x-bce-content-sha256": payloadSha256,
      "x-bce-security-token": credentials.sessionToken
    },
    ak: credentials.accessKeyId,
    sk: credentials.secretAccessKey
  });

  const response = await fetch(bosUrl, {
    method: "PUT",
    headers: signedHeaders,
    body: payload
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BOS 上传失败：${response.status} ${errorText}`);
  }
}

async function handleUpload(request) {
  const token = request.headers.get("token");
  if (!token) {
    return json({ code: -1, msg: "缺少 token" }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const objectKey = formData.get("objectKey");

  if (!(file instanceof File)) {
    return json({ code: -1, msg: "未收到文件" }, { status: 400 });
  }
  if (!objectKey) {
    return json({ code: -1, msg: "缺少 objectKey" }, { status: 400 });
  }

  try {
    const credentials = await createStsToken(token);
    await uploadToBos({
      objectKey: String(objectKey),
      file,
      credentials
    });

    return json({
      code: 0,
      msg: "上传成功",
      data: { objectKey: String(objectKey) }
    });
  } catch (error) {
    return json(
      {
        code: -1,
        msg: error.message || "上传失败"
      },
      { status: 500 }
    );
  }
}

async function signDingTalk(secret, timestamp) {
  const content = `${timestamp}\n${secret}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return encodeURIComponent(base64);
}

async function handleDingTalk(request) {
  const { accessToken, secret, keyword, content } = await request.json();

  if (!accessToken) {
    return json({ code: -1, msg: "缺少 accessToken" }, { status: 400 });
  }
  if (!content) {
    return json({ code: -1, msg: "缺少 content" }, { status: 400 });
  }

  let normalizedAccessToken = String(accessToken).trim();
  if (/^https?:\/\//i.test(normalizedAccessToken)) {
    try {
      const parsed = new URL(normalizedAccessToken);
      const tokenFromUrl = parsed.searchParams.get("access_token");
      if (tokenFromUrl) normalizedAccessToken = tokenFromUrl.trim();
    } catch (_) {}
  }

  if (!normalizedAccessToken) {
    return json({ code: -1, msg: "accessToken 无效" }, { status: 400 });
  }

  let finalContent = String(content);
  if (keyword && !finalContent.includes(keyword)) {
    finalContent = `${keyword} ${finalContent}`;
  }

  let url = `https://oapi.dingtalk.com/robot/send?access_token=${encodeURIComponent(normalizedAccessToken)}`;

  if (secret) {
    const timestamp = Date.now().toString();
    const sign = await signDingTalk(secret, timestamp);
    url += `&timestamp=${timestamp}&sign=${sign}`;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        msgtype: "text",
        text: { content: finalContent },
        at: { atMobiles: [], isAtAll: false }
      })
    });

    const data = await response.json();
    return json(data, { status: response.status });
  } catch (error) {
    return json(
      {
        code: -1,
        msg: "钉钉转发失败",
        error: error.message
      },
      { status: 500 }
    );
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
          "access-control-allow-headers": "content-type,token,authorization"
        }
      });
    }

    try {
      if (pathname === "/health") {
        return json({
          code: 0,
          msg: "ok",
          mode: "cloudflare-worker",
          routes: ["/api/huamai/*", "/api/upload", "/api/dingtalk/send"]
        });
      }

      if (pathname.startsWith("/api/huamai/")) {
        return await proxyToHuamai(request, pathname);
      }

      if (pathname === "/api/upload" && request.method === "POST") {
        return await handleUpload(request);
      }

      if (pathname === "/api/dingtalk/send" && request.method === "POST") {
        return await handleDingTalk(request);
      }

      return json({ code: 404, msg: "Not Found" }, { status: 404 });
    } catch (error) {
      return json(
        {
          code: -1,
          msg: "Worker 内部错误",
          error: error.message
        },
        { status: 500 }
      );
    }
  }
};
