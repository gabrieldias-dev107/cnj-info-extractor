export function request({ method = "POST", headers = {}, body = {} } = {}) {
  return { method, headers, body };
}

export function response() {
  const headers = new Map();
  return {
    statusCode: null,
    body: undefined,
    headers,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

export function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}
