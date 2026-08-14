use zeroize::Zeroizing;

const KEYCHAIN_SERVICE: &str = "com.beizi.folio.vault-key";
const MODEL_KEYCHAIN_SERVICE: &str = "com.beizi.folio.model-secret";
const EMAIL_KEYCHAIN_SERVICE: &str = "com.beizi.folio.email-secret";

fn keychain_account(vault_id: &str) -> String {
    format!("vault:{vault_id}:dek:v1")
}

fn model_secret_account(provider_id: &str) -> String {
    format!("provider:{provider_id}:api-key:v1")
}

fn email_secret_account(vault_id: &str, source_id: &str) -> String {
    format!("vault:{vault_id}:email-source:{source_id}:auth-code:v1")
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod platform {
    use super::{
        email_secret_account, keychain_account, model_secret_account, EMAIL_KEYCHAIN_SERVICE,
        KEYCHAIN_SERVICE, MODEL_KEYCHAIN_SERVICE,
    };
    use objc2_local_authentication::{
        kLAPolicyDeviceOwnerAuthenticationWithBiometrics, LAContext, LAPolicy,
    };
    use security_framework::{
        access_control::{ProtectionMode, SecAccessControl},
        passwords::{
            delete_generic_password_options, generic_password, set_generic_password_options,
            AccessControlOptions, PasswordOptions,
        },
    };
    use zeroize::Zeroizing;

    fn options(vault_id: &str) -> PasswordOptions {
        let account = keychain_account(vault_id);
        let mut options = PasswordOptions::new_generic_password(KEYCHAIN_SERVICE, &account);
        options.set_access_synchronized(Some(false));
        options.use_protected_keychain();
        options
    }

    fn model_options(provider_id: &str) -> PasswordOptions {
        let account = model_secret_account(provider_id);
        let mut options = PasswordOptions::new_generic_password(MODEL_KEYCHAIN_SERVICE, &account);
        options.set_access_synchronized(Some(false));
        options.use_protected_keychain();
        options
    }

    fn email_options(vault_id: &str, source_id: &str) -> PasswordOptions {
        let account = email_secret_account(vault_id, source_id);
        let mut options = PasswordOptions::new_generic_password(EMAIL_KEYCHAIN_SERVICE, &account);
        options.set_access_synchronized(Some(false));
        options.use_protected_keychain();
        options
    }

    pub fn biometry_available() -> bool {
        let context = unsafe { LAContext::new() };
        unsafe {
            context
                .canEvaluatePolicy_error(LAPolicy(
                    kLAPolicyDeviceOwnerAuthenticationWithBiometrics as isize,
                ))
                .is_ok()
        }
    }

    pub fn store_biometric_dek(vault_id: &str, dek: &[u8; 32]) -> Result<(), String> {
        if !biometry_available() {
            return Err("Touch ID is unavailable or has no enrolled fingerprint.".to_owned());
        }
        let access_control = SecAccessControl::create_with_protection(
            Some(ProtectionMode::AccessibleWhenPasscodeSetThisDeviceOnly),
            AccessControlOptions::BIOMETRY_CURRENT_SET.bits(),
        )
        .map_err(|_| "Unable to create Touch ID keychain protection.".to_owned())?;
        let mut options = options(vault_id);
        options.set_access_control(access_control);
        options.set_label("Folio encrypted vault key");
        set_generic_password_options(dek, options)
            .map_err(|_| "Unable to store the vault key in Keychain.".to_owned())
    }

    pub fn load_biometric_dek(vault_id: &str) -> Result<Zeroizing<Vec<u8>>, String> {
        generic_password(options(vault_id))
            .map(Zeroizing::new)
            .map_err(|_| "Touch ID authentication was cancelled or failed.".to_owned())
    }

    pub fn delete_biometric_dek(vault_id: &str) {
        let _ = delete_generic_password_options(options(vault_id));
    }

    pub fn store_model_secret(provider_id: &str, secret: &[u8]) -> Result<(), String> {
        let mut options = model_options(provider_id);
        options.set_label("Folio model provider API key");
        set_generic_password_options(secret, options)
            .map_err(|_| "Unable to store the model provider key in Keychain.".to_owned())
    }

    pub fn load_model_secret(provider_id: &str) -> Result<Zeroizing<Vec<u8>>, String> {
        generic_password(model_options(provider_id))
            .map(Zeroizing::new)
            .map_err(|_| "No model provider key is stored in Keychain.".to_owned())
    }

    pub fn delete_model_secret(provider_id: &str) {
        let _ = delete_generic_password_options(model_options(provider_id));
    }

    pub fn store_email_secret(
        vault_id: &str,
        source_id: &str,
        secret: &[u8],
    ) -> Result<(), String> {
        let mut options = email_options(vault_id, source_id);
        options.set_label("Folio QQ Mail IMAP authorization code");
        set_generic_password_options(secret, options)
            .map_err(|_| "Unable to store the mailbox authorization code in Keychain.".to_owned())
    }

    pub fn load_email_secret(
        vault_id: &str,
        source_id: &str,
    ) -> Result<Zeroizing<Vec<u8>>, String> {
        generic_password(email_options(vault_id, source_id))
            .map(Zeroizing::new)
            .map_err(|_| "No mailbox authorization code is stored in Keychain.".to_owned())
    }

    pub fn delete_email_secret(vault_id: &str, source_id: &str) {
        let _ = delete_generic_password_options(email_options(vault_id, source_id));
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod platform {
    use zeroize::Zeroizing;

    pub fn biometry_available() -> bool {
        false
    }

    pub fn store_biometric_dek(_vault_id: &str, _dek: &[u8; 32]) -> Result<(), String> {
        Err("Biometric Keychain protection is unavailable on this platform.".to_owned())
    }

    pub fn load_biometric_dek(_vault_id: &str) -> Result<Zeroizing<Vec<u8>>, String> {
        Err("Biometric Keychain protection is unavailable on this platform.".to_owned())
    }

    pub fn delete_biometric_dek(_vault_id: &str) {}

    pub fn store_model_secret(_provider_id: &str, _secret: &[u8]) -> Result<(), String> {
        Err("Secure model provider storage is unavailable on this platform.".to_owned())
    }

    pub fn load_model_secret(_provider_id: &str) -> Result<Zeroizing<Vec<u8>>, String> {
        Err("No model provider key is stored in secure storage.".to_owned())
    }

    pub fn delete_model_secret(_provider_id: &str) {}

    pub fn store_email_secret(
        _vault_id: &str,
        _source_id: &str,
        _secret: &[u8],
    ) -> Result<(), String> {
        Err("Secure mailbox authorization storage is unavailable on this platform.".to_owned())
    }

    pub fn load_email_secret(
        _vault_id: &str,
        _source_id: &str,
    ) -> Result<Zeroizing<Vec<u8>>, String> {
        Err("No mailbox authorization code is stored in secure storage.".to_owned())
    }

    pub fn delete_email_secret(_vault_id: &str, _source_id: &str) {}
}

pub fn biometry_available() -> bool {
    platform::biometry_available()
}

pub fn store_biometric_dek(vault_id: &str, dek: &[u8; 32]) -> Result<(), String> {
    platform::store_biometric_dek(vault_id, dek)
}

pub fn load_biometric_dek(vault_id: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    platform::load_biometric_dek(vault_id)
}

pub fn delete_biometric_dek(vault_id: &str) {
    platform::delete_biometric_dek(vault_id);
}

pub fn store_model_secret(provider_id: &str, secret: &[u8]) -> Result<(), String> {
    platform::store_model_secret(provider_id, secret)
}

pub fn load_model_secret(provider_id: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    platform::load_model_secret(provider_id)
}

pub fn delete_model_secret(provider_id: &str) {
    platform::delete_model_secret(provider_id);
}

pub fn store_email_secret(vault_id: &str, source_id: &str, secret: &[u8]) -> Result<(), String> {
    platform::store_email_secret(vault_id, source_id, secret)
}

pub fn load_email_secret(vault_id: &str, source_id: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    platform::load_email_secret(vault_id, source_id)
}

pub fn delete_email_secret(vault_id: &str, source_id: &str) {
    platform::delete_email_secret(vault_id, source_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keychain_accounts_are_namespaced_per_vault() {
        assert_eq!(KEYCHAIN_SERVICE, "com.beizi.folio.vault-key");
        assert_eq!(keychain_account("primary"), "vault:primary:dek:v1");
        assert_ne!(keychain_account("primary"), keychain_account("family"));
        assert_eq!(MODEL_KEYCHAIN_SERVICE, "com.beizi.folio.model-secret");
        assert_eq!(
            model_secret_account("openai_responses_v1"),
            "provider:openai_responses_v1:api-key:v1"
        );
        assert_eq!(EMAIL_KEYCHAIN_SERVICE, "com.beizi.folio.email-secret");
        assert_eq!(
            email_secret_account("primary", "email_1"),
            "vault:primary:email-source:email_1:auth-code:v1"
        );
    }
}
