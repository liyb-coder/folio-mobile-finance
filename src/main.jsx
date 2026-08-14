import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import {
  NativeVaultApp,
  VaultPersonalAssetsPreview,
  VaultGatePreview,
  VaultWorkspacePreview,
} from "./NativeVaultApp.jsx";
import { WebIdentityGate } from "./auth/WebIdentityGate.jsx";
import { LockedWebGate, PublicDemoGate } from "./auth/WebModeGate.jsx";
import { readRuntimeConfig } from "./config/runtime.js";
import { SyncWorkspace } from "./sync/SyncWorkspace.jsx";
import "./styles.css";

const WebDemoRoot = lazy(() => import("./WebDemoRoot.jsx"));
const ProductLanding = lazy(() => import("./ProductLanding.jsx").then((module) => ({
  default: module.ProductLanding,
})));
const runtimeConfig = readRuntimeConfig();
const isOfficialProductHost = window.location.hostname === "folio-private-finance.liyubei1212.chatgpt.site";
const isProductLanding = !isTauri() && (
  window.location.pathname === "/product"
  || window.location.pathname === "/product/"
  || (isOfficialProductHost && window.location.pathname === "/")
);
const previewMode = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get("vault-preview")
  : null;
const application = isProductLanding
  ? (
      <Suspense fallback={<div className="vault-loading"><span /><p>正在载入 Folio 官网…</p></div>}>
        <ProductLanding />
      </Suspense>
    )
  : previewMode
  ? previewMode === "workspace"
    ? <VaultWorkspacePreview />
    : previewMode === "personal-assets"
      ? <VaultPersonalAssetsPreview />
    : previewMode === "analytics"
      ? (
          <Suspense fallback={<div className="vault-loading"><span /><p>正在载入 Folio…</p></div>}>
            <WebDemoRoot showDemoBanner={false} />
          </Suspense>
        )
      : previewMode === "native-analytics"
        ? <VaultWorkspacePreview fixture="analytics" />
      : previewMode === "native-film"
        ? <VaultWorkspacePreview fixture="film" />
      : previewMode === "native-settings"
        ? <VaultWorkspacePreview fixture="settings" />
      : previewMode === "sync-conflict"
        ? <VaultWorkspacePreview fixture="sync-conflict" />
    : <VaultGatePreview mode={previewMode} />
  : isTauri()
    ? <NativeVaultApp config={runtimeConfig} />
    : runtimeConfig.dataMode === "sync"
      ? (
          <WebIdentityGate config={runtimeConfig}>
            {(props) => <SyncWorkspace {...props} />}
          </WebIdentityGate>
        )
      : runtimeConfig.dataMode === "demo"
        ? (
          <PublicDemoGate>
          <Suspense fallback={<div className="vault-loading"><span /><p>正在载入 Folio…</p></div>}>
            <WebDemoRoot />
          </Suspense>
          </PublicDemoGate>
        )
        : <LockedWebGate localMode={runtimeConfig.dataMode === "local"} />;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {application}
  </React.StrictMode>,
);
