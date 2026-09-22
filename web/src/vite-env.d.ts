/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_API_PROXY_TARGET?: string;
  readonly VITE_SENTIMENT_REPO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
