use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

const DEK_LENGTH: usize = 32;
const SALT_LENGTH: usize = 16;
const NONCE_LENGTH: usize = 24;
const ARGON2_MEMORY_KIB: u32 = 64 * 1024;
const ARGON2_ITERATIONS: u32 = 3;
const ARGON2_PARALLELISM: u32 = 1;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrappedDek {
    pub version: u8,
    pub algorithm: String,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
    pub argon2_memory_kib: u32,
    pub argon2_iterations: u32,
    pub argon2_parallelism: u32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordEnvelope {
    pub version: u8,
    pub kind: String,
    pub algorithm: String,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
    pub argon2_memory_kib: u32,
    pub argon2_iterations: u32,
    pub argon2_parallelism: u32,
}

fn random_array<const N: usize>() -> Result<[u8; N], String> {
    let mut bytes = [0_u8; N];
    getrandom::fill(&mut bytes).map_err(|_| "Secure random generation failed.".to_owned())?;
    Ok(bytes)
}

fn derive_kek(
    password: &str,
    salt: &[u8],
    wrapped: &WrappedDek,
) -> Result<Zeroizing<[u8; DEK_LENGTH]>, String> {
    derive_key(
        password,
        salt,
        wrapped.argon2_memory_kib,
        wrapped.argon2_iterations,
        wrapped.argon2_parallelism,
    )
}

fn derive_key(
    password: &str,
    salt: &[u8],
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<Zeroizing<[u8; DEK_LENGTH]>, String> {
    if password.is_empty() {
        return Err("Password is required.".to_owned());
    }
    let mut key = Zeroizing::new([0_u8; DEK_LENGTH]);
    let params = Params::new(memory_kib, iterations, parallelism, Some(DEK_LENGTH))
        .map_err(|_| "Invalid Argon2 parameters.".to_owned())?;
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|_| "Password key derivation failed.".to_owned())?;
    Ok(key)
}

fn aad(vault_id: &str) -> Result<Vec<u8>, String> {
    if vault_id.trim().is_empty() {
        return Err("vaultId is required.".to_owned());
    }
    Ok(format!("folio:vault:{}:dek:v1", vault_id.trim()).into_bytes())
}

pub fn create_password_wrapped_dek(
    vault_id: &str,
    password: &str,
) -> Result<(Zeroizing<[u8; DEK_LENGTH]>, WrappedDek), String> {
    let dek = Zeroizing::new(random_array::<DEK_LENGTH>()?);
    let wrapped = wrap_existing_dek(vault_id, password, dek.as_ref())?;
    Ok((dek, wrapped))
}

pub fn wrap_existing_dek(vault_id: &str, password: &str, dek: &[u8]) -> Result<WrappedDek, String> {
    if dek.len() != DEK_LENGTH {
        return Err("Vault data key must contain exactly 32 bytes.".to_owned());
    }
    let salt = random_array::<SALT_LENGTH>()?;
    let nonce = random_array::<NONCE_LENGTH>()?;
    let mut wrapped = WrappedDek {
        version: 1,
        algorithm: "argon2id+xchacha20poly1305".to_owned(),
        salt: STANDARD_NO_PAD.encode(salt),
        nonce: STANDARD_NO_PAD.encode(nonce),
        ciphertext: String::new(),
        argon2_memory_kib: ARGON2_MEMORY_KIB,
        argon2_iterations: ARGON2_ITERATIONS,
        argon2_parallelism: ARGON2_PARALLELISM,
    };
    let kek = derive_kek(password, &salt, &wrapped)?;
    let cipher = XChaCha20Poly1305::new_from_slice(kek.as_ref())
        .map_err(|_| "Unable to initialize key wrapping cipher.".to_owned())?;
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: dek,
                aad: &aad(vault_id)?,
            },
        )
        .map_err(|_| "Unable to wrap vault key.".to_owned())?;
    wrapped.ciphertext = STANDARD_NO_PAD.encode(ciphertext);
    Ok(wrapped)
}

pub fn unwrap_password_dek(
    vault_id: &str,
    password: &str,
    wrapped: &WrappedDek,
) -> Result<Zeroizing<[u8; DEK_LENGTH]>, String> {
    if wrapped.version != 1 || wrapped.algorithm != "argon2id+xchacha20poly1305" {
        return Err("Unsupported wrapped key format.".to_owned());
    }
    let salt = STANDARD_NO_PAD
        .decode(&wrapped.salt)
        .map_err(|_| "Invalid wrapped key metadata.".to_owned())?;
    let nonce = STANDARD_NO_PAD
        .decode(&wrapped.nonce)
        .map_err(|_| "Invalid wrapped key metadata.".to_owned())?;
    let ciphertext = STANDARD_NO_PAD
        .decode(&wrapped.ciphertext)
        .map_err(|_| "Invalid wrapped key metadata.".to_owned())?;
    if salt.len() != SALT_LENGTH || nonce.len() != NONCE_LENGTH {
        return Err("Invalid wrapped key metadata.".to_owned());
    }

    let kek = derive_kek(password, &salt, wrapped)?;
    let cipher = XChaCha20Poly1305::new_from_slice(kek.as_ref())
        .map_err(|_| "Unable to initialize key wrapping cipher.".to_owned())?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: &aad(vault_id)?,
                },
            )
            .map_err(|_| "Vault password or key metadata is invalid.".to_owned())?,
    );
    if plaintext.len() != DEK_LENGTH {
        return Err("Invalid decrypted vault key.".to_owned());
    }

    let mut dek = Zeroizing::new([0_u8; DEK_LENGTH]);
    dek.copy_from_slice(plaintext.as_ref());
    Ok(dek)
}

pub fn encrypt_password_payload(
    kind: &str,
    password: &str,
    plaintext: &[u8],
) -> Result<PasswordEnvelope, String> {
    if kind.trim().is_empty() {
        return Err("Envelope kind is required.".to_owned());
    }
    if password.chars().count() < 12 || password.len() > 1024 {
        return Err("Envelope password must contain 12 to 1,024 characters.".to_owned());
    }
    let salt = random_array::<SALT_LENGTH>()?;
    let nonce = random_array::<NONCE_LENGTH>()?;
    let key = derive_key(
        password,
        &salt,
        ARGON2_MEMORY_KIB,
        ARGON2_ITERATIONS,
        ARGON2_PARALLELISM,
    )?;
    let cipher = XChaCha20Poly1305::new_from_slice(key.as_ref())
        .map_err(|_| "Unable to initialize envelope cipher.".to_owned())?;
    let aad = format!("folio:{}:password-envelope:v1", kind.trim());
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|_| "Unable to encrypt password envelope.".to_owned())?;
    Ok(PasswordEnvelope {
        version: 1,
        kind: kind.trim().to_owned(),
        algorithm: "argon2id+xchacha20poly1305".to_owned(),
        salt: STANDARD_NO_PAD.encode(salt),
        nonce: STANDARD_NO_PAD.encode(nonce),
        ciphertext: STANDARD_NO_PAD.encode(ciphertext),
        argon2_memory_kib: ARGON2_MEMORY_KIB,
        argon2_iterations: ARGON2_ITERATIONS,
        argon2_parallelism: ARGON2_PARALLELISM,
    })
}

pub fn decrypt_password_payload(
    expected_kind: &str,
    password: &str,
    envelope: &PasswordEnvelope,
) -> Result<Zeroizing<Vec<u8>>, String> {
    if envelope.version != 1
        || envelope.kind != expected_kind
        || envelope.algorithm != "argon2id+xchacha20poly1305"
        || envelope.argon2_memory_kib != ARGON2_MEMORY_KIB
        || envelope.argon2_iterations != ARGON2_ITERATIONS
        || envelope.argon2_parallelism != ARGON2_PARALLELISM
    {
        return Err("Unsupported password envelope format.".to_owned());
    }
    let salt = STANDARD_NO_PAD
        .decode(&envelope.salt)
        .map_err(|_| "Invalid password envelope metadata.".to_owned())?;
    let nonce = STANDARD_NO_PAD
        .decode(&envelope.nonce)
        .map_err(|_| "Invalid password envelope metadata.".to_owned())?;
    let ciphertext = STANDARD_NO_PAD
        .decode(&envelope.ciphertext)
        .map_err(|_| "Invalid password envelope metadata.".to_owned())?;
    if salt.len() != SALT_LENGTH || nonce.len() != NONCE_LENGTH {
        return Err("Invalid password envelope metadata.".to_owned());
    }
    let key = derive_key(
        password,
        &salt,
        envelope.argon2_memory_kib,
        envelope.argon2_iterations,
        envelope.argon2_parallelism,
    )?;
    let cipher = XChaCha20Poly1305::new_from_slice(key.as_ref())
        .map_err(|_| "Unable to initialize envelope cipher.".to_owned())?;
    let aad = format!("folio:{}:password-envelope:v1", expected_kind);
    cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: aad.as_bytes(),
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| "Envelope password or encrypted content is invalid.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_wrapping_round_trips_and_uses_random_material() {
        let (first_dek, first) =
            create_password_wrapped_dek("vault-1", "correct horse battery staple")
                .expect("first key should be created");
        let (_, second) = create_password_wrapped_dek("vault-1", "correct horse battery staple")
            .expect("second key should be created");
        let unwrapped = unwrap_password_dek("vault-1", "correct horse battery staple", &first)
            .expect("key should unwrap");

        assert_eq!(first_dek.as_ref(), unwrapped.as_ref());
        assert_ne!(first.salt, second.salt);
        assert_ne!(first.nonce, second.nonce);
        assert_ne!(first.ciphertext, second.ciphertext);
    }

    #[test]
    fn wrong_password_or_vault_context_fails_closed() {
        let (_, wrapped) = create_password_wrapped_dek("vault-1", "correct-password")
            .expect("key should be created");
        assert!(unwrap_password_dek("vault-1", "wrong-password", &wrapped).is_err());
        assert!(unwrap_password_dek("vault-2", "correct-password", &wrapped).is_err());
    }

    #[test]
    fn existing_dek_can_be_rewrapped_without_changing_the_data_key() {
        let (dek, first) = create_password_wrapped_dek("vault-1", "correct horse battery staple")
            .expect("first password should wrap");
        let second = wrap_existing_dek("vault-1", "a completely different password", dek.as_ref())
            .expect("new password should rewrap");
        assert_ne!(first.salt, second.salt);
        assert_ne!(first.nonce, second.nonce);
        assert!(unwrap_password_dek("vault-1", "correct horse battery staple", &second).is_err());
        assert_eq!(
            unwrap_password_dek("vault-1", "a completely different password", &second)
                .expect("new password should unwrap")
                .as_ref(),
            dek.as_ref()
        );
    }

    #[test]
    fn modified_ciphertext_is_rejected() {
        let (_, mut wrapped) = create_password_wrapped_dek("vault-1", "correct-password")
            .expect("key should be created");
        let replacement = if wrapped.ciphertext.starts_with('A') {
            "B"
        } else {
            "A"
        };
        wrapped.ciphertext.replace_range(0..1, replacement);
        assert!(unwrap_password_dek("vault-1", "correct-password", &wrapped).is_err());
    }

    #[test]
    fn password_envelope_authenticates_kind_password_and_payload() {
        let payload = b"encrypted backup payload";
        let envelope =
            encrypt_password_payload("folio-backup", "correct horse battery staple", payload)
                .expect("payload should encrypt");
        let decrypted =
            decrypt_password_payload("folio-backup", "correct horse battery staple", &envelope)
                .expect("payload should decrypt");
        assert_eq!(decrypted.as_slice(), payload);
        assert!(
            decrypt_password_payload("folio-backup", "incorrect password value", &envelope)
                .is_err()
        );
        assert!(decrypt_password_payload(
            "different-kind",
            "correct horse battery staple",
            &envelope
        )
        .is_err());
    }
}
