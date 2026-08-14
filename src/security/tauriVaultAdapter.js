function assertInvoke(invoke) {
  if (typeof invoke !== "function") {
    throw new TypeError("A Tauri invoke function is required.");
  }
  return invoke;
}

export function createTauriVaultAdapter(invokeFunction) {
  const invoke = assertInvoke(invokeFunction);

  return Object.freeze({
    async list() {
      return invoke("vault_list");
    },

    async create({ vaultId, displayName, baseCurrency, password }) {
      return invoke("vault_create", {
        request: {
          vaultId,
          displayName,
          baseCurrency,
          password,
        },
      });
    },

    async unlock({ vaultId, method, password }) {
      return invoke("vault_unlock", {
        request: {
          vaultId,
          method,
          password: method === "password" ? password : null,
        },
      });
    },

    async biometricStatus(vaultId) {
      return invoke("vault_biometric_status", { vaultId });
    },

    async enableBiometric({ vaultId, password }) {
      return invoke("vault_enable_biometric", {
        request: { vaultId, password, confirmedByUser: true },
      });
    },

    async disableBiometric({ vaultId, password }) {
      return invoke("vault_disable_biometric", {
        request: { vaultId, password, confirmedByUser: true },
      });
    },

    async changePassword({ vaultId, currentPassword, newPassword }) {
      return invoke("vault_change_password", {
        request: {
          vaultId,
          currentPassword,
          newPassword,
          confirmedByUser: true,
        },
      });
    },

    async clearAllData({ vaultId, currentPassword }) {
      return invoke("vault_clear_all_data", {
        request: {
          vaultId,
          currentPassword,
          confirmedByUser: true,
        },
      });
    },

    async lock({ sessionId }) {
      return invoke("vault_lock", { sessionId });
    },

    async status() {
      return invoke("vault_status");
    },
  });
}
