import assert from "node:assert/strict";
import test from "node:test";
import {
  canUsePasskeys,
  createSupabaseAuthClient,
  validateEmail,
  validateNewPassword,
  WebAuthController,
} from "../src/auth/supabaseAuth.js";
import { WEB_SESSION_IDLE_MS } from "../src/auth/webSessionGuard.js";

test("web auth client keeps tokens in memory and gates experimental passkeys", () => {
  let observed;
  const client = createSupabaseAuthClient({
    supabaseUrl: "https://example.supabase.co",
    supabasePublishableKey: "sb_publishable_test",
    passkeyAuthEnabled: true,
  }, (...arguments_) => {
    observed = arguments_;
    return { auth: {} };
  });
  assert.ok(client);
  assert.equal(observed[2].auth.persistSession, false);
  assert.equal(observed[2].auth.detectSessionInUrl, false);
  assert.equal(observed[2].auth.experimental.passkey, true);
  assert.equal(WEB_SESSION_IDLE_MS, 15 * 60 * 1000);
});

test("passkeys require the feature flag, a secure origin, and WebAuthn", () => {
  const browser = {
    isSecureContext: true,
    location: { hostname: "finance.example.com" },
    PublicKeyCredential: class {},
  };
  assert.equal(canUsePasskeys({ passkeyAuthEnabled: true }, browser), true);
  assert.equal(canUsePasskeys({ passkeyAuthEnabled: false }, browser), false);
  assert.equal(canUsePasskeys(
    { passkeyAuthEnabled: true },
    { ...browser, isSecureContext: false },
  ), false);
});

test("identity validation applies the production password policy", () => {
  assert.equal(validateEmail(" User@Example.com "), "user@example.com");
  assert.throws(() => validateEmail("not-an-email"), /有效/);
  assert.equal(validateNewPassword("StrongPassword9"), "StrongPassword9");
  assert.throws(() => validateNewPassword("short9A"), /12/);
  assert.throws(() => validateNewPassword("alllowercase123"), /大写/);
});

test("controller uses password auth without retaining the submitted password", async () => {
  const calls = [];
  const controller = new WebAuthController({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async (request) => {
        calls.push(request);
        return { data: { session: { user: { id: "user-a" } } }, error: null };
      },
    },
  });
  const result = await controller.signInWithPassword({
    email: "user@example.com",
    password: "SecretPassword9",
  });
  assert.equal(result.session.user.id, "user-a");
  assert.deepEqual(calls, [{ email: "user@example.com", password: "SecretPassword9" }]);
  assert.equal(Object.hasOwn(controller, "password"), false);
});
