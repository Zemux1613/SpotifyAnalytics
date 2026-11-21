// Leitet /api/... im Dev-Server an das Backend weiter.
// Lokal: 127.0.0.1:8000, im Docker-Compose-Dev-Modus setzt compose API_TARGET=http://backend:8000.
const target = process.env.API_TARGET || 'http://127.0.0.1:8000';

module.exports = {
  '/api': {
    target,
    secure: false,
    pathRewrite: { '^/api': '' },
  },
};
