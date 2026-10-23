// Datos de conexión a Supabase.
// Los encuentras en Supabase -> Project Settings -> API Keys (y Data API para la URL):
//   - Project URL
//   - Publishable key (sb_publishable_...) o, en proyectos antiguos, la llave anon (eyJ...)
// Esta llave es pública por diseño: la base solo deja leer las vistas y
// ejecutar las funciones de la demo (ver supabase/02_api_web.sql).
window.BP_CONFIG = {
  SUPABASE_URL: 'https://avqycgxejqnflkypuuti.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_Q0BjU1713FPxp8twcaaTTw_e3qCCq4p',
  EQUIPO: 'Juan Diego Valenzuela Calderón, Frederick Alexander Moreno Fabelo y Eduar Santiago Molina Escarpetta'
};
