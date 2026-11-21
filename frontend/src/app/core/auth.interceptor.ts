import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '@shared/services/auth.service';

/** Läuft die Session ab (401), geht es zurück zur Anmeldung. /api/me prüft der Guard selbst. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !req.url.endsWith('/api/me')) {
        auth.clear();
        void router.navigateByUrl('/login');
      }
      return throwError(() => err);
    }),
  );
};
