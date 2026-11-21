import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { BASE_PATH } from './api/generated';
import { authInterceptor } from './core/auth.interceptor';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Das Backend läuft unter /api im Frontend-Proxy; die FastAPI-Routen selbst
    // besitzen bewusst kein /api-Präfix.
    { provide: BASE_PATH, useValue: '/api' },
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(routes),
  ],
};
