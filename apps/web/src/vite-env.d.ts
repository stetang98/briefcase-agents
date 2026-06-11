/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SESSION_ACCOUNT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
