module.exports = (request, response) => {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return response.status(500).json({ error: "Thiếu cấu hình Supabase trên Vercel." });
  }

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({ SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY });
};
