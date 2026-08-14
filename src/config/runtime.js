const DATA_MODES = Object.freeze(["locked", "demo", "local", "sync"]);

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value, fallback = false) {
  const normalized = normalize(value).toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`Expected a boolean environment value, received "${normalized}".`);
}

export function readRuntimeConfig(environment = import.meta.env ?? {}) {
  const dataMode = normalize(environment.VITE_DATA_MODE) || "locked";

  if (!DATA_MODES.includes(dataMode)) {
    throw new Error(
      `Unsupported VITE_DATA_MODE "${dataMode}". Expected one of: ${DATA_MODES.join(", ")}.`,
    );
  }

  const config = {
    dataMode,
    supabaseUrl: normalize(environment.VITE_SUPABASE_URL),
    supabasePublishableKey: normalize(environment.VITE_SUPABASE_PUBLISHABLE_KEY),
    passkeyAuthEnabled: readBoolean(environment.VITE_PASSKEY_AUTH_ENABLED, false),
    publicDemoEnabled: readBoolean(environment.VITE_PUBLIC_DEMO_ENABLED, false),
  };

  if (dataMode === "demo" && !config.publicDemoEnabled) {
    throw new Error(
      "Demo mode requires VITE_PUBLIC_DEMO_ENABLED=true.",
    );
  }

  if (
    dataMode === "sync"
    && (!config.supabaseUrl || !config.supabasePublishableKey)
  ) {
    throw new Error(
      "Sync mode requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return Object.freeze(config);
}

export { DATA_MODES };
