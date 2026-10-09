// Configuración de sincronización con Supabase.
// Copia estos dos valores de: Supabase → tu proyecto → Project Settings → API (o "Connect").
// La "anon / publishable key" es PÚBLICA por diseño: es seguro subirla a GitHub,
// porque la tabla está protegida con Row Level Security (cada usuario solo ve su fila)
// y además los datos van cifrados con tu contraseña.
// NUNCA pongas aquí la "service_role" / "secret key".
window.BC_CLOUD = {
  url: 'https://wmgyzutaexkmjcwjizop.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndtZ3l6dXRhZXhrbWpjd2ppem9wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMzYxNzAsImV4cCI6MjEwNjkxMjE3MH0.QFlVD9P4RlSXI14oeqRnQ3m4WbkQdKJu6Vle4QKnpFM'
};

// Dirección de tu Stocks App: de ahí salen los precios en vivo y la comparación contra el mercado
// en la sección GBM. Si abres Budget Control en tu computadora (localhost), primero intenta
// http://localhost:3000. Déjala vacía ('') para escribir los precios solo a mano.
window.BC_STOCKS = {
  url: 'https://stocks-app-rose.vercel.app'
};
