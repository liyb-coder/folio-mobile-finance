fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" || target_os == "ios" {
        let module_cache =
            std::path::PathBuf::from(std::env::var("OUT_DIR").expect("Cargo must provide OUT_DIR"))
                .join("clang-module-cache");
        cc::Build::new()
            .file("src/apple_document_extractor.m")
            .file("src/apple_notifications.m")
            .file("src/apple_speech.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .flag("-fmodules")
            .flag(&format!("-fmodules-cache-path={}", module_cache.display()))
            .compile("folio_apple_document");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=Vision");
        println!("cargo:rustc-link-lib=framework=PDFKit");
        println!("cargo:rustc-link-lib=framework=UserNotifications");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=Speech");
        if target_os == "macos" {
            println!("cargo:rustc-link-lib=framework=AppKit");
        } else {
            println!("cargo:rustc-link-lib=framework=UIKit");
        }
        println!("cargo:rerun-if-changed=src/apple_document_extractor.m");
        println!("cargo:rerun-if-changed=src/apple_notifications.m");
        println!("cargo:rerun-if-changed=src/apple_speech.m");
    }
    tauri_build::build()
}
