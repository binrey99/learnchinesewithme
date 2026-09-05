import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

async function loadEnvironment() {
  const apiResponse = await fetch("./api/config", { cache: "no-store" });
  if (apiResponse.ok) return apiResponse.json();
  if (apiResponse.status !== 404) throw new Error("Không thể tải cấu hình Supabase từ máy chủ.");

  const localResponse = await fetch("./.env", { cache: "no-store" });
  if (!localResponse.ok) throw new Error("Không thể tải file cấu hình .env.");

  return Object.fromEntries(
    (await localResponse.text())
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      }),
  );
}

const environment = await loadEnvironment();

if (!environment.SUPABASE_URL || !environment.SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Hãy điền SUPABASE_URL và SUPABASE_PUBLISHABLE_KEY trong file .env.");
}

export const supabase = createClient(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY);
