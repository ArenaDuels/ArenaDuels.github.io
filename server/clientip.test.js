import test from "node:test";
import assert from "node:assert/strict";
import { clientIpFrom, resolveTrustProxy } from "./clientip.js";

const req = (header, remote = "10.0.0.5") => ({ headers: header ? { "cf-connecting-ip": header } : {}, socket: { remoteAddress: remote } });

test("proxy trust: Render by default, explicit 1 anywhere, 0 always off, nothing otherwise", () => {
  assert.equal(resolveTrustProxy({}), false);
  assert.equal(resolveTrustProxy({ RENDER: "true" }), true);
  assert.equal(resolveTrustProxy({ TRUST_PROXY: "1" }), true);
  assert.equal(resolveTrustProxy({ TRUST_PROXY: "0", RENDER: "true" }), false);
});

test("the CF header is ignored when not trusted (a client could have sent anything)", () => {
  assert.equal(clientIpFrom(req("1.2.3.4"), false), "10.0.0.5");
});

test("when trusted, a valid header is used; a missing or invalid one falls back to the peer", () => {
  assert.equal(clientIpFrom(req("1.2.3.4"), true), "1.2.3.4");
  assert.equal(clientIpFrom(req("2001:db8::1"), true), "2001:db8::1");
  assert.equal(clientIpFrom(req("not-an-ip"), true), "10.0.0.5");
  assert.equal(clientIpFrom(req(undefined), true), "10.0.0.5");
});
