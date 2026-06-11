/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SESSION_ACCOUNT?: string;
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
