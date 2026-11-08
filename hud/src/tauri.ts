export function runningInTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
